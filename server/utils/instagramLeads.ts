import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { nextLeadReference } from '~/server/utils/leads'
import { receptionistHandlesNewLeads } from '~/server/utils/receptionist'

// Turning an Instagram DM into a lead.
//
// Without this an Instagram enquiry exists only as a row in the Inbox. It is
// absent from the leads board, uncounted in the funnel, missing from the
// dashboard's channel table, and invisible to the receptionist -- which
// drafts per lead, so a DM asking "how much is a first visit?" gets nothing.
// Somebody asking that is a lead by every definition this product uses.
//
// The lead is created, and no marketing sequence is started. lead.created
// rules exist to open a conversation with somebody who filled in a form and
// then went quiet; this person is in a conversation already, and answering
// them with a scripted welcome drip would be the wrong reply to a live
// question.

const GRAPH_BASE = 'https://graph.facebook.com/v21.0'

/**
 * Who this IGSID is, as far as Instagram will say.
 *
 * Best-effort: the profile call needs a token and permission that a clinic
 * may not have granted, and a lead with a placeholder name is worth far more
 * than no lead. Never throws for that reason.
 */
async function fetchInstagramName(igsid: string, accessToken: string): Promise<string | null> {
  try {
    const profile = await $fetch<{ name?: string; username?: string }>(`${GRAPH_BASE}/${igsid}`, {
      query: { fields: 'name,username', access_token: accessToken },
      timeout: 5_000,
    })
    const name = (profile.name ?? '').trim()
    if (name) return name
    // A handle is not a name, but it is what the clinic will recognise them
    // by, and it beats "Instagram user" on a board somebody has to scan.
    const username = (profile.username ?? '').trim()
    return username ? `@${username}` : null
  } catch {
    return null
  }
}

/**
 * The lead for this Instagram sender, creating one the first time.
 *
 * Returns null only if the lead could not be written -- the caller stores the
 * message either way, because the message is the thing that cannot be
 * recovered.
 */
export async function leadForInstagramSender(
  supabase: SupabaseClient<Database>,
  accountId: string,
  igsid: string,
  accessToken: string | null,
): Promise<string | null> {
  // external_id + external_source is the same pair the Facebook lead-ad
  // ingest dedupes on, and it is uniquely indexed for it. So a person who
  // messages every week has one lead, not one per message.
  const { data: existing } = await supabase
    .from('leads')
    .select('id')
    .eq('account_id', accountId)
    .eq('external_source', 'instagram')
    .eq('external_id', igsid)
    .is('deleted_at', null)
    .maybeSingle()

  if (existing) return existing.id

  const name = accessToken ? await fetchInstagramName(igsid, accessToken) : null

  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      account_id: accountId,
      reference: await nextLeadReference(supabase, accountId),
      // Named as honestly as Instagram allows. Not left blank: full_name is
      // NOT NULL and a board of empty rows is worse than a board of
      // placeholders somebody can rename.
      full_name: name ?? 'Instagram user',
      channel: 'instagram',
      // Spelled so the dashboard's channelOf() reads it as its own channel --
      // it splits a source on '·' and takes the head, which is how "Meta Ads
      // · <campaign>" becomes the "Meta Ads" row.
      source: 'Instagram',
      external_source: 'instagram',
      external_id: igsid,
      // 'contacted' rather than 'new': they wrote first. 'new' means an
      // enquiry nobody has spoken to, and the funnel counts it that way.
      stage: 'contacted',
      // Same rule as the form ingest: on means the receptionist has it.
      // Especially here -- somebody who has just asked a question in a DM is
      // the clearest case there is for a drafted reply already waiting.
      ...((await receptionistHandlesNewLeads(supabase, accountId)) ? { ai_state: 'handling' as const } : {}),
    })
    .select('id')
    .single()

  if (error) {
    console.error('[instagram] could not create a lead:', error.message)
    return null
  }

  await supabase.from('lead_events').insert({
    account_id: accountId,
    lead_id: lead.id,
    kind: 'conversation',
    title: 'Messaged on Instagram',
  })

  return lead.id
}

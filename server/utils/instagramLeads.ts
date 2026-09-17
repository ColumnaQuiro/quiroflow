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
  } catch (err: any) {
    // Logged, not swallowed. The lead is still created -- a placeholder name
    // beats no lead -- but a board full of "Instagram user" with nothing
    // explaining it is the same silent failure as an error toast with no
    // words in it. Meta's message names the cause: usually a token without
    // instagram_manage_messages, or a person who has not messaged this
    // account before.
    console.error('[instagram] could not read the sender profile:', err?.data?.error?.message ?? err?.message ?? err)
    return null
  }
}

/**
 * The name to show before Instagram tells us a real one.
 *
 * Suffixed, because several unnamed senders otherwise appear on the leads
 * board as identical rows called "Instagram user" and cannot be told apart.
 * The digits are meaningless on their own and are meant to be temporary --
 * they disappear the moment a profile lookup succeeds.
 */
function placeholderName(igsid: string): string {
  return `Instagram user ${igsid.slice(-4)}`
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
    .select('id, full_name')
    .eq('account_id', accountId)
    .eq('external_source', 'instagram')
    .eq('external_id', igsid)
    .is('deleted_at', null)
    .maybeSingle()

  if (existing) {
    // Try again for a name if the first attempt only got a placeholder.
    //
    // The lookup fails for reasons that get fixed -- a token granted the
    // wrong scope, a permission approved later -- and without this the lead
    // keeps the placeholder for as long as it exists, so fixing the cause
    // repairs nothing that already came through. The next message they send
    // is the cheapest moment to retry, and it costs one call only while the
    // name is still missing.
    if (accessToken && existing.full_name.startsWith('Instagram user')) {
      const name = await fetchInstagramName(igsid, accessToken)
      if (name) {
        await supabase.from('leads').update({ full_name: name }).eq('id', existing.id).eq('account_id', accountId)
      }
    }
    return existing.id
  }

  const name = accessToken ? await fetchInstagramName(igsid, accessToken) : null

  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      account_id: accountId,
      reference: await nextLeadReference(supabase, accountId),
      // Named as honestly as Instagram allows. Not left blank: full_name is
      // NOT NULL and a board of empty rows is worse than a board of
      // placeholders somebody can rename.
      full_name: name ?? placeholderName(igsid),
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

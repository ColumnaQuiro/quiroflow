import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { nextLeadReference } from '~/server/utils/leads'
import { receptionistHandlesNewLeads } from '~/server/utils/receptionist'
import { toE164Loose } from '~/utils/phone'

// Turning a WhatsApp message from a stranger into a lead.
//
// An inbound message was attributed to a patient, or to a lead already on the
// board, or to nobody at all. That third case is the one this exists for: it
// is a person who found the clinic, opened WhatsApp and asked a question, and
// nothing recorded that they had done it. They were absent from the leads
// board, uncounted in the funnel, missing from the dashboard's channel table,
// and invisible to the receptionist, which drafts per lead.
//
// It is the same argument instagramLeads.ts already makes for a DM, and the
// inconsistency was the giveaway: an "how much is a first visit?" sent on
// Instagram became a lead, and the identical sentence sent on WhatsApp became
// a row in the Inbox attached to nothing.
//
// The clinic's own landing page is why this matters commercially. The offer
// page carries a click-to-chat button beside the booking widget, so a visitor
// who does not want to pick a slot is invited to message instead -- and every
// one of them who did has been landing nowhere.
//
// No marketing sequence is started, and no marketing consent is recorded.
// Somebody who writes in has asked a question, not agreed to be marketed at;
// leadRecipient()'s consent gate reads the absence correctly and will not
// send them a drip. Answering a live question with a scripted welcome would
// be the wrong reply anyway -- the same reasoning Instagram uses.

/**
 * The name to show before WhatsApp tells us a real one.
 *
 * Suffixed with the last four digits for the same reason the Instagram
 * placeholder is: several unnamed senders otherwise appear on the board as
 * identical rows nobody can tell apart. Rarely needed -- a WhatsApp profile
 * name is set by most people and arrives with the message -- but full_name is
 * NOT NULL and a blank row is worse than one somebody can rename.
 */
function placeholderName(fromNumber: string): string {
  return `WhatsApp ${fromNumber.slice(-4)}`
}

/**
 * The lead for this WhatsApp sender, creating one the first time.
 *
 * Call only when the number matched no patient and no existing lead --
 * findLeadIdByPhone in the webhook is what establishes that, and a patient
 * always wins, because somebody who has become a patient is a patient.
 *
 * Returns null if the lead could not be written. The caller stores the
 * message either way: the message is the thing that cannot be recovered.
 */
export async function leadForWhatsAppSender(
  supabase: SupabaseClient<Database>,
  accountId: string,
  fromNumber: string,
  profileName: string | null,
): Promise<string | null> {
  const name = (profileName ?? '').trim() || placeholderName(fromNumber)

  // Meta sends the sender as full international digits with no "+", which is
  // also the shape this column already holds -- toE164Loose returns
  // "34674926473", not "+34674926473", and every lead the ad ingest has
  // written is stored that way. The leading "+" here is input to that
  // function, telling it the number is already international rather than a
  // local one to be prefixed; it is not part of the result.
  //
  // Matching the column matters beyond tidiness: the next message from this
  // number has to be caught by findLeadIdByPhone before it reaches this
  // function at all. The unique index below is the backstop for the race,
  // not the mechanism.
  const phone = toE164Loose(`+${fromNumber}`, 'ES') ?? fromNumber

  const insert = {
    account_id: accountId,
    reference: await nextLeadReference(supabase, accountId),
    full_name: name,
    phone,
    channel: 'whatsapp' as const,
    // Spelled so the dashboard's channelOf() reads it as its own channel: it
    // splits a source on '·' and takes the head, which is how "Meta Ads ·
    // <campaign>" becomes the "Meta Ads" row.
    source: 'WhatsApp',
    // The same pair the lead-ad ingest and the Instagram path dedupe on,
    // uniquely indexed per account. Two messages arriving together cannot
    // become two leads.
    external_source: 'whatsapp',
    external_id: fromNumber,
    // 'contacted' rather than 'new': they wrote first. 'new' means an enquiry
    // nobody has spoken to, and the funnel counts it that way.
    stage: 'contacted' as const,
    // Same rule as the form ingest and the Instagram path. Especially here --
    // somebody who has just asked a question is the clearest case there is
    // for a drafted reply already waiting when staff open the thread.
    ...((await receptionistHandlesNewLeads(supabase, accountId)) ? { ai_state: 'handling' as const } : {}),
  }

  const { data: lead, error } = await supabase.from('leads').insert(insert).select('id').single()

  if (error) {
    // The unique index doing its job: two messages from the same stranger
    // landed at once and the other one won. Not a failure -- the lead this
    // message belongs to exists, and returning it is the whole point.
    const { data: raced } = await supabase
      .from('leads')
      .select('id')
      .eq('account_id', accountId)
      .eq('external_source', 'whatsapp')
      .eq('external_id', fromNumber)
      .is('deleted_at', null)
      .maybeSingle()
    if (raced) return raced.id

    console.error('[whatsapp] could not create a lead:', error.message)
    return null
  }

  await supabase.from('lead_events').insert({
    account_id: accountId,
    lead_id: lead.id,
    kind: 'conversation',
    title: 'Messaged on WhatsApp',
  })

  return lead.id
}

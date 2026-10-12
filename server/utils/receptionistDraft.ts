import type { H3Event } from 'h3'
import { createAnthropicClient } from '~/server/utils/anthropicClient'
import { announceHandover, noteInConversation, sendAsReceptionist } from '~/server/utils/receptionistSend'
import { bookingTool } from '~/server/utils/receptionistBooking'
import { autoReplyHeldBack, isNoReply, isNoReplyMessage } from '~/utils/receptionistAutoReply'
import { buildSystemPrompt, loadBookedVisits, loadOfferedTypes, loadPatientPractitioners, loadReceptionistCalendar, toConfig, uniqueTypes, type LeadOrigin } from '~/server/utils/receptionist'
import { freeTimesLookup, runReceptionistModel } from '~/server/utils/receptionistModel'
import { cameFromAd } from '~/utils/receptionistLeadOrigin'
import { typesForAudience, type ReceptionistAudience } from '~/utils/receptionistTypes'
import { internalNotes } from '~/utils/receptionistGuard'

// Writing a receptionist reply for one lead.
//
// Extracted so the two callers cannot drift: the button in the Inbox
// (/api/growth/leads/:id/draft-reply) and the tick that drafts without being
// asked (/api/automations/receptionist-draft-cron). They must produce the
// same sentence for the same conversation -- an owner who presses the button
// and gets something different from what the tick would have written has no
// reason to trust either.
//
// Nothing here sends anything. It writes leads.ai_draft_body and returns.

// Sonnet, not Opus.
//
// This writes a short WhatsApp reply to a lead, in Spanish, from a persona
// and a handful of knowledge cards -- the kind of constrained, well-briefed
// writing Sonnet does as well as Opus, and a member of staff reads every
// word before it is sent, so the failure mode is a worse first draft rather
// than a bad message reaching a patient.
//
// It is also the only part of Growth with a per-use cost. Growth is a 39
// euro add-on and a busy clinic can draft well over a thousand replies a
// month, so the model choice is what decides whether the add-on is
// profitable at all. The support assistant has run on Sonnet since it
// shipped for the same reason.
const MODEL = 'claude-sonnet-5'
const MAX_TOKENS = 1024

/**
 * How much conversation the model is given.
 *
 * Enough to follow what has been asked and answered, not the whole history:
 * a lead thread is a WhatsApp conversation, and the last dozen turns are what
 * a receptionist picking it up would read before replying.
 */
const HISTORY_TURNS = 24

export type DraftOutcome =
  /** Written to ai_draft_body. */
  | { status: 'drafted'; draft: string }
  /** Sent to the lead by the receptionist itself (`send`); nothing stored. */
  | { status: 'sent'; text: string; handedOver: boolean }
  /** No model key on this deployment -- a normal state, not a failure. */
  | { status: 'unavailable' }
  /** The model declined. An answer, not an error. */
  | { status: 'refused' }
  /** The receptionist is switched off for this account. */
  | { status: 'disabled' }
  /** This lead is not one the receptionist answers. */
  | { status: 'blocked' }
  /** The lead has said nothing new to reply to. */
  | { status: 'nothing_to_answer' }
  /** The lead is gone or not this account's. */
  | { status: 'not_found' }

/**
 * Drafts a reply and stores it, or says why it did not.
 *
 * Returns rather than throws: the cron needs to skip a lead and carry on,
 * and the HTTP route needs to turn the same outcomes into status codes. A
 * shared function that threw would force the cron to catch strings.
 *
 * `calendarClient` reads the free times and must be the service role (see
 * loadReceptionistCalendar): the Inbox button passes one alongside the
 * member's own client, the cron's is already that.
 */
export async function draftLeadReply(
  supabase: any,
  accountId: string,
  leadId: string,
  calendarClient: any = supabase,
  // From the tick, when the clinic's hours switches say the receptionist
  // answers now (utils/receptionistAutoReply.ts): the reply is sent rather
  // than stored -- unless a person is in the conversation, the day's limit is
  // reached, or it is not a WhatsApp conversation, when it drafts as before.
  opts: { send?: { event: H3Event } } = {},
): Promise<DraftOutcome> {
  const { data: lead } = await supabase
    .from('leads')
    // Where they came from, so a reply that depends on it (an ad-only price)
    // is given without asking a question the record already answers.
    .select('id, full_name, ai_state, patient_id, channel, source, external_source, lead_attribution(campaign, ad)')
    .eq('id', leadId)
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!lead) return { status: 'not_found' }

  // 'blocked' is the one state that means "this person does not get answered
  // by us". Honoured here rather than only in the UI: a drafted reply is one
  // click from being sent, so the decision has to hold server-side too.
  if (lead.ai_state === 'blocked') return { status: 'blocked' }

  const { data: configRow } = await supabase
    .from('receptionist_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()
  const config = toConfig(configRow)

  // Checked before the model key: "you turned this off" is something the
  // clinic chose and can undo; "this deployment has no key" is neither.
  if (!config.enabled) return { status: 'disabled' }

  const { data: messages } = await supabase
    .from('whatsapp_messages')
    .select('direction, body_preview, created_at, sent_by_ai, channel, template_name, rule_id, automation_action_id')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_TURNS)

  const ordered = [...(messages ?? [])].reverse()
  const history = ordered
    .filter((m: { body_preview: string | null }) => (m.body_preview ?? '').trim().length > 0)
    .map((m: { direction: string; body_preview: string }) => ({
      role: m.direction === 'inbound' ? ('user' as const) : ('assistant' as const),
      content: m.body_preview,
    }))

  // Nothing to answer. Better than drafting a greeting nobody asked for and
  // presenting it as a reply to something.
  if (history.length === 0 || history[history.length - 1]!.role !== 'user') {
    return { status: 'nothing_to_answer' }
  }

  // The newest inbound message this draft answers. Recorded with the draft so
  // the tick knows it has already read this far, and does not write another
  // one the moment somebody discards this.
  const newestInboundAt = [...ordered].reverse().find((m: { direction: string }) => m.direction === 'inbound')?.created_at ?? null

  // Read as answered, with nothing sent or drafted: the tick moves past it.
  const leaveAlone = async (): Promise<DraftOutcome> => {
    if (newestInboundAt) await supabase.from('leads').update({ ai_draft_body: null, ai_drafted_through_at: newestInboundAt }).eq('id', leadId).eq('account_id', accountId)
    return { status: 'nothing_to_answer' }
  }

  // "Gracias", "Ok", "👍" since the clinic last wrote: the clinic's own list
  // of messages that want no answer, checked before any model is asked.
  const lastOutbound = ordered.map((m: { direction: string }) => m.direction).lastIndexOf('outbound')
  const sinceOurs = ordered.slice(lastOutbound + 1).map((m: { body_preview: string | null }) => m.body_preview ?? '')
  if (isNoReplyMessage(sinceOurs, config.noReplyPhrases)) return leaveAlone()

  const apiKey = useRuntimeConfig().anthropicApiKey
  if (!apiKey) return { status: 'unavailable' }

  // One-to-one on lead_id, so PostgREST embeds an object -- read as either
  // shape, because an array here would otherwise read as "no attribution".
  const attribution = Array.isArray(lead.lead_attribution) ? lead.lead_attribution[0] : lead.lead_attribution
  const leadOrigin: LeadOrigin = {
    channel: lead.channel ?? null,
    source: lead.source ?? null,
    externalSource: lead.external_source ?? null,
    campaign: attribution?.campaign ?? null,
    ad: attribution?.ad ?? null,
  }

  // Which appointment this person is after: a first visit -- the ad's offer
  // when they came from the ad -- unless the lead is somebody who has been
  // to the clinic before, who is never offered a first visit again.
  const audience: ReceptionistAudience = (await hasBeenBefore(supabase, accountId, lead.patient_id))
    ? 'existing'
    : cameFromAd(leadOrigin)
      ? 'new_from_ad'
      : 'new'

  // Read now, not when the receptionist was configured: a type archived or
  // withheld since then is gone from this reply.
  const { types, adOnly } = typesForAudience(await loadOfferedTypes(supabase, accountId, config), audience)
  // A lead who has booked their first visit and wants to move it is offered
  // times for that same visit, offer price and all.
  const booked = await loadBookedVisits(supabase, accountId, lead.patient_id)
  const bookable = uniqueTypes(types, adOnly, booked.types)
  // And the calendar as it is now, so the times offered are ones that are
  // free rather than ones the model made up.
  // A first visit is with whoever is free; somebody who has been before is
  // seen by their own practitioner.
  const practitionerIds = audience === 'existing' ? await loadPatientPractitioners(supabase, accountId, lead.patient_id, booked.practitionerIds) : null
  const calendar = await loadReceptionistCalendar(calendarClient, accountId, config, bookable, undefined, undefined, practitionerIds)
  const findFreeTimes = calendar.availability ? freeTimesLookup(calendarClient, accountId, config, bookable, calendar.timeZone, practitionerIds) : null

  // Sent rather than drafted: asked for, a WhatsApp conversation (the one
  // channel the composer's send reaches for a lead), and nothing holding it
  // back in the conversation itself.
  const lastInbound = [...ordered].reverse().find((m: { direction: string }) => m.direction === 'inbound') as { channel?: string | null } | undefined
  const sends =
    Boolean(opts.send) &&
    (lastInbound?.channel ?? 'whatsapp') === 'whatsapp' &&
    autoReplyHeldBack(
      ordered.map((m: { direction: string; sent_by_ai?: boolean | null; created_at: string; template_name?: string | null; rule_id?: string | null; automation_action_id?: string | null }) => ({ direction: m.direction, sentByAi: m.sent_by_ai === true, automated: Boolean(m.template_name || m.rule_id || m.automation_action_id), createdAt: m.created_at })),
      new Date(),
    ) === null

  // Booking on its own only when it is also answering on its own, and from a
  // calendar it could read: never behind a draft nobody has read yet.
  const book =
    sends && opts.send && calendar.availability
      ? bookingTool({
          event: opts.send.event,
          service: calendarClient,
          accountId,
          config,
          timeZone: calendar.timeZone,
          types: [...types, ...adOnly],
          booked: { appointments: booked.appointments, types: booked.types },
          practitionerIds,
          person: { kind: 'lead', leadId, patientId: lead.patient_id ?? null },
          onBooked: (summary) => noteInConversation(calendarClient, accountId, { kind: 'lead', leadId }, summary),
        })
      : null

  const { text: draft, refused, handedOver } = await runReceptionistModel(createAnthropicClient(apiKey), {
    model: MODEL,
    maxTokens: MAX_TOKENS,
    system: buildSystemPrompt(config, { testMode: false, offeredTypes: types, adOnlyTypes: adOnly, audience, calendar, leadOrigin, searchTool: Boolean(findFreeTimes), bookedVisits: booked.visits, draft: { personName: lead.full_name ?? null }, sendsItself: sends, canBook: Boolean(book) }),
    messages: history,
    findFreeTimes,
    handOver: sends,
    book,
    internalNotes: internalNotes(config),
    logLabel: `lead ${leadId}`,
  })

  // The model judged that nothing needs saying (a thanks the list missed).
  if (!refused && draft && isNoReply(draft)) return leaveAlone()

  // A refusal is the model declining to write this, which is a real answer
  // and not an error -- reported as such rather than dressed up as a failed
  // request or, worse, saved as a reply.
  if (sends && opts.send) {
    const target = { kind: 'lead' as const, leadId }
    const name = lead.full_name ?? 'Lead'
    // Nothing to send: the lead still has a question nobody answers, so it
    // goes to a person now rather than waiting for the next tick to fail too.
    if (refused || !draft) {
      await handToPerson(supabase, accountId, leadId)
      await announceHandover(supabase, accountId, target, name, 'La recepcionista no ha podido responder a su último mensaje.')
      return { status: 'refused' }
    }
    // Recorded BEFORE it is sent: answered up to here, with the words kept as
    // a draft. Cut off after the send but before the record, the next tick
    // used to answer the same message again; now the worst a cut-off can do
    // is leave this draft for a person to send -- never a second reply.
    const { error: recordError } = await supabase.from('leads').update({ ai_draft_body: draft, ai_draft_created_at: new Date().toISOString(), ...(newestInboundAt ? { ai_drafted_through_at: newestInboundAt } : {}) }).eq('id', leadId).eq('account_id', accountId)
    // Not recorded, not sent: a reply it could not mark would be sent again.
    if (recordError) throw new Error(`could not record the reply before sending: ${recordError.message}`)
    try {
      await sendAsReceptionist(opts.send.event, supabase, accountId, target, draft)
    } catch (err) {
      // Refused by WhatsApp (the window closed, a bad number): it stays a
      // draft, so a person still sees what it would have said.
      console.error(`[receptionist] could not send to lead ${leadId}:`, (err as Error)?.message ?? err)
      return { status: 'drafted', draft }
    }
    // Sent: no draft waiting any more.
    await supabase.from('leads').update({ ai_draft_body: null }).eq('id', leadId).eq('account_id', accountId)
    if (handedOver) {
      await handToPerson(supabase, accountId, leadId)
      await announceHandover(supabase, accountId, target, name, handedOver)
    }
    return { status: 'sent', text: draft, handedOver: Boolean(handedOver) }
  }

  if (refused) return { status: 'refused' }

  if (!draft) return { status: 'refused' }

  await supabase
    .from('leads')
    .update({
      ai_draft_body: draft,
      ai_draft_created_at: new Date().toISOString(),
      // Marked even when a person asked for this draft: they have an answer
      // to this message now, and the tick should not write a second one.
      ...(newestInboundAt ? { ai_drafted_through_at: newestInboundAt } : {}),
    })
    .eq('id', leadId)
    .eq('account_id', accountId)

  return { status: 'drafted', draft }
}

/**
 * Whether the lead's patient has had a visit. A lead is linked to a patient
 * once converted, which is usually when they book their first visit -- so
 * "linked" alone is not "been before"; a completed visit is.
 */
async function hasBeenBefore(supabase: any, accountId: string, patientId: string | null): Promise<boolean> {
  if (!patientId) return false
  const { count } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('patient_id', patientId)
    .eq('status', 'completed')
    .is('deleted_at', null)
  return (count ?? 0) > 0
}

/**
 * The lead is a person's now: 'needs_human', which the tick never answers.
 * Only from the states the receptionist answers in, so somebody who took it
 * over meanwhile keeps it.
 */
async function handToPerson(supabase: any, accountId: string, leadId: string) {
  await supabase.from('leads').update({ ai_state: 'needs_human' }).eq('id', leadId).eq('account_id', accountId).in('ai_state', ['handling', 'none'])
}

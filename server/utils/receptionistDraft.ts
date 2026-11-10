import type { H3Event } from 'h3'
import { createAnthropicClient } from '~/server/utils/anthropicClient'
import { overMonthlyLimit, recordReceptionistReply } from '~/server/utils/receptionistUsage'
import { announceHandover, heldBackBeforeSending, noteInConversation, PAST_TIME_REASON, sendAsReceptionist } from '~/server/utils/receptionistSend'
import { bookingTool, cancelTool, giveVisitTool, waitlistTool, type BookingContext } from '~/server/utils/receptionistBooking'
import { recentImages, withImages } from '~/server/utils/receptionistImages'
import { historyLine, standingClockTimes } from '~/utils/receptionistHistory'
import { autoReplyHeldBack, isNoReply, isNoReplyMessage, personActiveUntil, PERSON_ACTIVE_MINUTES, replyActed } from '~/utils/receptionistAutoReply'
import { recordReply, type ReplyOutcome } from '~/server/utils/receptionistTrace'
import { buildSystemPrompt, unmarkedPastVisits, loadBookedVisits, loadChangesWithoutComing, loadClinicDetails, loadOfferedTypes, loadTeamNames, loadPackagePrices, loadPatientCalendar, loadPatientPractitioners, loadTutorChildren, toConfig, uniqueTypes, type LeadOrigin } from '~/server/utils/receptionist'
import { freeTimesLookup, runReceptionistModel, type ReceptionistRun } from '~/server/utils/receptionistModel'
import { cameFromAd } from '~/utils/receptionistLeadOrigin'
import { leadNameIsTheirs, typesForAudience, typesAfterFirstVisit, typesForMinor, typesForReferral, typesForSomeoneTheyBring, type ReceptionistAudience } from '~/utils/receptionistTypes'
import { internalNotes } from '~/utils/receptionistGuard'
import { chosenOfferedTime, chosenTimeNote, isVoiceNote, sendFailedReason, VOICE_NOTE_REASON, VOICE_NOTE_REPLY } from '~/utils/receptionistFollowThrough'

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

/**
 * Where the receptionist may answer a lead on its own. WhatsApp through the
 * Inbox's own send; the website chat and Messenger through theirs
 * (sendAsReceptionist). Instagram stays a draft for a person until its replies
 * have been watched going out from the Inbox for a while.
 */
const AUTO_SEND_CHANNELS = ['whatsapp', 'webchat', 'messenger']

/** Channels a lead writes on without the clinic learning their number. */
const NUMBERLESS_CHANNELS = ['webchat', 'messenger']

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
  /** The clinic's monthly ceiling is reached (receptionist_config.monthly_reply_limit). */
  | { status: 'limit_reached' }

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
  // What everything below is read as of: anything the team does after this,
  // in the conversation or the diary, holds a sent reply back (heldBackBeforeSending).
  const readAt = new Date().toISOString()
  const startedAt = Date.now()
  const { data: lead } = await supabase
    .from('leads')
    // Where they came from, so a reply that depends on it (an ad-only price)
    // is given without asking a question the record already answers.
    .select('id, full_name, email, phone, ai_state, patient_id, channel, source, external_source, lead_attribution(campaign, ad)')
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
    .select('direction, body_preview, created_at, sent_by_ai, channel, template_name, rule_id, automation_action_id, media_type, media_storage_path, media_mime_type, media_filename')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_TURNS)

  const ordered = [...(messages ?? [])].reverse()
  // As the model reads each one: reminders marked as the system's, a voice
  // note or a photo as what it is rather than dropped (historyLine).
  const lineOf = (m: { direction: string; body_preview: string | null; sent_by_ai?: boolean | null; template_name?: string | null; rule_id?: string | null; automation_action_id?: string | null; media_type?: string | null; media_filename?: string | null }) =>
    historyLine({ direction: m.direction, body: m.body_preview, automated: Boolean(m.template_name || m.rule_id || m.automation_action_id), sentByAi: m.sent_by_ai === true, templateName: m.template_name, mediaType: m.media_type, mediaFilename: m.media_filename })
  const history = ordered
    .map((m: Parameters<typeof lineOf>[0]) => ({ role: m.direction === 'inbound' ? ('user' as const) : ('assistant' as const), content: lineOf(m) }))
    .filter((m: { content: string }) => m.content.length > 0)

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
  const sinceOurs = ordered.slice(lastOutbound + 1).map(lineOf)
  const ours = lastOutbound >= 0 ? ordered[lastOutbound] : null
  const ourLast = ours ? { body: ours.body_preview ?? '', automated: Boolean(ours.template_name || ours.rule_id || ours.automation_action_id) } : null
  if (isNoReplyMessage(sinceOurs, config.noReplyPhrases, ourLast)) return leaveAlone()

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
  // Came, for the referral rules: a completed visit. Had a visit, for who
  // they are: a completed one, or at a clinic that does not mark them, one
  // whose time is over (unmarkedPastVisits).
  const cameBefore = await hasBeenBefore(supabase, accountId, lead.patient_id)
  const audience: ReceptionistAudience = cameBefore || (await unmarkedPastVisits(supabase, accountId, lead.patient_id)) > 0
    ? 'existing'
    : cameFromAd(leadOrigin)
      ? 'new_from_ad'
      : 'new'

  // Read now, not when the receptionist was configured: a type archived or
  // withheld since then is gone from this reply.
  const offered = await loadOfferedTypes(supabase, accountId, config)
  const { types, adOnly, regular } = typesForAudience(offered, audience)
  // Or for their child (minorsSection): what a child may have, and the
  // children already on file with them as tutor, once they are a patient.
  const minors = { forNewChild: typesForMinor(offered, false), forReturningChild: typesForMinor(offered, true), children: await loadTutorChildren(supabase, accountId, lead.patient_id ?? null) }
  // Or for someone new they bring, referred by them (someoneTheyBringSection);
  // and someone new may have the referral visit themselves, once they name
  // the patient who referred them (referralSection).
  // Only someone who has been to the clinic refers the person they bring.
  const bringsSomeone = { types: typesForSomeoneTheyBring(offered, cameBefore), referred: cameBefore }
  // What comes after a first visit, for "¿y luego cuánto?" -- from the types
  // and the clinic's bonos, not from a card kept in step by hand.
  const laterPrices = { sessions: typesAfterFirstVisit(offered), packages: await loadPackagePrices(supabase, accountId) }
  // Where the clinic is and when it sees patients, from its settings.
  const clinicDetails = await loadClinicDetails(supabase, accountId)
  // Who sees patients, by name: the prompt reads their gender from it, and a
  // reply calls them by first name (teamSection, fixStyle).
  const team = await loadTeamNames(supabase, accountId)
  const referralTypes = audience === 'existing' ? [] : typesForReferral(offered)
  const referral = referralTypes.length ? { types: referralTypes } : undefined
  // A lead who has booked their first visit and wants to move it is offered
  // times for that same visit, offer price and all.
  const booked = await loadBookedVisits(supabase, accountId, lead.patient_id)
  // The child's first visit too, so its free times are in the list.
  const bookable = uniqueTypes(types, adOnly, booked.types, minors.forNewChild, bringsSomeone.types, referralTypes)
  // And the calendar as it is now, so the times offered are ones that are
  // free rather than ones the model made up.
  // A first visit is with whoever is free; somebody who has been before is
  // seen by their own practitioner.
  // When their own has no free time at all (on leave, say), the times are
  // the rest of the team's, and practitionerIds is what they are really with.
  // Moving a first visit already booked keeps it with its practitioner.
  const own = audience === 'existing' ? await loadPatientPractitioners(supabase, accountId, lead.patient_id, booked.practitionerIds) : booked.practitionerIds.length ? booked.practitionerIds : null
  const { calendar, practitionerIds } = await loadPatientCalendar(calendarClient, accountId, config, bookable, own)
  // Changed twice already without coming: the next change is a person's
  // (repeatChangeSection).
  const changesWithoutComing = await loadChangesWithoutComing(calendarClient as never, accountId, lead.patient_id ?? null, calendar.timeZone)
  const findFreeTimes = calendar.availability ? freeTimesLookup(calendarClient, accountId, config, bookable, calendar.timeZone, practitionerIds) : null

  // Sent rather than drafted: asked for, a conversation on a channel it can
  // send on by itself (AUTO_SEND_CHANNELS), and nothing holding it back in
  // the conversation itself.
  const lastInbound = [...ordered].reverse().find((m: { direction: string }) => m.direction === 'inbound') as { channel?: string | null } | undefined
  const replyChannel = lastInbound?.channel ?? 'whatsapp'
  const asTurns = ordered.map((m: { direction: string; sent_by_ai?: boolean | null; created_at: string; template_name?: string | null; rule_id?: string | null; automation_action_id?: string | null }) => ({ direction: m.direction, sentByAi: m.sent_by_ai === true, automated: Boolean(m.template_name || m.rule_id || m.automation_action_id), createdAt: m.created_at }))
  const mayAutoSend = Boolean(opts.send) && AUTO_SEND_CHANNELS.includes(replyChannel)
  // Why it would not send although it may: somebody from the clinic is in
  // the conversation, or the day's limit is reached.
  const hold = mayAutoSend ? autoReplyHeldBack(asTurns, new Date()) : null
  const sends = mayAutoSend && hold === null
  // Its record (receptionist_reply_traces), at whichever exit it leaves by.
  const record = (outcome: ReplyOutcome, run: ReceptionistRun | null, extra: { handedOver?: boolean; heldUntil?: Date | null } = {}) =>
    recordReply(calendarClient, { accountId, conversationKey: `lead:${leadId}`, kind: 'lead', mode: mayAutoSend ? 'send' : 'draft', outcome, answersThrough: newestInboundAt, run, model: MODEL, startedAt, ...extra })

  // A voice note since the clinic last wrote: always a person's, decided
  // here rather than by the model (utils/receptionistFollowThrough.ts).
  if (ordered.slice(lastOutbound + 1).some((m: { direction: string; media_type?: string | null }) => m.direction === 'inbound' && isVoiceNote(m.media_type))) {
    await supabase.from('leads').update({ ai_draft_body: VOICE_NOTE_REPLY, ai_draft_created_at: new Date().toISOString(), ...(newestInboundAt ? { ai_drafted_through_at: newestInboundAt } : {}) }).eq('id', leadId).eq('account_id', accountId)
    if (!sends || !opts.send) {
      await record('voice_note', null)
      return { status: 'drafted', draft: VOICE_NOTE_REPLY }
    }
    const target = { kind: 'lead' as const, leadId, channel: replyChannel }
    const name = lead.full_name ?? 'Lead'
    await record('voice_note', null, { handedOver: true })
    await handToPerson(supabase, accountId, leadId)
    try {
      await sendAsReceptionist(opts.send.event, supabase, accountId, target, VOICE_NOTE_REPLY)
    } catch (err) {
      console.error(`[receptionist] could not send to lead ${leadId}:`, (err as Error)?.message ?? err)
      await announceHandover(supabase, accountId, target, name, `${VOICE_NOTE_REASON} ${sendFailedReason(err)}`)
      return { status: 'drafted', draft: VOICE_NOTE_REPLY }
    }
    await supabase.from('leads').update({ ai_draft_body: null }).eq('id', leadId).eq('account_id', accountId)
    await announceHandover(supabase, accountId, target, name, VOICE_NOTE_REASON)
    return { status: 'sent', text: VOICE_NOTE_REPLY, handedOver: true }
  }

  // Booking on its own only when it is also answering on its own, and from a
  // calendar it could read: never behind a draft nobody has read yet.
  const actions: BookingContext | null =
    sends && opts.send && calendar.availability
      ? {
          event: opts.send.event,
          service: calendarClient,
          accountId,
          config,
          timeZone: calendar.timeZone,
          types: [...types, ...adOnly],
          booked: { appointments: booked.appointments, types: booked.types },
          changesWithoutComing,
          practitionerIds,
          person: { kind: 'lead', leadId, patientId: lead.patient_id ?? null },
          minors,
          bringsSomeone,
          referral,
          onBooked: (summary) => noteInConversation(calendarClient, accountId, { kind: 'lead', leadId }, summary),
        }
      : null
  const book = actions ? bookingTool(actions) : null
  const waitlist = actions ? waitlistTool(actions) : null
  const cancel = actions ? cancelTool(actions) : null
  const give = actions ? giveVisitTool(actions) : null
  // What they sent since the clinic last wrote, pictures included.
  const images = await recentImages(calendarClient, ordered.slice(lastOutbound + 1))

  // Their answer can only be one of the times it just offered: said so in the
  // prompt, so it books rather than asking "¿te confirmo?" again (5 Nov 2026).
  const offer = ours && ours.direction === 'outbound' && ours.sent_by_ai === true && !ourLast?.automated ? ours.body_preview ?? '' : ''
  const chosen = offer ? chosenOfferedTime(offer, ordered.slice(lastOutbound + 1).filter((m: { direction: string }) => m.direction === 'inbound').map((m: { body_preview: string | null }) => m.body_preview ?? '').join(' ')) : null
  const withChosenTime = <P extends { conversation: string }>(prompt: P): P => (chosen ? { ...prompt, conversation: `${prompt.conversation}\n\n${chosenTimeNote(chosen, Boolean(book))}` } : prompt)

  // The clinic's monthly ceiling, if it set one: checked before the model is
  // asked, because the model call is what the ceiling is there to stop.
  if (await overMonthlyLimit(supabase, accountId, config.monthlyReplyLimit)) return { status: 'limit_reached' }

  const run = await runReceptionistModel(await createAnthropicClient(apiKey, { feature: 'receptionist_lead', accountId }), {
    model: MODEL,
    maxTokens: MAX_TOKENS,
    system: withChosenTime(buildSystemPrompt(config, { testMode: false, offeredTypes: types, adOnlyTypes: adOnly, regularFirstVisit: regular, audience, calendar, leadOrigin, searchTool: Boolean(findFreeTimes), bookedVisits: booked.visits, changesWithoutComing, draft: { personName: lead.full_name ?? null }, knownDetails: { name: leadNameIsTheirs(lead.channel) && Boolean(lead.full_name?.trim()), email: Boolean(lead.email?.trim()), phone: !(NUMBERLESS_CHANNELS.includes(lead.channel) && !lead.phone) }, sendsItself: sends, canBook: Boolean(book), canWaitlist: Boolean(waitlist), minors, bringsSomeone: { ...bringsSomeone, canGive: Boolean(give) }, referral, laterPrices, clinicDetails, team })),
    messages: withImages(history, images),
    findFreeTimes,
    handOver: sends,
    book,
    waitlist,
    cancel,
    give,
    maxTimesPerReply: config.slotsPerReply,
    standingTimes: standingClockTimes(booked.appointments, calendar.timeZone),
    internalNotes: internalNotes(config),
    teamNames: team,
    logLabel: `lead ${leadId}`,
  })
  const { text: draft, refused, handedOver, toolUses } = run

  // The model judged that nothing needs saying (a thanks the list missed).
  if (!refused && draft && isNoReply(draft)) {
    await record('no_reply', run)
    return leaveAlone()
  }

  // Counted for the monthly allowance: every reply it writes, sent or left as
  // a draft -- writing it is what cost money, whatever happens to it next.
  if (!refused && draft) await recordReceptionistReply(supabase, accountId, `lead:${leadId}`, sends && opts.send ? 'sent' : 'draft')

  // A refusal is the model declining to write this, which is a real answer
  // and not an error -- reported as such rather than dressed up as a failed
  // request or, worse, saved as a reply.
  if (sends && opts.send) {
    const target = { kind: 'lead' as const, leadId, channel: replyChannel }
    const name = lead.full_name ?? 'Lead'
    // Nothing to send: the lead still has a question nobody answers, so it
    // goes to a person now rather than waiting for the next tick to fail too.
    if (refused || !draft) {
      await record('refused', run, { handedOver: true })
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
    // Read again now: written from a diary or a conversation that has moved
    // on, it stays the draft recorded above rather than going out.
    const heldBack = await heldBackBeforeSending(calendarClient, accountId, { patientId: lead.patient_id ?? null, leadId }, readAt, draft, calendar.timeZone, replyActed(toolUses) ? null : newestInboundAt)
    // They wrote again meanwhile: answered whole on the next tick, which sees
    // a message newer than ai_drafted_through_at and no draft in the way.
    if (heldBack === 'newer_message') {
      await record('superseded', run)
      await supabase.from('leads').update({ ai_draft_body: null }).eq('id', leadId).eq('account_id', accountId)
      return { status: 'nothing_to_answer' }
    }
    if (heldBack === 'past_time') {
      await record('held_past_time', run, { handedOver: true })
      await handToPerson(supabase, accountId, leadId)
      await announceHandover(supabase, accountId, target, name, PAST_TIME_REASON)
    }
    // A person is on it ('person', 'diary'): a draft for them, picked up again
    // once the hold ends if nobody has answered by then (resumeHeldReplies).
    if (heldBack === 'person' || heldBack === 'diary') {
      await record(heldBack === 'person' ? 'held_person' : 'held_diary', run, { heldUntil: new Date(Date.now() + PERSON_ACTIVE_MINUTES * 60_000) })
    }
    if (heldBack) return { status: 'drafted', draft }
    try {
      await sendAsReceptionist(opts.send.event, supabase, accountId, target, draft)
    } catch (err) {
      // Refused by WhatsApp (the window closed, a bad number): it stays a
      // draft, so a person still sees what it would have said.
      console.error(`[receptionist] could not send to lead ${leadId}:`, (err as Error)?.message ?? err)
      await record('send_failed', run, { handedOver: true })
      // And a person is told, rather than finding the draft by chance.
      await handToPerson(supabase, accountId, leadId)
      await announceHandover(supabase, accountId, target, name, sendFailedReason(err))
      return { status: 'drafted', draft }
    }
    // Sent: no draft waiting any more.
    await record('sent', run)
    await supabase.from('leads').update({ ai_draft_body: null }).eq('id', leadId).eq('account_id', accountId)
    // It answers leads on 'none' too (the ones in the Inbox before it was
    // switched on), but only 'handling' wears the "AI handling" chip -- so
    // half the conversations it was answering looked like nobody's. Once it
    // has written to them, they are its.
    await supabase.from('leads').update({ ai_state: 'handling' }).eq('id', leadId).eq('account_id', accountId).eq('ai_state', 'none')
    if (handedOver) {
      await handToPerson(supabase, accountId, leadId)
      await announceHandover(supabase, accountId, target, name, handedOver)
    }
    return { status: 'sent', text: draft, handedOver: Boolean(handedOver) }
  }

  if (refused || !draft) {
    await record('refused', run)
    return { status: 'refused' }
  }

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

  // Held back although it may send on its own: a person is in the
  // conversation (picked up again once the hold ends), or the day's limit.
  if (hold === 'person') await record('held_person', run, { heldUntil: personActiveUntil(asTurns) })
  else if (hold === 'limit') await record('held_limit', run)
  else await record('drafted', run)
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

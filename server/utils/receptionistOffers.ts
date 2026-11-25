import { bookingTool, type BookingContext, type OfferDraft } from '~/server/utils/receptionistBooking'
import type { ReceptionistRun } from '~/server/utils/receptionistModel'
import { announceHandover, type ReceptionistTarget } from '~/server/utils/receptionistSend'
import type { SlotLanguage } from '~/utils/receptionistConversion'
import { wallClockToUtc } from '~/utils/clinicClock'
import { ACCEPTED_DETAILS_WAIT_MINUTES, ACCEPTED_HOLD_HOURS, ACCEPTED_UNBOOKED_MINUTES, OFFER_OPEN_DAYS, acceptedHeldReason, acceptedUnbookedReason, confirmationInWords, confirmationIsPlain, heldTimeNote, matchAcceptedSlot, type BookedDetails, type StoredOffer, type StoredOfferSlot } from '~/utils/receptionistOffers'
import { findTypeByName } from '~/utils/receptionistTypes'

// The receptionist's offers as rows (receptionist_offers), and what code does
// with them without asking the model: keep one when it is sent, book the
// time somebody accepts from it, and notice one accepted that the diary does
// not have. utils/receptionistOffers.ts says why.
//
// Not in the generated types (receptionistTrace.ts reads its table the same
// way), so the clients are `any` here.

const DAY_MS = 24 * 3600_000

/**
 * Keeps an offer that has just been sent. One open offer per conversation: a
 * newer one replaces the older, whose buttons are still on their phone but
 * no longer what the clinic is offering.
 */
export async function keepOffer(service: any, accountId: string, conversationKey: string, offer: OfferDraft | null | undefined): Promise<void> {
  if (!offer?.slots.length) return
  try {
    await service.from('receptionist_offers').update({ status: 'superseded', resolved_at: new Date().toISOString() }).eq('account_id', accountId).eq('conversation_key', conversationKey).eq('status', 'open')
    const { error } = await service.from('receptionist_offers').insert({
      account_id: accountId,
      conversation_key: conversationKey,
      slots: offer.slots,
      type_name: offer.typeName,
      move_visit_on: offer.moveVisitOn,
      pinned: offer.pinned,
      any_chiropractor: offer.anyChiropractor,
      auto: offer.auto,
    })
    if (error) console.error('[receptionist] could not keep the offered times:', error.message)
  } catch (err) {
    // Best-effort: without the row, a time accepted is the model's to book, as before.
    console.error('[receptionist] could not keep the offered times:', (err as Error)?.message ?? err)
  }
}

type OfferRow = { id: string; account_id: string; conversation_key: string; slots: StoredOfferSlot[] | null; type_name: string | null; move_visit_on: string | null; pinned: boolean | null; any_chiropractor: boolean | null; auto: boolean | null; created_at: string }

function toOffer(row: OfferRow): StoredOffer {
  return { id: row.id, createdAt: row.created_at, slots: Array.isArray(row.slots) ? row.slots : [], typeName: row.type_name, moveVisitOn: row.move_visit_on, pinned: row.pinned === true, anyChiropractor: row.any_chiropractor === true, auto: row.auto === true }
}

/** The conversation's open offer, if it has one still worth accepting. */
export async function loadOpenOffer(service: any, accountId: string, conversationKey: string, now = new Date()): Promise<StoredOffer | null> {
  try {
    const { data } = await service
      .from('receptionist_offers')
      .select('id, account_id, conversation_key, slots, type_name, move_visit_on, pinned, any_chiropractor, auto, created_at')
      .eq('account_id', accountId)
      .eq('conversation_key', conversationKey)
      .eq('status', 'open')
      .gt('created_at', new Date(now.getTime() - OFFER_OPEN_DAYS * DAY_MS).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return data ? toOffer(data as OfferRow) : null
  } catch (err) {
    console.error('[receptionist] could not read the offered times:', (err as Error)?.message ?? err)
    return null
  }
}

/** What a time accepted from an offer came to. */
export type AcceptedOffer =
  /** Booked, and confirmed in words written here: the reply, with no model asked. */
  | { kind: 'reply'; run: ReceptionistRun }
  /** Booked, but the confirmation needs the model's words (a repeated late change): the visit, to hand it. */
  | { kind: 'booked'; input: Record<string, unknown>; details: BookedDetails; note: string }
  /**
   * Chosen, but not something the code can book alone -- for someone else, or
   * for someone new whose details are missing: held for them, and the model
   * told to book it or ask only for what is missing (heldTimeNote).
   */
  | { kind: 'held'; slot: StoredOfferSlot; note: string }

/**
 * Books the time they accepted from the receptionist's last offer, in code.
 *
 * Only when there is no doubt left for a model to settle:
 * - the last thing the clinic said was that offer, sent by the receptionist
 *   -- anything said after it, by anyone, and the conversation has moved on;
 * - the offer is one the code may book from (`auto`): for the person
 *   writing, a type or a visit to move it resolved, every time checked free;
 * - what they wrote since is one of its times and nothing else
 *   (matchAcceptedSlot): a tapped button, or words that can mean only one;
 * - someone not yet a patient has their name, email and number on record
 *   (`newPersonReady`); otherwise the model asks for them first.
 *
 * It books through book_appointment's own handler, with the offer's own
 * type, visit and chiropractor, so every rule that tool enforces holds here
 * too. Refused for any reason -- the time went, the visit was moved
 * meanwhile, a rule says it is a person's -- nothing is booked and null comes
 * back: the model answers as it always has, and is told why.
 */
export async function acceptOfferedTime(opts: {
  service: any
  accountId: string
  conversationKey: string
  actions: BookingContext
  /** The clinic's last message in the conversation. */
  ours: { createdAt: string; sentByAi: boolean; automated: boolean } | null
  /** What they wrote since it. */
  inbound: string[]
  language: SlotLanguage
  newPersonReady: boolean
}): Promise<AcceptedOffer | null> {
  if (!opts.ours || !opts.ours.sentByAi || opts.ours.automated) return null
  const offer = await loadOpenOffer(opts.service, opts.accountId, opts.conversationKey)
  // Kept right after its message was sent: a message newer than the offer is something said since.
  if (!offer || new Date(offer.createdAt).getTime() < new Date(opts.ours.createdAt).getTime()) return null
  const slot = matchAcceptedSlot(offer.slots, opts.inbound)
  if (!slot) return null
  // Theirs, but the booking needs something the code does not have: the
  // time is held while the model gets it, never offered away meanwhile.
  if (!offer.auto || !opts.newPersonReady) return holdChosenTime(opts.service, opts.accountId, opts.conversationKey, slot, offer, opts.actions)

  const input: Record<string, unknown> = {
    date: slot.date,
    time: slot.time,
    ...(offer.moveVisitOn ? { move_visit_on: offer.moveVisitOn } : { appointment_type: offer.typeName }),
    ...(!offer.moveVisitOn && offer.pinned && slot.practitionerName ? { chiropractor: slot.practitionerName } : {}),
    ...(!offer.moveVisitOn && offer.anyChiropractor ? { any_chiropractor: true } : {}),
  }
  let result: Awaited<ReturnType<ReturnType<typeof bookingTool>>>
  try {
    // Its own handler: the model's, should it be asked after all, starts clean.
    result = await bookingTool(opts.actions)(input)
  } catch (err) {
    console.error(`[receptionist] could not book the accepted time in ${opts.conversationKey}:`, (err as Error)?.message ?? err)
    return null
  }
  if (result.isError || !result.booked) {
    console.info(`[receptionist] the accepted time in ${opts.conversationKey} was not booked in code; the model answers`)
    return null
  }
  if (!confirmationIsPlain(result.booked)) return { kind: 'booked', input, details: result.booked, note: result.content }
  return {
    kind: 'reply',
    run: {
      text: confirmationInWords(result.booked, opts.language),
      refused: false,
      handedOver: null,
      toolUses: [{ name: 'book_appointment', input, ok: true }],
      checks: ['accepted_in_code'],
      choices: null,
      offeredSlots: [],
      offer: null,
      booked: result.booked,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0, rounds: 0 },
      inCode: true,
    },
  }
}

/**
 * Holds the one time they chose (receptionist_slot_holds) for
 * ACCEPTED_HOLD_HOURS, never past the time itself, in place of the
 * twenty-minute holds of the whole offer. Best-effort: a hold that cannot be
 * written still leaves the note, and the booking itself refuses a time gone.
 */
async function holdChosenTime(service: any, accountId: string, conversationKey: string, slot: StoredOfferSlot, offer: StoredOffer, actions: BookingContext): Promise<AcceptedOffer> {
  const start = wallClockToUtc(slot.date, slot.time, actions.timeZone)
  const until = Math.min(start, Date.now() + ACCEPTED_HOLD_HOURS * 3600_000)
  const type = findTypeByName([...actions.types, ...actions.booked.types], offer.typeName)
  const minutes = type?.durationMinutes || Math.max(30, ...[...actions.booked.types, ...actions.types].map((t) => t.durationMinutes || 0))
  try {
    await service.from('receptionist_slot_holds').delete().eq('account_id', accountId).eq('conversation_key', conversationKey)
    const { error } = await service.from('receptionist_slot_holds').insert({ account_id: accountId, conversation_key: conversationKey, starts_at: new Date(start).toISOString(), ends_at: new Date(start + minutes * 60_000).toISOString(), expires_at: new Date(until).toISOString() })
    if (error) console.error('[receptionist] could not hold the chosen time:', error.message)
  } catch (err) {
    console.error('[receptionist] could not hold the chosen time:', (err as Error)?.message ?? err)
  }
  const heldUntil = new Date(until).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: actions.timeZone })
  return { kind: 'held', slot, note: heldTimeNote(slot, heldUntil) }
}

/** What the model is told when the code booked the visit and the words are its own (AcceptedOffer 'booked'). */
export function alreadyBookedNote(note: string): string {
  return `# Already done\nThey accepted one of the times you offered, and the clinic's system has already made the change: ${note}\nDo not call book_appointment for it. Write the reply that tells them.`
}

/** Offers looked at per tick. */
const MAX_PER_TICK = 50
/** Older than this, WhatsApp's 24-hour window is closing and the offer is history. */
const MAX_AGE_HOURS = 20

/**
 * A time somebody accepted that the diary does not have.
 *
 * Whatever went wrong between their answer and the booking -- the tick cut
 * off, an error thrown, a case nobody thought of -- the result is the same
 * and it is the one thing this must never leave alone: a person who chose a
 * time and has neither the visit nor an answer. Run from
 * handover-reminder-cron, every 15 minutes. For each open offer:
 * - what they wrote since is not one of its times: nothing to do here;
 * - the visit is in the diary: the offer is closed;
 * - anybody has written to them since they accepted (the receptionist asking
 *   for their name, a person at the desk): the conversation is being had;
 * - otherwise, ten minutes on, a person is told which time they accepted --
 *   the usual handover: note, push, task -- and the receptionist stays out.
 */
export async function handOverAcceptedUnbooked(supabase: any, now = new Date()): Promise<{ key: string; outcome: string }[]> {
  const { data, error } = await supabase
    .from('receptionist_offers')
    .select('id, account_id, conversation_key, slots, type_name, move_visit_on, pinned, any_chiropractor, auto, created_at')
    .eq('status', 'open')
    .gt('created_at', new Date(now.getTime() - MAX_AGE_HOURS * 3600_000).toISOString())
    .lte('created_at', new Date(now.getTime() - ACCEPTED_UNBOOKED_MINUTES * 60_000).toISOString())
    .order('created_at')
    .limit(MAX_PER_TICK)
  if (error) {
    console.error('[receptionist] could not read the open offers:', error.message)
    return []
  }
  const done: { key: string; outcome: string }[] = []
  for (const row of (data ?? []) as OfferRow[]) {
    try {
      const outcome = await checkOne(supabase, row, now)
      if (outcome) done.push({ key: row.conversation_key, outcome })
    } catch (err) {
      console.error(`[receptionist] could not check the offer in ${row.conversation_key}:`, (err as Error)?.message ?? err)
    }
  }
  return done
}

async function checkOne(supabase: any, row: OfferRow, now: Date): Promise<string | null> {
  const offer = toOffer(row)
  const leadId = row.conversation_key.startsWith('lead:') ? row.conversation_key.slice(5) : null
  let patientId = leadId ? null : row.conversation_key
  const settle = async (status: 'booked' | 'superseded' | 'alerted') => {
    // Claimed: a second tick that read the same row finds it taken.
    const { data } = await supabase.from('receptionist_offers').update({ status, resolved_at: new Date().toISOString() }).eq('id', row.id).eq('status', 'open').select('id')
    return (data ?? []).length > 0
  }

  // What they wrote since the offer, oldest first.
  const since = (table: string, column: string, id: string, body: string) =>
    supabase.from(table).select(`${body}, created_at`).eq('account_id', row.account_id).eq(column, id).eq('direction', 'inbound').gt('created_at', row.created_at).order('created_at').limit(5)
  const inbound: { text: string; at: string; app: boolean }[] = []
  if (leadId) {
    const { data } = await since('whatsapp_messages', 'lead_id', leadId, 'body_preview')
    for (const m of (data ?? []) as { body_preview: string | null; created_at: string }[]) inbound.push({ text: m.body_preview ?? '', at: m.created_at, app: false })
  } else if (patientId) {
    const [{ data: wa }, { data: app }] = await Promise.all([since('whatsapp_messages', 'patient_id', patientId, 'body_preview'), since('patient_app_messages', 'patient_id', patientId, 'body')])
    for (const m of (wa ?? []) as { body_preview: string | null; created_at: string }[]) inbound.push({ text: m.body_preview ?? '', at: m.created_at, app: false })
    for (const m of (app ?? []) as { body: string | null; created_at: string }[]) inbound.push({ text: m.body ?? '', at: m.created_at, app: true })
    inbound.sort((a, b) => a.at.localeCompare(b.at))
  }
  if (!inbound.length) return null
  const slot = matchAcceptedSlot(offer.slots, inbound.map((m) => m.text))
  if (!slot) return null
  const acceptedAt = inbound[inbound.length - 1]!.at
  // The tick that answers them has had its time.
  if (new Date(acceptedAt).getTime() > now.getTime() - ACCEPTED_UNBOOKED_MINUTES * 60_000) return null

  let name = 'Paciente'
  if (leadId) {
    const { data: lead } = await supabase.from('leads').select('full_name, patient_id, ai_state').eq('id', leadId).eq('account_id', row.account_id).maybeSingle()
    if (!lead) return (await settle('superseded')) ? 'gone' : null
    patientId = lead.patient_id ?? null
    name = lead.full_name ?? 'Lead'
    // A person has it already.
    if (!['handling', 'none'].includes(lead.ai_state)) return (await settle('superseded')) ? 'person' : null
  }

  // The visit is there: at that minute, theirs, still booked.
  if (patientId) {
    const { data: clinics } = await supabase.from('clinics').select('timezone').eq('account_id', row.account_id).is('archived_at', null).order('created_at').limit(1)
    const timeZone = ((clinics ?? []) as { timezone: string | null }[])[0]?.timezone || 'Europe/Madrid'
    const startsAt = new Date(wallClockToUtc(slot.date, slot.time, timeZone)).toISOString()
    const { data: visits } = await supabase.from('appointments').select('id').eq('account_id', row.account_id).eq('patient_id', patientId).eq('starts_at', startsAt).eq('status', 'booked').is('deleted_at', null).limit(1)
    if ((visits ?? []).length) return (await settle('booked')) ? 'booked' : null
    if (!leadId) {
      const { data: patient } = await supabase.from('patients').select('first_name').eq('id', patientId).eq('account_id', row.account_id).maybeSingle()
      name = patient?.first_name ?? name
      const { data: draft } = await supabase.from('inbox_reply_drafts').select('handed_over_at').eq('account_id', row.account_id).eq('conversation_key', patientId).maybeSingle()
      if (draft?.handed_over_at && draft.handed_over_at > row.created_at) return (await settle('superseded')) ? 'person' : null
    }
  }

  // Somebody has written to them since they accepted. A person: the
  // conversation is theirs. Only the receptionist -- asking for the name of
  // the person the visit is for, or their own details -- and nothing back
  // for ACCEPTED_DETAILS_WAIT_MINUTES: the time they chose is held and still
  // not booked, which is the case this job exists for (13 Nov 2026: a
  // daughter's name asked, no answer, no visit). A booking settles the offer
  // ('booked'), so an open one here has none.
  const wrote = (table: string, column: string, id: string) => supabase.from(table).select('created_at, sent_by_ai').eq('account_id', row.account_id).eq(column, id).eq('direction', 'outbound').gt('created_at', acceptedAt).order('created_at').limit(20)
  const answers = leadId
    ? [wrote('whatsapp_messages', 'lead_id', leadId)]
    : [wrote('whatsapp_messages', 'patient_id', patientId!), wrote('patient_app_messages', 'patient_id', patientId!)]
  const written = (await Promise.all(answers)).flatMap(({ data: rows }: { data: { created_at: string; sent_by_ai: boolean | null }[] | null }) => rows ?? [])
  let reason = acceptedUnbookedReason(slot)
  if (written.length) {
    if (written.some((m) => m.sent_by_ai !== true)) return (await settle('superseded')) ? 'answered' : null
    // The inbound read above stops at the time they chose; anything after the receptionist's question is an answer being handled.
    const lastAsked = written.map((m) => m.created_at).sort().at(-1)!
    const answeredSince = await (leadId
      ? since('whatsapp_messages', 'lead_id', leadId, 'body_preview').gt('created_at', lastAsked).then(({ data }: { data: unknown[] | null }) => (data ?? []).length > 0)
      : Promise.all([since('whatsapp_messages', 'patient_id', patientId!, 'body_preview').gt('created_at', lastAsked), since('patient_app_messages', 'patient_id', patientId!, 'body').gt('created_at', lastAsked)]).then((res: { data: unknown[] | null }[]) => res.some(({ data }) => (data ?? []).length > 0)))
    if (answeredSince) return null
    if (new Date(lastAsked).getTime() > now.getTime() - ACCEPTED_DETAILS_WAIT_MINUTES * 60_000) return null
    reason = acceptedHeldReason(slot)
  }

  if (!(await settle('alerted'))) return null
  const at = new Date().toISOString()
  const app = inbound[inbound.length - 1]!.app
  let target: ReceptionistTarget
  if (leadId) {
    await supabase.from('leads').update({ ai_state: 'needs_human' }).eq('id', leadId).eq('account_id', row.account_id).in('ai_state', ['handling', 'none'])
    target = { kind: 'lead', leadId }
  } else {
    await supabase.from('inbox_reply_drafts').upsert({ account_id: row.account_id, conversation_key: patientId, body: '-', drafted_through_at: acceptedAt, dismissed_at: at, handed_over_at: at })
    target = { kind: 'patient', patientId: patientId!, channel: app ? 'app' : 'whatsapp' }
  }
  await announceHandover(supabase, row.account_id, target, name, reason)
  return 'handed_over'
}

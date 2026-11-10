import type { H3Event } from 'h3'
import { loadReceptionistCalendar, readAccountTypes, toConfig, toOfferedType } from '~/server/utils/receptionist'
import { receptionistServiceClient } from '~/server/utils/receptionistAudit'
import { noteInConversation, sendAsReceptionist } from '~/server/utils/receptionistSend'
import { pushAppointmentEvent } from '~/server/utils/staffPush'
import { runActionsList, type ActionRow, type PatientForAction } from '~/server/utils/runAutomationActions'
import { clinicOpenAt } from '~/utils/receptionistAutoReply'
import { clinicDateOf, DEFAULT_CLINIC_TIMEZONE, wallClockToUtc } from '~/utils/clinicClock'
import type { BusinessHours } from '~/utils/businessHours'
import {
  EARLIER_VISIT_MIN_NOTICE_HOURS,
  EARLIER_VISIT_TEMPLATE,
  earlierOfferExpiresAt,
  earlierOfferReply,
  earlierSearchWindow,
  earlierVisitLanguage,
  earlierVisitReplyText,
  earlierVisitWhen,
  firstFreeCandidate,
  mayOfferToday,
} from '~/utils/earlierVisitOffer'

// Offering an earlier time to someone whose first visit is days away, and
// acting on their answer. Who is enrolled is the database's call (triggers in
// 20261110194512_earlier_first_visit_offers.sql); this decides when to write
// to them, with which time, and what a tap on the template's buttons does.
//
// Run from the waitlist sweep (api/waitlist/expire-cron, every 15 minutes)
// rather than from each cancellation: Columnaquiro does not offer cancelled
// slots to the waitlist automatically, a slot freed at 22:00 must wait for the
// morning, and a time can free up in ways that are not a cancellation at all
// (a visit moved, a block removed). Looking at the diary as it is catches all
// of them; a cancellation is at most a quarter of an hour from an offer.

const PATIENT_COLUMNS =
  'id, first_name, last_name, email, is_minor, do_not_contact, marketing_channels, date_of_birth, address, city, postal_code, country, national_id, occupation, gender, emergency_contact, preferred_language'

interface OfferRow {
  id: string
  account_id: string
  status: string
  offers_made: number
  last_offered_at: string | null
  appointments: {
    id: string
    clinic_id: string
    patient_id: string
    practitioner_id: string | null
    appointment_type_id: string | null
    starts_at: string
    status: string
    clinics: { timezone: string | null; business_hours: BusinessHours | null } | null
  } | null
}

const CLEARED = { offered_starts_at: null, offered_ends_at: null, offer_expires_at: null }

/**
 * One pass: lapse unanswered offers, then offer a time to everyone enrolled
 * who may have one today. Never throws; returns what it did.
 */
export async function sweepEarlierVisitOffers(event: H3Event, service: any, origin: string, now = new Date()): Promise<{ lapsed: number; offered: number }> {
  let lapsed = 0
  let offered = 0
  try {
    // Unanswered: back to waiting, so the time can go to somebody else and
    // they can be offered another one -- tomorrow at the earliest.
    const { data: gone } = await service
      .from('earlier_visit_offers')
      .update({ status: 'waiting', ...CLEARED, updated_at: now.toISOString() })
      .eq('status', 'offered')
      .lt('offer_expires_at', now.toISOString())
      .select('id')
    lapsed = gone?.length ?? 0

    const { data: accounts } = await service.from('accounts').select('id').eq('earlier_first_visit_offers', true)
    const accountIds = ((accounts ?? []) as { id: string }[]).map((a) => a.id)
    if (accountIds.length === 0) return { lapsed, offered }

    const { data: rows } = await service
      .from('earlier_visit_offers')
      .select('id, account_id, status, offers_made, last_offered_at, appointments!inner(id, clinic_id, patient_id, practitioner_id, appointment_type_id, starts_at, status, clinics(timezone, business_hours))')
      .in('account_id', accountIds)
      .eq('status', 'waiting')
      .order('created_at', { ascending: true })
    for (const row of (rows ?? []) as OfferRow[]) {
      try {
        if (await offerEarlierTime(service, origin, row, now)) offered++
      } catch (err) {
        console.error(`[earlier-visit] could not offer for ${row.id}:`, (err as Error)?.message ?? err)
      }
    }
  } catch (err) {
    console.error('[earlier-visit] sweep failed:', (err as Error)?.message ?? err)
  }
  return { lapsed, offered }
}

/** Finds a time for one enrolled visit and, if there is one, sends it. True when an offer went out. */
async function offerEarlierTime(service: any, origin: string, row: OfferRow, now: Date): Promise<boolean> {
  const appt = row.appointments
  if (!appt || appt.status !== 'booked' || !appt.practitioner_id || !appt.appointment_type_id) return false
  const timeZone = appt.clinics?.timezone || DEFAULT_CLINIC_TIMEZONE

  // Never at night: a clinic with hours set is written to only while open.
  // Hours not set read as open, as the receptionist reads them.
  if (clinicOpenAt(now, timeZone, appt.clinics?.business_hours) === false) return false
  const today = clinicDateOf(now, timeZone)
  if (!mayOfferToday({ offers_made: row.offers_made, lastOfferedDay: row.last_offered_at ? clinicDateOf(new Date(row.last_offered_at), timeZone) : null }, today)) return false

  const window = earlierSearchWindow(now, new Date(appt.starts_at))
  if (!window) return false

  const { data: patient } = await service.from('patients').select(PATIENT_COLUMNS).eq('id', appt.patient_id).maybeSingle()
  if (!patient) return false
  if (patient.do_not_contact) {
    await service.from('earlier_visit_offers').update({ status: 'closed', closed_reason: 'do_not_contact', updated_at: now.toISOString() }).eq('id', row.id).eq('status', 'waiting')
    return false
  }

  const slot = await earliestFreeTime(service, row.account_id, appt as Required<NonNullable<OfferRow['appointments']>> & { practitioner_id: string; appointment_type_id: string }, window, now, timeZone)
  if (!slot) return false
  const expiresAt = earlierOfferExpiresAt(now, slot.startsAt)
  if (!expiresAt) return false

  // Guarded on 'waiting': a second sweep running over this one, or the visit
  // changing in between, leaves the row alone.
  const { data: claimed } = await service
    .from('earlier_visit_offers')
    .update({
      status: 'offered',
      offered_starts_at: slot.startsAt.toISOString(),
      offered_ends_at: slot.endsAt.toISOString(),
      offer_expires_at: expiresAt.toISOString(),
      offers_made: row.offers_made + 1,
      last_offered_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', row.id)
    .eq('status', 'waiting')
    .select('id')
    .maybeSingle()
  if (!claimed) return false

  // The automation runner's own WhatsApp send: the minor's tutor, the consent
  // check, the variant in the reader's language (es, fr, en), the Inbox row
  // with the text as sent. A step built in memory, as "Send test to me" does.
  const action: ActionRow = {
    id: 'earlier-visit-offer',
    action_type: 'whatsapp_template',
    config: {
      template_name: EARLIER_VISIT_TEMPLATE,
      template_language: 'es',
      match_patient_language: true,
      variables: [{ source: 'first_name' }, { source: 'earlier_slot_datetime' }, { source: 'earlier_visit_datetime' }],
    },
  }
  const problems = await runActionsList(service, row.account_id, [action], patient as PatientForAction, origin, false, appt.id, undefined, undefined, {
    earlierSlotAt: slot.startsAt.toISOString(),
    earlierVisitAt: appt.starts_at,
  })
  if (problems.length > 0) {
    // Not sent: the time is not held for somebody who never heard of it. The
    // attempt still counts towards the day and the cap, so a template Meta
    // has not approved yet is tried once a day, not every quarter of an hour.
    console.error(`[earlier-visit] offer for ${row.id} not sent: ${problems.join(' | ')}`)
    await service.from('earlier_visit_offers').update({ status: 'waiting', ...CLEARED }).eq('id', row.id).eq('status', 'offered')
    return false
  }
  return true
}

/**
 * The earliest time in `window` the visit's own practitioner has free for
 * its type, by the same diary the receptionist offers from (working hours,
 * visits at every clinic, blocks, the type's length for that practitioner),
 * and not already on offer to anybody else.
 */
async function earliestFreeTime(
  service: any,
  accountId: string,
  appt: { id: string; clinic_id: string; practitioner_id: string; appointment_type_id: string },
  window: { from: Date; to: Date },
  now: Date,
  timeZone: string,
): Promise<{ startsAt: Date; endsAt: Date } | null> {
  const [{ data: types }, { data: configRow }, { data: override }] = await Promise.all([
    readAccountTypes(service, accountId),
    service.from('receptionist_config').select('*').eq('account_id', accountId).maybeSingle(),
    service.from('appointment_type_overrides').select('duration_minutes').eq('account_id', accountId).eq('appointment_type_id', appt.appointment_type_id).eq('team_member_id', appt.practitioner_id).maybeSingle(),
  ])
  const typeRow = ((types ?? []) as Parameters<typeof toOfferedType>[0][]).find((t) => t.id === appt.appointment_type_id)
  if (!typeRow) return null
  const type = toOfferedType(typeRow)
  // A type only some practitioners do, and not theirs: loadReceptionistCalendar
  // would widen to the ones who do, and the time would be with someone else.
  if (type.practitionerIds?.length && !type.practitionerIds.includes(appt.practitioner_id)) return null
  const durationMinutes = override?.duration_minutes || type.durationMinutes

  const base = toConfig(configRow)
  const config = { ...base, minimumNoticeMinutes: Math.max(base.minimumNoticeMinutes, EARLIER_VISIT_MIN_NOTICE_HOURS * 60) }
  const days = Math.max(1, Math.ceil((window.to.getTime() - window.from.getTime()) / 86400000))
  const calendar = await loadReceptionistCalendar(service, accountId, config, [type], now, { from: window.from, days, maxTimesPerList: 1000 }, [appt.practitioner_id])
  const candidates: { startsAt: Date; endsAt: Date }[] = []
  for (const group of calendar.availability?.groups ?? []) {
    if (group.clinicId !== appt.clinic_id || !group.types.some((t) => (t as { id?: string }).id === type.id)) continue
    for (const day of group.days) {
      for (const time of day.times) {
        const startsAt = new Date(wallClockToUtc(day.date, time, timeZone))
        candidates.push({ startsAt, endsAt: new Date(startsAt.getTime() + durationMinutes * 60000) })
      }
    }
  }
  if (candidates.length === 0) return null

  // Times already promised to somebody else and not yet answered: another
  // first visit's offer, or a waitlist offer, with the same practitioner.
  const [{ data: ours }, { data: waitlist }] = await Promise.all([
    service
      .from('earlier_visit_offers')
      .select('offered_starts_at, offered_ends_at, appointments!inner(practitioner_id)')
      .eq('account_id', accountId)
      .eq('status', 'offered')
      .eq('appointments.practitioner_id', appt.practitioner_id),
    service
      .from('waitlist_entries')
      .select('offered_starts_at, offered_ends_at')
      .eq('account_id', accountId)
      .eq('status', 'offered')
      .eq('offered_practitioner_id', appt.practitioner_id),
  ])
  const onOffer = [...((ours ?? []) as { offered_starts_at: string | null; offered_ends_at: string | null }[]), ...((waitlist ?? []) as { offered_starts_at: string | null; offered_ends_at: string | null }[])]
    .filter((o) => o.offered_starts_at && o.offered_ends_at)
    .map((o) => ({ startsAt: new Date(o.offered_starts_at!), endsAt: new Date(o.offered_ends_at!) }))
  return firstFreeCandidate(candidates, window, onOffer)
}

/**
 * A tap on the template's "Sí, adelantar" / "No, me quedo con la mía" (or
 * their French and English), from `writerId`'s phone. True when it was one
 * of those taps, answered here -- the webhook then reads nothing else into
 * it (a "Sí" is not the reminder's Confirmar). Free text is left to the
 * receptionist, which has the offer in front of it.
 */
export async function answerEarlierVisitTap(event: H3Event, service: any, accountId: string, writerId: string, text: string, quotedWamid: string | null): Promise<boolean> {
  const answer = earlierOfferReply(text)
  if (!answer) return false

  // Which visit: the template the tap quotes (a button tap always quotes it),
  // else the last one sent to this patient.
  let appointmentId: string | null = null
  if (quotedWamid) {
    const { data: quoted } = await service.from('whatsapp_messages').select('appointment_id, template_name').eq('account_id', accountId).eq('wamid', quotedWamid).maybeSingle()
    if (!quoted || quoted.template_name !== EARLIER_VISIT_TEMPLATE) return false
    appointmentId = quoted.appointment_id
  } else {
    const { data: last } = await service
      .from('whatsapp_messages')
      .select('appointment_id')
      .eq('account_id', accountId)
      .eq('patient_id', writerId)
      .eq('template_name', EARLIER_VISIT_TEMPLATE)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    appointmentId = last?.appointment_id ?? null
  }
  if (!appointmentId) return false

  const [{ data: row }, { data: appt }, { data: writer }] = await Promise.all([
    service.from('earlier_visit_offers').select('id, status, offered_starts_at, offered_ends_at, offer_expires_at').eq('account_id', accountId).eq('appointment_id', appointmentId).maybeSingle(),
    service.from('appointments').select('id, starts_at, ends_at, status, clinics(timezone)').eq('id', appointmentId).maybeSingle(),
    service.from('patients').select('preferred_language').eq('id', writerId).maybeSingle(),
  ])
  if (!row || !appt) return false
  const timeZone = (appt.clinics as { timezone: string | null } | null)?.timezone || DEFAULT_CLINIC_TIMEZONE
  const language = earlierVisitLanguage(writer?.preferred_language)
  const kept = earlierVisitWhen(appt.starts_at, timeZone, language)
  const target = { kind: 'patient' as const, patientId: writerId, channel: 'whatsapp' as const }
  const reply = async (text: string) => {
    try {
      await sendAsReceptionist(event, service, accountId, target, text)
    } catch (err) {
      console.error(`[earlier-visit] could not answer ${writerId}:`, (err as Error)?.message ?? err)
    }
  }

  if (answer === 'decline') {
    if (row.status === 'waiting' || row.status === 'offered') {
      await service.from('earlier_visit_offers').update({ status: 'declined', ...CLEARED, closed_reason: 'patient_said_no', updated_at: new Date().toISOString() }).eq('id', row.id)
      await reply(earlierVisitReplyText('declined', language, { kept }))
    }
    return true
  }

  const open = row.status === 'offered' && row.offered_starts_at && row.offered_ends_at && (!row.offer_expires_at || new Date(row.offer_expires_at).getTime() > Date.now())
  if (!open || appt.status !== 'booked') {
    // Already moved by this offer: the tap was a second one. Say nothing new.
    if (row.status !== 'accepted') await reply(earlierVisitReplyText('gone', language, { kept }))
    return true
  }

  // Taken before it is written, so a double tap moves the visit once.
  const { data: claimed } = await service.from('earlier_visit_offers').update({ status: 'accepted', offer_expires_at: null, updated_at: new Date().toISOString() }).eq('id', row.id).eq('status', 'offered').select('id').maybeSingle()
  if (!claimed) return true

  // Under the booking lock every path takes, checking the practitioner, the
  // room and blocked time together with the write: the diary may have changed
  // since the offer went out. Written as the receptionist, so the audit trail
  // and the "changed by someone else" check name it.
  const { error } = await (receptionistServiceClient(event) as any).rpc('save_appointment_if_free', {
    p_account_id: accountId,
    p_appointment_id: appt.id,
    p_values: { starts_at: row.offered_starts_at, ends_at: row.offered_ends_at, rescheduled: true },
    p_check_overlap: true,
    p_check_room: true,
    p_check_blocks: true,
  })
  if (error) {
    console.info(`[earlier-visit] ${appt.id}: offered time no longer free (${error.message})`)
    await service.from('earlier_visit_offers').update({ status: 'waiting', ...CLEARED, updated_at: new Date().toISOString() }).eq('id', row.id).eq('status', 'accepted')
    await reply(earlierVisitReplyText('taken', language, { kept }))
    return true
  }

  const moved = earlierVisitWhen(row.offered_starts_at, timeZone, language)
  try {
    await pushAppointmentEvent(service, appt.id, 'rescheduled')
    await noteInConversation(service, accountId, target, `He adelantado su primera visita del ${earlierVisitWhen(appt.starts_at, timeZone, 'es')} al ${earlierVisitWhen(row.offered_starts_at, timeZone, 'es')}: ha aceptado el hueco que le ofrecimos por WhatsApp.`)
  } catch (err) {
    console.error('[earlier-visit] after moving:', (err as Error)?.message ?? err)
  }
  await reply(earlierVisitReplyText('moved', language, { moved, kept }))
  return true
}

/**
 * What the receptionist is told about a patient's first visit and earlier
 * times: an offer open right now, or that they are on the list for one.
 * Null when neither.
 */
export async function loadEarlierVisitFacts(
  service: any,
  accountId: string,
  patientId: string,
): Promise<{ status: 'waiting' | 'offered'; visitAt: string; offeredAt: string | null; expiresAt: string | null } | null> {
  const { data } = await service
    .from('earlier_visit_offers')
    .select('status, offered_starts_at, offer_expires_at, appointments!inner(patient_id, starts_at)')
    .eq('account_id', accountId)
    .eq('appointments.patient_id', patientId)
    .in('status', ['waiting', 'offered'])
    .limit(1)
    .maybeSingle()
  if (!data) return null
  const appt = data.appointments as { starts_at: string } | null
  if (!appt) return null
  const offered = data.status === 'offered' && data.offer_expires_at && new Date(data.offer_expires_at).getTime() > Date.now()
  return { status: offered ? 'offered' : 'waiting', visitAt: appt.starts_at, offeredAt: offered ? data.offered_starts_at : null, expiresAt: offered ? data.offer_expires_at : null }
}

/** They told the receptionist they do not want earlier times offered. True when there was something to stop. */
export async function stopEarlierVisitOffers(service: any, accountId: string, patientIds: string[]): Promise<boolean> {
  if (patientIds.length === 0) return false
  const { data: rows } = await service
    .from('earlier_visit_offers')
    .select('id, appointments!inner(patient_id)')
    .eq('account_id', accountId)
    .in('appointments.patient_id', patientIds)
    .in('status', ['waiting', 'offered'])
  const ids = ((rows ?? []) as { id: string }[]).map((r) => r.id)
  if (ids.length === 0) return false
  const { error } = await service.from('earlier_visit_offers').update({ status: 'declined', ...CLEARED, closed_reason: 'told_the_receptionist', updated_at: new Date().toISOString() }).in('id', ids)
  if (error) {
    console.error('[earlier-visit] could not stop offers:', error.message)
    return false
  }
  return true
}

/** Whether a visit just booked was enrolled, so the receptionist tells them an earlier time may be offered. */
export async function earlierVisitEnrolled(service: any, appointmentId: string): Promise<boolean> {
  const { data } = await service.from('earlier_visit_offers').select('id').eq('appointment_id', appointmentId).eq('status', 'waiting').maybeSingle()
  return Boolean(data)
}

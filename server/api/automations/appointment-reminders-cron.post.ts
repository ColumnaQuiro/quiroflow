import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import {
  appointmentReminderDecision,
  effectiveReminderHours,
  lateReminderMinLeadHours,
  reminderCandidateRange,
  type ReminderCandidate,
} from '~/utils/appointmentReminderDue'

// Same reasoning and auth pattern as birthday-cron.post.ts: reminders have no
// client action to fire from (nothing happens N hours before an appointment
// except time passing), so a pg_cron job hits this on a schedule instead --
// the actual cron.schedule(...) registration needs this deployment's real
// URL/secret and, like birthday-cron's, is applied directly against the
// hosted project rather than tracked in a migration. Run every 15 minutes
// (appointment-reminders-15min).
//
// Which appointments are due, and why the rule is "from N hours before,
// once per appointment time" rather than a window N hours out, is in
// utils/appointmentReminderDue.ts. N is the patient's own
// appointment_reminder_hours_before when set, the clinic's otherwise.
//
// Bookings made without staff whose confirmation nobody sent. The patient
// app books through create_patient_booking and calls nothing afterwards, so
// its bookings were never confirmed; the public page's own call may fail.
// Picked up here within a quarter of an hour. Not the last two minutes,
// which belong to the page's own call.
const CATCH_UP_MIN_AGE_MINUTES = 2
const CATCH_UP_MAX_AGE_MINUTES = 60
// The longest lead either setting allows (pages/settings/messages.vue, and
// the check on patients.appointment_reminder_hours_before).
const MAX_REMINDER_HOURS = 168
// Bounded rather than one-at-a-time so a tick with many due appointments
// across many accounts still finishes within the 15-minute schedule as the
// account base grows -- see server/utils/concurrency.ts for why this stays
// conservative instead of maxing out the shared send-provider rate limit.
const SEND_CONCURRENCY = 5

type CandidateRow = ReminderCandidate & {
  id: string
  account_id: string
  patients: { appointment_reminder_hours_before: number | null } | null
  accounts: { appointment_reminder_hours_before: number | null } | null
}

const CANDIDATE_COLUMNS =
  'id, account_id, starts_at, created_at, confirmation_sent_at, reminder_claimed_at, rescheduled, patients!inner(appointment_reminder_hours_before), accounts!inner(appointment_reminder_enabled, appointment_reminder_hours_before)'

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const supabase = serverSupabaseServiceRole<Database>(event)

  const now = Date.now()
  const nowDate = new Date(now)

  // Confirmations first: a booking the patient app made a few minutes ago,
  // inside its reminder time, is confirmed here, and the reminder below then
  // sees that confirmation and does not repeat it.
  const { data: unconfirmed } = await supabase
    .from('appointments')
    .select('id, account_id, source')
    .in('source', ['online', 'api'])
    .eq('status', 'booked')
    // Deleted within the catch-up window: nothing to confirm any more.
    .is('deleted_at', null)
    .is('auto_confirmation_claimed_at', null)
    .is('confirmation_sent_at', null)
    .gte('created_at', new Date(now - CATCH_UP_MAX_AGE_MINUTES * 60 * 1000).toISOString())
    .lt('created_at', new Date(now - CATCH_UP_MIN_AGE_MINUTES * 60 * 1000).toISOString())
  const caughtUp = (unconfirmed ?? []) as { id: string; account_id: string; source: string }[]
  await mapWithConcurrency(caughtUp, SEND_CONCURRENCY, async (appt) => {
    if (!(await claimAutomaticConfirmation(supabase, appt.id))) return
    // The clinic's alert, for an online booking nothing has alerted about yet:
    // the patient app's, which go through no endpoint of ours, and any the
    // booking page's own request missed. Claimed separately, because
    // book.post.ts alerts without touching the confirmation claim.
    if (appt.source === 'online' && (await claimStaffAlert(supabase, appt.id))) {
      await notifyStaffOfOnlineBooking(supabase, appt.account_id, appt.id)
    }
    await sendAppointmentConfirmation(supabase, appt.account_id, appt.id)
  })

  // Asked per reminder setting, not per account. It was one select of the
  // accounts -- which stops at PostgREST's 1,000-row cap without saying so,
  // so past a thousand clinics the rest were never reminded -- and then two
  // queries per account. Clinics share a handful of settings (24 hours, 48...),
  // so this is a few queries whatever the number of clinics.
  const settings = new Set<number>()
  for (let from = 0; ; from += 1000) {
    const { data: page } = await supabase
      .from('accounts')
      .select('appointment_reminder_hours_before')
      .eq('appointment_reminder_enabled', true)
      .order('id')
      .range(from, from + 999)
    for (const a of page ?? []) settings.add(effectiveReminderHours(null, a.appointment_reminder_hours_before))
    if (!page || page.length < 1000) break
  }

  // Every page of unclaimed, upcoming appointments matching `filter`, at
  // clinics with reminders on.
  async function candidates(range: { from: Date; to: Date }, filter: (q: any) => any) {
    const rows: CandidateRow[] = []
    for (let from = 0; ; from += 1000) {
      const { data: page } = await filter(
        supabase
          .from('appointments')
          .select(CANDIDATE_COLUMNS)
          .eq('accounts.appointment_reminder_enabled', true)
          .eq('status', 'booked')
          // "Eliminar cita" sets deleted_at and leaves status 'booked', so
          // without this a deleted appointment still got its reminder.
          .is('deleted_at', null)
          .is('reminder_claimed_at', null)
          .gte('starts_at', range.from.toISOString())
          .lte('starts_at', range.to.toISOString()),
      )
        .order('id')
        .range(from, from + 999)
      rows.push(...((page ?? []) as unknown as CandidateRow[]))
      if (!page || page.length < 1000) break
    }
    return rows
  }

  const found = new Map<string, CandidateRow>()
  // Patients on the clinic's setting, a query per setting.
  for (const hoursBefore of settings) {
    const rows = await candidates(reminderCandidateRange(hoursBefore, nowDate), (q) =>
      q.eq('accounts.appointment_reminder_hours_before', hoursBefore).is('patients.appointment_reminder_hours_before', null),
    )
    for (const row of rows) found.set(row.id, row)
  }
  // Patients with their own setting: few, so one query over the widest range
  // either could need, and the verdict below sorts out whose time has come.
  const overridden = await candidates(
    { from: new Date(now + lateReminderMinLeadHours(1) * 60 * 60 * 1000), to: reminderCandidateRange(MAX_REMINDER_HOURS, nowDate).to },
    (q) => q.not('patients.appointment_reminder_hours_before', 'is', null),
  )
  for (const row of overridden) found.set(row.id, row)

  let sent = 0
  let skipped = 0
  await mapWithConcurrency([...found.values()], SEND_CONCURRENCY, async (appt) => {
    const hoursBefore = effectiveReminderHours(appt.patients?.appointment_reminder_hours_before, appt.accounts?.appointment_reminder_hours_before)
    const decision = appointmentReminderDecision(appt, hoursBefore, nowDate)
    if (decision !== 'send' && decision !== 'skip') return
    // A skip is claimed too: it is final for this appointment time, and
    // claimed it stops being fetched on every tick until the visit.
    if (!(await claimAppointmentReminder(supabase, appt.id, appt.starts_at))) return
    if (decision === 'skip') {
      skipped++
      return
    }
    sent++
    await sendAppointmentReminder(supabase, appt.account_id, appt.id)
  })

  return { sent, skipped, confirmationsCaughtUp: caughtUp.length }
})

import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Same reasoning and auth pattern as birthday-cron.post.ts: reminders have no
// client action to fire from (nothing happens N hours before an appointment
// except time passing), so a pg_cron job hits this on a schedule instead --
// the actual cron.schedule(...) registration needs this deployment's real
// URL/secret and, like birthday-cron's, is applied directly against the
// hosted project rather than tracked in a migration. Run every 15 minutes;
// the window below has a matching buffer so a slightly late/early tick still
// catches every appointment exactly once (reminder_sent_at is the guard
// against ever sending it twice).
const WINDOW_BUFFER_MINUTES = 20
// A visit booked inside its own reminder window -- tomorrow morning, booked
// tonight with reminders at 24h -- never passed through the window, so it
// never got a reminder. It gets one now, unless its confirmation already
// told the patient the same thing, and not in the last couple of hours
// before the visit, when a reminder is only noise.
const LATE_REMINDER_MIN_LEAD_HOURS = 2
// Bookings made without staff whose confirmation nobody sent. The patient
// app books through create_patient_booking and calls nothing afterwards, so
// its bookings were never confirmed; the public page's own call may fail.
// Picked up here within a quarter of an hour. Not the last two minutes,
// which belong to the page's own call.
const CATCH_UP_MIN_AGE_MINUTES = 2
const CATCH_UP_MAX_AGE_MINUTES = 60
// reminder_sent_at is kept when an appointment is moved (the panel's History
// tab reads it), so it can belong to the old time. A reminder for the time
// being looked at now can only have gone out on a tick inside this window,
// i.e. within the last WINDOW_BUFFER_MINUTES; one older than this is for a
// time the appointment has since been moved from, and does not count.
const STALE_REMINDER_MINUTES = 60
// Bounded rather than one-at-a-time so a tick with many due appointments
// across many accounts still finishes within the 15-minute schedule as the
// account base grows -- see server/utils/concurrency.ts for why this stays
// conservative instead of maxing out the shared send-provider rate limit.
const SEND_CONCURRENCY = 5

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const supabase = serverSupabaseServiceRole<Database>(event)

  const now = Date.now()
  const staleBefore = new Date(now - STALE_REMINDER_MINUTES * 60 * 1000).toISOString()
  const dueAppointments: { accountId: string; appointmentId: string }[] = []

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
    for (const a of page ?? []) settings.add(a.appointment_reminder_hours_before ?? 24)
    if (!page || page.length < 1000) break
  }

  // Every page of appointments matching `filter`, for the clinics with this
  // setting and reminders on.
  async function dueFor(hoursBefore: number, filter: (q: any) => any) {
    const rows: { id: string; account_id: string }[] = []
    for (let from = 0; ; from += 1000) {
      const { data: page } = await filter(
        supabase
          .from('appointments')
          .select('id, account_id, accounts!inner(appointment_reminder_enabled, appointment_reminder_hours_before)')
          .eq('accounts.appointment_reminder_enabled', true)
          .eq('accounts.appointment_reminder_hours_before', hoursBefore)
          .eq('status', 'booked')
          // "Eliminar cita" sets deleted_at and leaves status 'booked', so
          // without this a deleted appointment still got its reminder.
          .is('deleted_at', null),
      )
        .order('id')
        .range(from, from + 999)
      rows.push(...((page ?? []) as { id: string; account_id: string }[]))
      if (!page || page.length < 1000) break
    }
    return rows
  }

  for (const hoursBefore of settings) {
    const windowStart = new Date(now + hoursBefore * 60 * 60 * 1000).toISOString()
    const windowEnd = new Date(now + hoursBefore * 60 * 60 * 1000 + WINDOW_BUFFER_MINUTES * 60 * 1000).toISOString()

    const inWindow = await dueFor(hoursBefore, (q) =>
      q.or(`reminder_sent_at.is.null,reminder_sent_at.lt.${staleBefore}`).gte('starts_at', windowStart).lt('starts_at', windowEnd),
    )
    // Created since the window opened for it: those the window above could
    // never have reached.
    const bookedLate = await dueFor(hoursBefore, (q) =>
      q
        .is('reminder_sent_at', null)
        .is('confirmation_sent_at', null)
        .gte('created_at', new Date(now - hoursBefore * 60 * 60 * 1000).toISOString())
        .gte('starts_at', new Date(now + LATE_REMINDER_MIN_LEAD_HOURS * 60 * 60 * 1000).toISOString())
        .lt('starts_at', windowStart),
    )
    for (const appt of [...inWindow, ...bookedLate]) dueAppointments.push({ accountId: appt.account_id, appointmentId: appt.id })
  }

  await mapWithConcurrency(dueAppointments, SEND_CONCURRENCY, (due) => sendAppointmentReminder(supabase, due.accountId, due.appointmentId))

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

  return { sent: dueAppointments.length, confirmationsCaughtUp: caughtUp.length }
})

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

  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, appointment_reminder_hours_before')
    .eq('appointment_reminder_enabled', true)
  if (!accounts || accounts.length === 0) return { sent: 0 }

  const now = Date.now()
  const dueAppointments: { accountId: string; appointmentId: string }[] = []

  for (const account of accounts) {
    const hoursBefore = account.appointment_reminder_hours_before ?? 24
    const windowStart = new Date(now + hoursBefore * 60 * 60 * 1000).toISOString()
    const windowEnd = new Date(now + hoursBefore * 60 * 60 * 1000 + WINDOW_BUFFER_MINUTES * 60 * 1000).toISOString()

    const { data: appointments } = await supabase
      .from('appointments')
      .select('id')
      .eq('account_id', account.id)
      .eq('status', 'booked')
      .is('reminder_sent_at', null)
      .gte('starts_at', windowStart)
      .lt('starts_at', windowEnd)

    for (const appt of appointments ?? []) dueAppointments.push({ accountId: account.id, appointmentId: appt.id })
  }

  await mapWithConcurrency(dueAppointments, SEND_CONCURRENCY, (due) => sendAppointmentReminder(supabase, due.accountId, due.appointmentId))

  return { sent: dueAppointments.length }
})

import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { ruleFiltersMatch, type AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { runRuleActions } from '~/server/utils/runAutomationActions'
import { DEFAULT_CLINIC_TIMEZONE, localDay } from '~/utils/clinicClock'

// Fires 'appointment.same_day' for every booked appointment happening today,
// for accounts with an enabled rule on that trigger -- same reasoning/auth
// pattern as birthday-cron.post.ts: "is this appointment today" has no
// client action to hang off of. Meant to be scheduled every 15 minutes, same
// as appointment-reminders-cron.post.ts, but only does anything inside the
// SEND_HOUR window below -- 9:00 where EACH CLINIC is (clinics.timezone), over
// that clinic's own day. It used to be 9:00 in Madrid for everyone, which
// sent a Canary Islands clinic's messages at 8:00 its time.
const SEND_HOUR = 9
const WINDOW_BUFFER_MINUTES = 20
// See server/utils/concurrency.ts -- bounds how many appointments' actions
// run at once so one send window across many accounts still finishes
// promptly without approaching the shared send-provider rate limit.
const SEND_CONCURRENCY = 5

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const now = new Date()
  const windowStart = SEND_HOUR * 60
  const inWindow = (tz: string) => {
    const { minutesSinceMidnight } = localDay(now, tz)
    return minutesSinceMidnight >= windowStart && minutesSinceMidnight < windowStart + WINDOW_BUFFER_MINUTES
  }

  const supabase = serverSupabaseServiceRole<Database>(event)

  const { data: rules } = await supabase
    .from('automation_rules')
    .select('id, account_id, filters')
    .eq('trigger_event', 'appointment.same_day')
    .eq('enabled', true)
  if (!rules || rules.length === 0) return { sent: 0 }

  const accountIds = [...new Set(rules.map((r) => r.account_id))]

  // Each time zone the accounts' clinics are in is its own window and its
  // own "today"; a zone not at 9:00 right now has nothing to send this tick.
  const { data: clinics } = await supabase.from('clinics').select('id, timezone').in('account_id', accountIds)
  const clinicsByZone = new Map<string, string[]>()
  for (const c of clinics ?? []) {
    const tz = c.timezone || DEFAULT_CLINIC_TIMEZONE
    clinicsByZone.set(tz, [...(clinicsByZone.get(tz) ?? []), c.id])
  }
  const dueZones = [...clinicsByZone.entries()].filter(([tz]) => inWindow(tz))
  if (dueZones.length === 0) return { sent: 0, skipped: 'outside send window' }

  const appointments: { id: string; account_id: string; patient_id: string }[] = []
  for (const [tz, clinicIds] of dueZones) {
    const { start, end } = localDay(now, tz)
    const { data } = await supabase
      .from('appointments')
      .select('id, account_id, patient_id')
      .in('account_id', accountIds)
      .in('clinic_id', clinicIds)
      .eq('status', 'booked')
      .is('same_day_info_sent_at', null)
      .gte('starts_at', start.toISOString())
      .lt('starts_at', end.toISOString())
    appointments.push(...(data ?? []))
  }
  if (appointments.length === 0) return { sent: 0 }

  const patientIds = [...new Set(appointments.map((a) => a.patient_id))]
  const { data: patients } = await supabase
    .from('patients')
    .select('id, first_name, last_name, email, is_minor, do_not_contact, marketing_channels, date_of_birth, address, city, postal_code, country, national_id, occupation, gender, emergency_contact')
    .in('id', patientIds)
  const patientsById = new Map((patients ?? []).map((p) => [p.id, p]))

  const origin = getRequestURL(event).origin

  const sentFlags = await mapWithConcurrency(appointments, SEND_CONCURRENCY, async (appt) => {
    const patient = patientsById.get(appt.patient_id)
    if (!patient) return false
    const accountRules = rules.filter((r) => r.account_id === appt.account_id)

    let matched = false
    for (const rule of accountRules) {
      if (!(await ruleFiltersMatch(supabase, patient.id, rule.filters as AutomationFilters, appt.id))) continue
      await runRuleActions(supabase, appt.account_id, rule.id, patient, origin, appt.id)
      matched = true
    }

    if (matched) await supabase.from('appointments').update({ same_day_info_sent_at: new Date().toISOString() }).eq('id', appt.id)
    return matched
  })

  return { sent: sentFlags.filter(Boolean).length }
})

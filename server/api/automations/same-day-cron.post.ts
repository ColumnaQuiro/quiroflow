import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { ruleFiltersMatch, type AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { runRuleActions } from '~/server/utils/runAutomationActions'

// Fires 'appointment.same_day' for every booked appointment happening today,
// for accounts with an enabled rule on that trigger -- same reasoning/auth
// pattern as birthday-cron.post.ts: "is this appointment today" has no
// client action to hang off of. Meant to be scheduled every 15 minutes, same
// as appointment-reminders-cron.post.ts, but only does anything inside the
// SEND_HOUR window below -- there's no per-account timezone column, so
// "local" is hardcoded to Europe/Madrid, read from the actual wall-clock at
// each tick (correct across the DST transition, unlike a fixed UTC offset).
const SEND_HOUR = 9
const WINDOW_BUFFER_MINUTES = 20
const CLINIC_TIMEZONE = 'Europe/Madrid'

function clinicWallClock(now: Date) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: CLINIC_TIMEZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]))
  return { hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) }
}

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const now = new Date()
  const { hour, minute, second } = clinicWallClock(now)
  const minutesSinceMidnight = hour * 60 + minute
  const windowStart = SEND_HOUR * 60
  if (minutesSinceMidnight < windowStart || minutesSinceMidnight >= windowStart + WINDOW_BUFFER_MINUTES) {
    return { sent: 0, skipped: 'outside send window' }
  }

  const supabase = serverSupabaseServiceRole<Database>(event)

  const { data: rules } = await supabase
    .from('automation_rules')
    .select('id, account_id, filters')
    .eq('trigger_event', 'appointment.same_day')
    .eq('enabled', true)
  if (!rules || rules.length === 0) return { sent: 0 }

  const accountIds = [...new Set(rules.map((r) => r.account_id))]

  // "Today" in the clinic's timezone, expressed as a UTC instant range --
  // derived from now's actual local wall-clock reading rather than a fixed
  // offset, so the boundary stays correct across the DST transition.
  const secondsSinceMidnight = hour * 3600 + minute * 60 + second
  const todayStart = new Date(now.getTime() - secondsSinceMidnight * 1000)
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)

  const { data: appointments } = await supabase
    .from('appointments')
    .select('id, account_id, patient_id')
    .in('account_id', accountIds)
    .eq('status', 'booked')
    .is('same_day_info_sent_at', null)
    .gte('starts_at', todayStart.toISOString())
    .lt('starts_at', todayEnd.toISOString())
  if (!appointments || appointments.length === 0) return { sent: 0 }

  const patientIds = [...new Set(appointments.map((a) => a.patient_id))]
  const { data: patients } = await supabase
    .from('patients')
    .select('id, first_name, last_name, email, is_minor, do_not_contact, marketing_channels')
    .in('id', patientIds)
  const patientsById = new Map((patients ?? []).map((p) => [p.id, p]))

  const origin = getRequestURL(event).origin
  let sent = 0

  for (const appt of appointments) {
    const patient = patientsById.get(appt.patient_id)
    if (!patient) continue
    const accountRules = rules.filter((r) => r.account_id === appt.account_id)

    let matched = false
    for (const rule of accountRules) {
      if (!(await ruleFiltersMatch(supabase, patient.id, rule.filters as AutomationFilters, appt.id))) continue
      await runRuleActions(supabase, appt.account_id, rule.id, patient, origin, appt.id)
      matched = true
    }

    if (matched) {
      await supabase.from('appointments').update({ same_day_info_sent_at: new Date().toISOString() }).eq('id', appt.id)
      sent += 1
    }
  }

  return { sent }
})

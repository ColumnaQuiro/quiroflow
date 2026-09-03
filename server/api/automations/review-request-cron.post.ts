import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { ruleFiltersMatch, type AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { runRuleActions } from '~/server/utils/runAutomationActions'

// Fires the appointment.review_request campaign trigger -- "please leave us
// a Google review" sent a few days after a visit, once the patient has had
// time to feel the benefit. Same shape as hours-before-cron.post.ts but
// looking backward from a completed appointment's end time instead of
// forward from a booked one's start time, and on a days scale instead of
// hours. Reuses automation_rule_sends for its per-(rule, appointment)
// "already sent" guard -- that table was already generic enough (rule_id +
// appointment_id) that a second time-based trigger didn't need its own.
const WINDOW_BUFFER_MINUTES = 20
const SEND_CONCURRENCY = 5
const DEFAULT_DAYS_AFTER = 2

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const supabase = serverSupabaseServiceRole<Database>(event)

  const { data: rules } = await supabase
    .from('automation_rules')
    .select('id, account_id, filters')
    .eq('trigger_event', 'appointment.review_request')
    .eq('enabled', true)
  if (!rules || rules.length === 0) return { sent: 0 }

  const now = Date.now()
  const origin = getRequestURL(event).origin

  const dueByRule: { ruleId: string; accountId: string; appointmentId: string; patientId: string }[] = []

  for (const rule of rules) {
    const filters = (rule.filters ?? {}) as AutomationFilters
    const daysAfter = filters.days_after ?? DEFAULT_DAYS_AFTER
    const windowStart = new Date(now - daysAfter * 24 * 60 * 60 * 1000).toISOString()
    const windowEnd = new Date(now - daysAfter * 24 * 60 * 60 * 1000 + WINDOW_BUFFER_MINUTES * 60 * 1000).toISOString()

    // ends_at, not starts_at: "N days after the visit" means N days after it
    // actually happened, and there's no separate completed_at timestamp on
    // appointments -- same proxy same-day-cron.post.ts uses in the other
    // direction.
    const { data: appointments } = await supabase
      .from('appointments')
      .select('id, patient_id')
      .eq('account_id', rule.account_id)
      .eq('status', 'completed')
      .gte('ends_at', windowStart)
      .lt('ends_at', windowEnd)
    if (!appointments || appointments.length === 0) continue

    // Excludes appointments this specific rule already fired for -- a
    // separate rule on the same trigger (a different days_after) still gets
    // its own independent chance at the same appointment.
    const { data: alreadySent } = await supabase
      .from('automation_rule_sends')
      .select('appointment_id')
      .eq('rule_id', rule.id)
      .in('appointment_id', appointments.map((a) => a.id))
    const sentIds = new Set((alreadySent ?? []).map((s) => s.appointment_id))

    for (const appt of appointments) {
      if (sentIds.has(appt.id)) continue
      dueByRule.push({ ruleId: rule.id, accountId: rule.account_id, appointmentId: appt.id, patientId: appt.patient_id })
    }
  }
  if (dueByRule.length === 0) return { sent: 0 }

  const patientIds = [...new Set(dueByRule.map((d) => d.patientId))]
  const { data: patients } = await supabase
    .from('patients')
    .select('id, first_name, last_name, email, is_minor, do_not_contact, marketing_channels')
    .in('id', patientIds)
  const patientsById = new Map((patients ?? []).map((p) => [p.id, p]))

  const rulesById = new Map(rules.map((r) => [r.id, r]))

  const sentFlags = await mapWithConcurrency(dueByRule, SEND_CONCURRENCY, async (due) => {
    const patient = patientsById.get(due.patientId)
    if (!patient) return false
    const rule = rulesById.get(due.ruleId)
    if (!rule) return false
    if (!(await ruleFiltersMatch(supabase, patient.id, rule.filters as AutomationFilters, due.appointmentId))) return false

    await runRuleActions(supabase, due.accountId, due.ruleId, patient, origin, due.appointmentId)
    // Best-effort: a duplicate insert (unique(rule_id, appointment_id)) can
    // only happen from two overlapping cron ticks racing the same row, in
    // which case the actions already fired twice regardless of this insert
    // succeeding -- not worth failing the whole request over.
    await supabase.from('automation_rule_sends').insert({ rule_id: due.ruleId, appointment_id: due.appointmentId }).select().maybeSingle()
    return true
  })

  return { sent: sentFlags.filter(Boolean).length }
})

import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { ruleFiltersMatch, type AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { dispatchPatientRule } from '~/server/utils/automationEngine'

// Fires the appointment.review_request campaign trigger -- "please leave us
// a Google review" sent a few days after a visit, once the patient has had
// time to feel the benefit. Same shape as hours-before-cron.post.ts but
// looking backward from a completed appointment's end time instead of
// forward from a booked one's start time, and on a days scale instead of
// hours. Reuses automation_rule_sends for its per-(rule, appointment)
// "already sent" guard -- that table was already generic enough (rule_id +
// appointment_id) that a second time-based trigger didn't need its own.
//
// It also fires appointment.satisfaction, the other "after the visit"
// trigger ("¿qué tal te hemos atendido?"), so that one needed no cron of its
// own to schedule: hours rather than days after, only on the patient's first
// visit and every Nth, and never twice in SATISFACTION_GAP_DAYS for the same
// patient (satisfactionDue below).
const WINDOW_BUFFER_MINUTES = 20
const SEND_CONCURRENCY = 5
const DEFAULT_DAYS_AFTER = 2
const DEFAULT_SATISFACTION_HOURS = 2
const DEFAULT_SATISFACTION_EVERY = 10
const SATISFACTION_GAP_DAYS = 30

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const supabase = serverSupabaseServiceRole<Database>(event)

  const { data: rules } = await supabase
    .from('automation_rules')
    .select('id, account_id, filters, trigger_event')
    .in('trigger_event', ['appointment.review_request', 'appointment.satisfaction'])
    .eq('enabled', true)
  if (!rules || rules.length === 0) return { sent: 0 }

  const now = Date.now()
  const origin = getRequestURL(event).origin

  const dueByRule: { ruleId: string; accountId: string; appointmentId: string; patientId: string }[] = []

  for (const rule of rules) {
    if (rule.trigger_event === 'appointment.satisfaction') {
      dueByRule.push(...(await satisfactionDue(supabase, rule, now)))
      continue
    }
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
      // Deleting keeps the status, so a visit the clinic deleted still read
      // as completed and got a review request.
      .is('deleted_at', null)
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
    .select('id, first_name, last_name, email, is_minor, do_not_contact, marketing_channels, date_of_birth, address, city, postal_code, country, national_id, occupation, gender, emergency_contact, preferred_language')
    .in('id', patientIds)
  const patientsById = new Map((patients ?? []).map((p) => [p.id, p]))

  const rulesById = new Map(rules.map((r) => [r.id, r]))

  const sentFlags = await mapWithConcurrency(dueByRule, SEND_CONCURRENCY, async (due) => {
    const patient = patientsById.get(due.patientId)
    if (!patient) return false
    const rule = rulesById.get(due.ruleId)
    if (!rule) return false
    if (!(await ruleFiltersMatch(supabase, patient.id, rule.filters as AutomationFilters, due.appointmentId))) return false

    await dispatchPatientRule(supabase, supabase, due.accountId, due.ruleId, patient, origin, due.appointmentId)
    // Best-effort: a duplicate insert (unique(rule_id, appointment_id)) can
    // only happen from two overlapping cron ticks racing the same row, in
    // which case the actions already fired twice regardless of this insert
    // succeeding -- not worth failing the whole request over.
    await supabase.from('automation_rule_sends').insert({ rule_id: due.ruleId, appointment_id: due.appointmentId }).select().maybeSingle()
    return true
  })

  return { sent: sentFlags.filter(Boolean).length }
})

/**
 * The visits a satisfaction rule asks about this tick: completed ones that
 * ended `hours_after` ago (within the tick's window), not already sent by
 * this rule, that are the patient's first visit (`first_visit`, on unless
 * off) or a multiple of `every_visits` (10 unless set; 0 is never) -- and only
 * for patients not asked in the last SATISFACTION_GAP_DAYS, by any rule, and
 * one visit per patient however many end in the same window.
 */
async function satisfactionDue(supabase: any, rule: { id: string; account_id: string; filters: unknown }, now: number) {
  const filters = (rule.filters ?? {}) as Record<string, unknown>
  const hoursAfter = Number(filters.hours_after) > 0 ? Number(filters.hours_after) : DEFAULT_SATISFACTION_HOURS
  const every = filters.every_visits === undefined ? DEFAULT_SATISFACTION_EVERY : Math.max(0, Number(filters.every_visits) || 0)
  const first = filters.first_visit !== false
  const windowStart = new Date(now - hoursAfter * 3_600_000).toISOString()
  const windowEnd = new Date(now - hoursAfter * 3_600_000 + WINDOW_BUFFER_MINUTES * 60_000).toISOString()

  const { data: appointments } = await supabase
    .from('appointments')
    .select('id, patient_id, starts_at')
    .eq('account_id', rule.account_id)
    .eq('status', 'completed')
    .is('deleted_at', null)
    .not('patient_id', 'is', null)
    .gte('ends_at', windowStart)
    .lt('ends_at', windowEnd)
  const candidates = (appointments ?? []) as { id: string; patient_id: string; starts_at: string }[]
  if (candidates.length === 0) return []

  const { data: alreadySent } = await supabase.from('automation_rule_sends').select('appointment_id').eq('rule_id', rule.id).in('appointment_id', candidates.map((a) => a.id))
  const sent = new Set(((alreadySent ?? []) as { appointment_id: string }[]).map((r) => r.appointment_id))

  const patientIds = [...new Set(candidates.map((a) => a.patient_id))]
  // Which visit of theirs this is: their completed visits up to and including it.
  const { data: history } = await supabase.from('appointments').select('patient_id, starts_at').in('patient_id', patientIds).eq('status', 'completed').is('deleted_at', null)
  const visits = new Map<string, string[]>()
  for (const h of (history ?? []) as { patient_id: string; starts_at: string }[]) visits.set(h.patient_id, [...(visits.get(h.patient_id) ?? []), h.starts_at])
  // Asked recently, by this rule or any other.
  const since = new Date(now - SATISFACTION_GAP_DAYS * 86_400_000).toISOString()
  const { data: recent } = await supabase.from('satisfaction_surveys').select('appointments!inner(patient_id)').eq('account_id', rule.account_id).gte('sent_at', since).in('appointments.patient_id', patientIds)
  const askedRecently = new Set(((recent ?? []) as { appointments: { patient_id: string } }[]).map((r) => r.appointments.patient_id))

  const due: { ruleId: string; accountId: string; appointmentId: string; patientId: string }[] = []
  const taken = new Set<string>()
  for (const a of candidates) {
    if (sent.has(a.id) || askedRecently.has(a.patient_id) || taken.has(a.patient_id)) continue
    const n = (visits.get(a.patient_id) ?? []).filter((at) => at <= a.starts_at).length
    if (!((first && n === 1) || (every > 0 && n > 0 && n % every === 0))) continue
    taken.add(a.patient_id)
    due.push({ ruleId: rule.id, accountId: rule.account_id, appointmentId: a.id, patientId: a.patient_id })
  }
  return due
}

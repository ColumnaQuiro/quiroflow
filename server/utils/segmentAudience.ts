import type { AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { carePlanOverdueDays, type OverduePlan, type OverdueVisit } from '~/utils/carePlanOverdue'
import { needsVisitHistory, noWhatsAppSentMatches, visitHistoryMatches } from '~/utils/automationAudience'

// Who a segment matches today -- the live "143 patients match today" under the
// segment trigger, and the count in the activation dialog.
//
// It has to agree with the enrolment the cron does (enrolDueSegments in
// automationEngine.ts: the same candidates, then ruleFiltersMatch per
// patient). That path asks one query per patient per filter, which is fine
// once a week in the background and far too slow to answer while someone
// edits a filter, so this answers the same question in bulk: a handful of
// account-wide reads, then the same tests in memory. growth-automation-
// segments.cy.ts checks the two agree.

const DAY = 24 * 3600 * 1000

async function allRows<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

interface PatientRow {
  id: string
  clinic_id: string | null
  tags: string[] | null
  is_minor: boolean
  do_not_contact: boolean
  marketing_channels: string[] | null
}

export interface SegmentAudience {
  ids: string[]
  /** Of those, how many accepted each marketing channel. */
  whatsapp: number
  email: number
}

export async function segmentAudience(service: any, accountId: string, filters: AutomationFilters | null | undefined, isMarketing: boolean): Promise<SegmentAudience> {
  const f = filters ?? {}
  const patients = await allRows<PatientRow>((from, to) =>
    // Archived patients are not an audience: archiving says it stops
    // reminders. enrolDueSegments leaves them out the same way.
    service
      .from('patients')
      .select('id, clinic_id, tags, is_minor, do_not_contact, marketing_channels')
      .eq('account_id', accountId)
      .neq('status', 'inactive')
      .order('id')
      .range(from, to),
  )
  // The enrolment's own gate: nobody who cannot be contacted, and for a
  // marketing rule nobody with no marketing channel at all.
  let candidates = patients.filter((p) => !p.is_minor && !p.do_not_contact && (!isMarketing || (p.marketing_channels ?? []).length > 0))

  const typeIds = f.appointment_type_ids?.length ? f.appointment_type_ids : f.appointment_type_id ? [f.appointment_type_id] : null
  // A segment has no appointment in scope, so ruleFiltersMatch answers "no"
  // to an appointment-type or practitioner filter for everyone.
  if (typeIds || f.practitioner_ids?.length) candidates = []

  if (candidates.length && needsVisitHistory(f)) {
    const completed = await allRows<{ patient_id: string; starts_at: string }>((from, to) =>
      service.from('appointments').select('patient_id, starts_at').eq('account_id', accountId).eq('status', 'completed').order('id').range(from, to),
    )
    const count = new Map<string, number>()
    const last = new Map<string, number>()
    for (const a of completed) {
      count.set(a.patient_id, (count.get(a.patient_id) ?? 0) + 1)
      const at = new Date(a.starts_at).getTime()
      if (at > (last.get(a.patient_id) ?? 0)) last.set(a.patient_id, at)
    }
    const now = Date.now()
    candidates = candidates.filter((p) => visitHistoryMatches(f, count.get(p.id) ?? 0, last.get(p.id) ?? null, now))
  }

  if (candidates.length && typeof f.no_whatsapp_sent_days === 'number' && f.no_whatsapp_sent_days > 0) {
    // Only rows inside the window matter: anyone with none is clear.
    const since = new Date(Date.now() - f.no_whatsapp_sent_days * DAY).toISOString()
    const sent = await allRows<{ patient_id: string | null; created_at: string }>((from, to) =>
      service.from('whatsapp_messages').select('patient_id, created_at').eq('account_id', accountId).eq('direction', 'outbound').neq('status', 'would_send').gte('created_at', since).order('id').range(from, to),
    )
    const lastSent = new Map<string, number>()
    for (const m of sent) {
      if (!m.patient_id) continue
      const at = new Date(m.created_at).getTime()
      if (at > (lastSent.get(m.patient_id) ?? 0)) lastSent.set(m.patient_id, at)
    }
    const now = Date.now()
    candidates = candidates.filter((p) => noWhatsAppSentMatches(f.no_whatsapp_sent_days, lastSent.get(p.id) ?? null, now))
  }

  if (candidates.length && f.no_prior_appointments) {
    const any = await allRows<{ patient_id: string }>((from, to) =>
      service.from('appointments').select('patient_id').eq('account_id', accountId).order('id').range(from, to),
    )
    const seen = new Set(any.map((a) => a.patient_id))
    candidates = candidates.filter((p) => !seen.has(p.id))
  }

  if (candidates.length && f.has_future_appointment !== undefined) {
    const future = await allRows<{ patient_id: string }>((from, to) =>
      service.from('appointments').select('patient_id').eq('account_id', accountId).eq('status', 'booked').is('deleted_at', null).gt('starts_at', new Date().toISOString()).order('id').range(from, to),
    )
    const has = new Set(future.map((a) => a.patient_id))
    candidates = candidates.filter((p) => has.has(p.id) === f.has_future_appointment)
  }

  if (candidates.length && typeof f.care_plan_overdue_days === 'number') {
    const min = Math.max(1, f.care_plan_overdue_days)
    const plans = await allRows<OverduePlan & { patient_id: string }>((from, to) =>
      service.from('care_plans').select('patient_id, created_at, started_at, total_visits, frequency_value, frequency_unit, visits_per_period').eq('account_id', accountId).order('id').range(from, to),
    )
    const plansBy = new Map<string, OverduePlan[]>()
    for (const p of plans) plansBy.set(p.patient_id, [...(plansBy.get(p.patient_id) ?? []), p])
    candidates = candidates.filter((p) => plansBy.has(p.id))
    if (candidates.length) {
      // Only those with a plan, in chunks short enough for one URL each.
      const ids = candidates.map((p) => p.id)
      const visits: (OverdueVisit & { patient_id: string })[] = []
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200)
        visits.push(...(await allRows<OverdueVisit & { patient_id: string }>((from, to) =>
          service.from('appointments').select('patient_id, starts_at, status').eq('account_id', accountId).is('deleted_at', null).in('patient_id', chunk).order('id').range(from, to),
        )))
      }
      const visitsBy = new Map<string, OverdueVisit[]>()
      for (const v of visits) visitsBy.set(v.patient_id, [...(visitsBy.get(v.patient_id) ?? []), v])
      const now = new Date()
      candidates = candidates.filter((p) => {
        const days = carePlanOverdueDays(plansBy.get(p.id)!, visitsBy.get(p.id) ?? [], now)
        return days !== null && days >= min
      })
    }
  }

  if (candidates.length && f.tag_contains) {
    const needle = f.tag_contains.toLowerCase()
    candidates = candidates.filter((p) => (p.tags ?? []).some((tag) => tag.toLowerCase().includes(needle)))
  }

  if (candidates.length && f.balance) {
    const balances = await allRows<{ patient_id: string; balance_cents: number | null }>((from, to) =>
      service.from('patient_live_balances').select('patient_id, balance_cents').eq('account_id', accountId).order('patient_id').range(from, to),
    )
    const byId = new Map(balances.map((b) => [b.patient_id, b.balance_cents ?? 0]))
    candidates = candidates.filter((p) => {
      const cents = byId.get(p.id) ?? 0
      return f.balance === 'debit' ? cents < 0 : cents > 0
    })
  }

  if (candidates.length && f.clinic_ids?.length) {
    candidates = candidates.filter((p) => p.clinic_id && f.clinic_ids!.includes(p.clinic_id))
  }

  if (candidates.length && (f.membership_active || f.membership_ids?.length)) {
    const memberships = await allRows<{ patient_id: string; membership_id: string | null }>((from, to) =>
      service.from('patient_memberships').select('patient_id, membership_id').eq('account_id', accountId).eq('status', 'active').order('id').range(from, to),
    )
    const ok = new Set(memberships.filter((m) => !f.membership_ids?.length || (m.membership_id && f.membership_ids.includes(m.membership_id))).map((m) => m.patient_id))
    candidates = candidates.filter((p) => ok.has(p.id))
  }

  return {
    ids: candidates.map((p) => p.id),
    whatsapp: candidates.filter((p) => (p.marketing_channels ?? []).includes('whatsapp')).length,
    email: candidates.filter((p) => (p.marketing_channels ?? []).includes('email')).length,
  }
}

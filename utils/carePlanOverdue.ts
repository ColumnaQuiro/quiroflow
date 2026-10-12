import { carePlanGapDays } from './carePlanCadence'

// How many days a patient is behind on their care plan, for the automation
// filter "behind on their care plan" -- the same rule as the
// care_plan_continuity_alerts view (care_plan_visit_facts, 20261003155100 and
// 20261009174400), restated here because that view answers only for a signed-
// in member and the automation engine runs as the service role, where it
// returns nothing at all.
//
//   * their LATEST plan (by created_at);
//   * visits completed since it started: at least one, and fewer than its total;
//   * nothing ahead that is not cancelled;
//   * due = the last completed visit's date + the plan's gap (carePlanGapDays);
//   * overdue = today - due, in days, when positive.
//
// Dates are UTC calendar days, as current_date and ::date are in the view.
export interface OverduePlan {
  created_at: string
  started_at: string
  total_visits: number
  frequency_value: number
  frequency_unit: string
  visits_per_period: number | null
}
export interface OverdueVisit { starts_at: string; status: string }

const dayNumber = (d: Date) => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000)

/** Days overdue on the latest plan, or null when they are not behind. */
export function carePlanOverdueDays(plans: OverduePlan[], visits: OverdueVisit[], now: Date): number | null {
  if (plans.length === 0) return null
  const plan = plans.reduce((a, b) => (b.created_at > a.created_at ? b : a))
  const started = Date.parse(plan.started_at.length === 10 ? `${plan.started_at}T00:00:00Z` : plan.started_at)
  let completed = 0
  let last: number | null = null
  for (const v of visits) {
    const at = Date.parse(v.starts_at)
    if (v.status !== 'cancelled' && at > now.getTime()) return null
    if (v.status === 'completed' && at >= started) {
      completed++
      if (last === null || at > last) last = at
    }
  }
  if (last === null || completed >= plan.total_visits) return null
  const due = dayNumber(new Date(last)) + carePlanGapDays(plan)
  const overdue = dayNumber(now) - due
  return overdue > 0 ? overdue : null
}

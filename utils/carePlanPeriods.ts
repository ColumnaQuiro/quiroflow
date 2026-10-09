// A care plan, period by period: PracticeHub's row of circles. A plan of
// "2 visits every week" for 12 visits is six one-week periods from its start,
// each expecting two visits; this says how each went or is going --
//
//   completed    the period's visits were attended
//   scheduled    not all attended yet, but the rest are booked
//   behind       the period is over (or is now) and visits are missing
//                with nothing booked to make them up
//   current      this period, still open, nothing missing yet
//   unscheduled  ahead, and nothing booked in it
//
// Pure (tests/unit/care-plan-periods.test.ts). Dates are clinic days,
// "YYYY-MM-DD", so the caller decides the zone; visits carry their own day.
import { planVisitsPerPeriod, type PlanCadence } from './carePlanCadence'

export type PeriodStatus = 'completed' | 'scheduled' | 'behind' | 'current' | 'unscheduled'

export interface PlanPeriod {
  index: number
  start: string
  /** Last day of the period, inclusive. */
  end: string
  expected: number
  completed: number
  booked: number
  status: PeriodStatus
  isCurrent: boolean
}

export interface PeriodPlan extends PlanCadence {
  started_at: string
  total_visits: number
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10)
}

export function carePlanPeriods(plan: PeriodPlan, visits: { day: string; status: string }[], today: string): PlanPeriod[] {
  const perPeriod = planVisitsPerPeriod(plan)
  const every = Math.max(1, plan.frequency_value)
  const count = Math.max(1, Math.ceil(plan.total_visits / perPeriod))
  const startOf = (i: number) => (plan.frequency_unit === 'month' ? addMonths(plan.started_at, i * every) : addDays(plan.started_at, i * 7 * every))
  const out: PlanPeriod[] = []
  for (let i = 0; i < count; i++) {
    const start = startOf(i)
    const end = addDays(startOf(i + 1), -1)
    // The last period may hold fewer than a full period's visits.
    const expected = i === count - 1 ? plan.total_visits - perPeriod * (count - 1) : perPeriod
    const inside = visits.filter((v) => v.day >= start && v.day <= end)
    const completed = inside.filter((v) => v.status === 'completed').length
    const booked = inside.filter((v) => v.status === 'booked' && v.day >= today).length
    const isCurrent = today >= start && today <= end
    let status: PeriodStatus
    if (completed >= expected) status = 'completed'
    else if (completed + booked >= expected) status = 'scheduled'
    else if (end < today) status = 'behind'
    else if (isCurrent) status = 'current'
    else status = booked > 0 ? 'scheduled' : 'unscheduled'
    out.push({ index: i, start, end, expected, completed, booked, status, isCurrent })
  }
  return out
}

/** On track while no period that is over fell short. */
export function planOnTrack(periods: PlanPeriod[]): boolean {
  return !periods.some((p) => p.status === 'behind')
}

/** The periods worth showing: the current one, one before it and the next ones, `size` in all. */
export function periodWindow(periods: PlanPeriod[], size = 6): PlanPeriod[] {
  if (periods.length <= size) return periods
  const now = periods.findIndex((p) => p.isCurrent)
  const anchor = now === -1 ? (periods[periods.length - 1].end < periods[0].start ? 0 : periods.length - 1) : now
  const from = Math.max(0, Math.min(anchor - 1, periods.length - size))
  return periods.slice(from, from + size)
}

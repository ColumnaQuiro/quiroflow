// A care plan's cadence: visits_per_period visits every frequency_value weeks
// or months (utils/carePlanCadence.ts, shared with the web, says why both).
import { carePlanCadenceLabel, carePlanGapDays, planVisitsPerPeriod, type PlanCadence } from '../../utils/carePlanCadence'

export type CarePlanCadence = PlanCadence

/** "weekly", "2× a week", "every 2 weeks", "monthly" -- the cadence as people say it. */
export function cadenceLabel(plan: CarePlanCadence, t: (en: string, es: string) => string): string {
  return carePlanCadenceLabel(plan, t)
}

/** YYYY-MM-DD plus whole days. */
export function addDaysToDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** YYYY-MM-DD plus calendar months, clamped to the month's end (31 Jan + 1 = 28 Feb). */
export function addMonthsToDate(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10)
}

/** The date the plan says the visit after `from` (YYYY-MM-DD) is due. */
export function nextDueDate(plan: CarePlanCadence, from: string): string {
  // Several visits a period: the average gap between them (as Care Plan Alerts).
  if (planVisitsPerPeriod(plan) > 1) return addDaysToDate(from, carePlanGapDays(plan))
  return plan.frequency_unit === 'month' ? addMonthsToDate(from, plan.frequency_value) : addDaysToDate(from, plan.frequency_value * 7)
}

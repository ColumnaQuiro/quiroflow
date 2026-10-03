// A care plan's cadence (care_plans.frequency_value / frequency_unit) is
// "every N weeks" or "every N months" -- the reading PhaseStats.vue and the
// care_plan_continuity_alerts view (0131) both use.

export interface CarePlanCadence {
  frequency_value: number
  frequency_unit: string
}

/** "weekly", "every 2 weeks", "monthly" -- the cadence as people say it. */
export function cadenceLabel(plan: CarePlanCadence, t: (en: string, es: string) => string): string {
  const n = plan.frequency_value
  if (plan.frequency_unit === 'month') return n === 1 ? t('monthly', 'mensual') : t(`every ${n} months`, `cada ${n} meses`)
  return n === 1 ? t('weekly', 'semanal') : t(`every ${n} weeks`, `cada ${n} semanas`)
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
  return plan.frequency_unit === 'month' ? addMonthsToDate(from, plan.frequency_value) : addDaysToDate(from, plan.frequency_value * 7)
}

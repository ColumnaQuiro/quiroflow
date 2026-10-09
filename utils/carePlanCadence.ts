// A care plan's cadence: visits_per_period visits every frequency_value
// weeks or months -- "2 a week", "1 every 3 weeks". frequency_value is the
// interval (what the calendar series, Care Plan Alerts and the staff app
// always read it as); visits_per_period was added beside it so an intensive
// phase can be more than one visit a period (see the
// care_plan_visits_per_period migration). Shared by web and the staff app so
// they say it the same way.
export interface PlanCadence {
  frequency_value: number
  frequency_unit: string
  visits_per_period?: number | null
}

export function planVisitsPerPeriod(p: PlanCadence): number {
  return Math.min(7, Math.max(1, Math.round(p.visits_per_period ?? 1)))
}

/** "weekly", "2× a week", "every 3 weeks", "2× every 2 weeks", "monthly". */
export function carePlanCadenceLabel(p: PlanCadence, t: (en: string, es: string) => string): string {
  const n = Math.max(1, p.frequency_value)
  const v = planVisitsPerPeriod(p)
  const month = p.frequency_unit === 'month'
  const every = n === 1 ? '' : month ? t(`every ${n} months`, `cada ${n} meses`) : t(`every ${n} weeks`, `cada ${n} semanas`)
  if (v === 1) return every || (month ? t('monthly', 'mensual') : t('weekly', 'semanal'))
  const times = t(`${v}×`, `${v} veces`)
  if (!every) return month ? t(`${v}× a month`, `${v} veces al mes`) : t(`${v}× a week`, `${v} veces por semana`)
  return `${times} ${every}`
}

/** Days between visits on average: the period over its visits, rounded up (as the alerts view). */
export function carePlanGapDays(p: PlanCadence): number {
  const period = Math.max(1, p.frequency_value) * (p.frequency_unit === 'month' ? 30 : 7)
  return Math.ceil(period / planVisitsPerPeriod(p))
}

import { formatEur } from './billing'

// Monthly goals (monthly_goals): the four things an owner aims for each month,
// and how the month so far compares. Shared by the Dashboard widget and the
// owners' Monday summary, so both say the same thing about the same month.

export const GOAL_METRICS = ['new_patients', 'visits', 'collected_cents', 'plans_started'] as const
export type GoalMetric = (typeof GOAL_METRICS)[number]

export const GOAL_LABELS: Record<GoalMetric, [string, string]> = {
  new_patients: ['New patients', 'Pacientes nuevos'],
  visits: ['Visits', 'Visitas'],
  collected_cents: ['Collected', 'Cobrado'],
  plans_started: ['Care plans started', 'Planes iniciados'],
}

export interface GoalProgress {
  metric: GoalMetric
  target: number
  actual: number
}

export type GoalPace = 'done' | 'on_track' | 'behind'

/**
 * Where a goal stands with `elapsed` (0-1) of the month gone: done once the
 * target is reached; behind when under 90 % of where an even month would be
 * by now (a little slack, so the first days of a month are not all red).
 */
export function goalPace(g: Pick<GoalProgress, 'actual' | 'target'>, elapsed: number): GoalPace {
  if (g.actual >= g.target) return 'done'
  return g.actual < g.target * Math.min(1, Math.max(0, elapsed)) * 0.9 ? 'behind' : 'on_track'
}

export function goalValue(metric: GoalMetric, n: number): string {
  return metric === 'collected_cents' ? formatEur(n) : String(n)
}

/** "2026-10" for a clinic date "2026-10-15". */
export const monthOf = (date: string) => date.slice(0, 7)

/** First day of the month after "2026-10". */
export function nextMonthStart(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

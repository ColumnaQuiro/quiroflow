// What a care plan goes on to once it is done (care_plans.next_phases,
// migration care_plan_next_phases): "2 visits a week for 8 visits, then 1 a
// week for 4". Each entry is the cadence and length of a phase still to
// come, in order. When the visit that finishes the current phase is marked
// done, the database starts the first one as an ordinary care plan
// (care_plan_start_next_phase), carrying the rest -- so everything that
// reads "the patient's plan" keeps reading one cadence at a time.
//
// Only the last phase may have no end: one before it would never finish, so
// nothing after it would start. The same rule is the check constraint
// (care_plan_next_phases_valid), and a plan with no end queues nothing.
import { carePlanCadenceLabel, type PlanCadence } from './carePlanCadence'

export interface CarePlanNextPhase extends PlanCadence {
  visits_per_period: number
  frequency_unit: 'week' | 'month'
  /** null = no end; only the last phase. */
  total_visits: number | null
}

export const MAX_NEXT_PHASES = 6

const whole = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

/** Whole numbers in range, at most MAX_NEXT_PHASES, an end on every phase but the last -- what the check constraint accepts. */
export function cleanNextPhases(phases: Partial<CarePlanNextPhase>[] | null | undefined): CarePlanNextPhase[] {
  const out = (phases ?? []).slice(0, MAX_NEXT_PHASES).map((p) => ({
    visits_per_period: whole(p.visits_per_period, 1, 7, 1),
    frequency_value: whole(p.frequency_value, 1, 52, 1),
    frequency_unit: p.frequency_unit === 'month' ? ('month' as const) : ('week' as const),
    total_visits: p.total_visits === null || p.total_visits === undefined ? null : whole(p.total_visits, 1, 200, 1),
  }))
  // A phase with no end before another: everything after it is unreachable.
  const open = out.findIndex((p) => p.total_visits === null)
  return open === -1 ? out : out.slice(0, open + 1)
}

/** Read from the column: anything malformed is dropped rather than trusted. */
export function readNextPhases(raw: unknown): CarePlanNextPhase[] {
  return Array.isArray(raw) ? cleanNextPhases(raw as Partial<CarePlanNextPhase>[]) : []
}

/** "weekly · 4 visits", "monthly · no end". */
export function nextPhaseLabel(p: CarePlanNextPhase, t: (en: string, es: string) => string): string {
  const length =
    p.total_visits === null
      ? t('no end', 'sin fin')
      : p.total_visits === 1
        ? t('1 visit', '1 visita')
        : t(`${p.total_visits} visits`, `${p.total_visits} visitas`)
  return `${carePlanCadenceLabel(p, t)} · ${length}`
}

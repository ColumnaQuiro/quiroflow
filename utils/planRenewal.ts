import type { PlanCadence } from './carePlanCadence'

// The review at the end of a care plan ("Revisión"): when a plan has this
// many visits or fewer left, the visit is flagged on My Day and in the staff
// app, and the practitioner is offered what comes next. Shared by web and app.

/** Flag the plan once this many attended visits (or fewer) remain. */
export const RENEWAL_DUE_REMAINING = 2

export function renewalDue(plan: { total_visits: number }, completedInPlan: number): boolean {
  return plan.total_visits > 0 && plan.total_visits - completedInPlan <= RENEWAL_DUE_REMAINING
}

export type RenewalKind = 'maintenance' | 'same' | 'discharge'

export interface RenewalPreset extends PlanCadence {
  kind: RenewalKind
  total_visits: number
}

/**
 * What the three choices fill in: maintenance (one visit every three weeks,
 * eight of them), the same plan again, or discharge (no plan; back in recalls
 * in three months).
 */
export function renewalPreset(kind: RenewalKind, current: PlanCadence & { total_visits: number }): RenewalPreset {
  if (kind === 'maintenance') return { kind, frequency_value: 3, frequency_unit: 'week', visits_per_period: 1, total_visits: 8 }
  if (kind === 'same') return { kind, frequency_value: current.frequency_value, frequency_unit: current.frequency_unit, visits_per_period: current.visits_per_period ?? 1, total_visits: current.total_visits }
  return { kind, frequency_value: current.frequency_value, frequency_unit: current.frequency_unit, visits_per_period: 1, total_visits: 0 }
}

/** Days from today a discharged patient comes back into the recall list. */
export const DISCHARGE_RECALL_DAYS = 90

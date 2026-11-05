import type { PlanCadence } from './carePlanCadence'

// The review at the end of a care plan ("Revisión"): when a plan has this
// many visits or fewer left, the visit is flagged on My Day and in the staff
// app, and the practitioner is offered what comes next. Shared by web and app.
//
// What comes next is the clinic's own (Settings > Care plans,
// 20261105163000_clinic_maintenance): "keep coming" proposes its maintenance
// cadence and length, and discharge brings the patient back into Recalls
// after its months. A plan with no end (total_visits null) is never flagged.

/** Flag the plan once this many attended visits (or fewer) remain. */
export const RENEWAL_DUE_REMAINING = 2

export function renewalDue(plan: { total_visits: number | null }, completedInPlan: number): boolean {
  return plan.total_visits !== null && plan.total_visits > 0 && plan.total_visits - completedInPlan <= RENEWAL_DUE_REMAINING
}

export type RenewalKind = 'continue' | 'discharge'

/** A plan's cadence and length; total_visits null = no end. */
export interface PlanShape extends PlanCadence {
  visits_per_period: number
  total_visits: number | null
}

export interface MaintenanceConfig extends PlanShape {
  membershipId: string | null
  dischargeRecallMonths: number
  habitsArticleIds: string[]
  habitsOnStart: boolean
  habitsOnDischarge: boolean
}

/** The columns maintenanceConfig() reads from accounts. */
export const MAINTENANCE_COLUMNS =
  'maintenance_visits_per_period, maintenance_frequency_value, maintenance_frequency_unit, maintenance_total_visits, maintenance_membership_id, maintenance_discharge_recall_months, maintenance_habits_article_ids, maintenance_habits_on_start, maintenance_habits_on_discharge'

export interface MaintenanceRow {
  maintenance_visits_per_period?: number | null
  maintenance_frequency_value?: number | null
  maintenance_frequency_unit?: string | null
  maintenance_total_visits?: number | null
  maintenance_membership_id?: string | null
  maintenance_discharge_recall_months?: number | null
  maintenance_habits_article_ids?: string[] | null
  maintenance_habits_on_start?: boolean | null
  maintenance_habits_on_discharge?: boolean | null
}

/** The account's maintenance, with the migration's defaults for anything missing: one visit a month, no end, back in Recalls after three months. */
export function maintenanceConfig(row: MaintenanceRow | null | undefined): MaintenanceConfig {
  return {
    visits_per_period: row?.maintenance_visits_per_period ?? 1,
    frequency_value: row?.maintenance_frequency_value ?? 1,
    frequency_unit: row?.maintenance_frequency_unit === 'week' ? 'week' : 'month',
    total_visits: row?.maintenance_total_visits ?? null,
    membershipId: row?.maintenance_membership_id ?? null,
    dischargeRecallMonths: row?.maintenance_discharge_recall_months ?? 3,
    habitsArticleIds: row?.maintenance_habits_article_ids ?? [],
    habitsOnStart: row?.maintenance_habits_on_start ?? true,
    habitsOnDischarge: row?.maintenance_habits_on_discharge ?? false,
  }
}

/** What "keep coming" fills in: the clinic's maintenance. */
export function maintenancePreset(config: MaintenanceConfig): PlanShape {
  return { frequency_value: config.frequency_value, frequency_unit: config.frequency_unit, visits_per_period: config.visits_per_period, total_visits: config.total_visits }
}

/** "volver a eso": the cadence the patient had, kept at the same length as the maintenance proposed. */
export function previousCadence(current: PlanCadence, length: number | null): PlanShape {
  return { frequency_value: current.frequency_value, frequency_unit: current.frequency_unit, visits_per_period: current.visits_per_period ?? 1, total_visits: length }
}

/** The day a discharged patient is back in Recalls: this many months from today. */
export function dischargeRecallDate(months: number, today: Date): Date {
  const d = new Date(today.getFullYear(), today.getMonth() + Math.max(1, months), today.getDate())
  // 30 Nov + 3 months is 28 Feb, not 2 Mar.
  if (d.getDate() !== today.getDate()) d.setDate(0)
  return d
}

/** "visita 7 de mantenimiento, desde marzo": where a patient is in a plan with no end. Visit 0 is "since March", nothing attended yet. */
export function openEndedPlanLabel(visit: number, startedAt: string, t: (en: string, es: string) => string, now = new Date()): string {
  const start = new Date(`${startedAt.slice(0, 10)}T12:00:00`)
  const sameYear = start.getFullYear() === now.getFullYear()
  const en = start.toLocaleDateString('en-GB', sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' })
  const es = start.toLocaleDateString('es-ES', sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' })
  if (visit <= 0) return t(`maintenance since ${en}`, `mantenimiento desde ${es}`)
  return t(`maintenance visit ${visit}, since ${en}`, `visita ${visit} de mantenimiento, desde ${es}`)
}

/** A plan with no end books this many visits ahead at a time ("follow the plan" in the calendar). */
export const OPEN_ENDED_BOOK_AHEAD = 6

/**
 * Visits the plan still needs that have no appointment: what "book the plan"
 * books. For a plan with no end, enough to keep OPEN_ENDED_BOOK_AHEAD booked.
 */
export function planVisitsToBook(plan: { total_visits: number | null }, completed: number, scheduled: number): number {
  if (plan.total_visits === null) return Math.max(0, OPEN_ENDED_BOOK_AHEAD - scheduled)
  return Math.max(0, plan.total_visits - completed - scheduled)
}

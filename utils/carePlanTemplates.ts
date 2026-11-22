// Care plan templates (Settings > Care plans, migration care_plan_templates):
// a care plan without a patient -- name, cadence, length, the phases after it,
// its re-exam visits and how it is usually paid. Choosing one in "New care
// plan" copies it into the plan; nothing points back at it. One per clinic is
// the maintenance, what "Keep coming" in the end-of-plan review proposes.
//
// The same idea as PracticeHub 2.0's care plan templates, where a plan's
// schedule is a set course (with phases), ongoing (no end), or none.
import type { CarePlanVisitMarker } from './carePlanVisitMarkers'
import { cleanVisitMarkers } from './carePlanVisitMarkers'
import { nextPhaseLabel, readNextPhases, type CarePlanNextPhase } from './carePlanPhases'

export type CarePlanPaymentKind = 'per_visit' | 'bono' | 'membership'

export interface CarePlanTemplate {
  id: string
  name: string
  visits_per_period: number
  frequency_value: number
  frequency_unit: 'week' | 'month'
  /** null = no end. */
  total_visits: number | null
  next_phases: CarePlanNextPhase[]
  visit_markers: CarePlanVisitMarker[]
  payment_kind: CarePlanPaymentKind
  is_maintenance: boolean
  sort_order: number
}

export const CARE_PLAN_TEMPLATE_COLUMNS =
  'id, name, visits_per_period, frequency_value, frequency_unit, total_visits, next_phases, visit_markers, payment_kind, is_maintenance, sort_order'

const whole = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

/** A row as read from the table, with anything malformed dropped rather than trusted. */
export function readCarePlanTemplate(row: Record<string, unknown>): CarePlanTemplate {
  const total = row.total_visits === null || row.total_visits === undefined ? null : whole(row.total_visits, 1, 200, 1)
  const kind = row.payment_kind
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    visits_per_period: whole(row.visits_per_period, 1, 7, 1),
    frequency_value: whole(row.frequency_value, 1, 52, 1),
    frequency_unit: row.frequency_unit === 'month' ? 'month' : 'week',
    total_visits: total,
    // A plan with no end queues nothing (care_plans_next_phases_need_an_end).
    next_phases: total === null ? [] : readNextPhases(row.next_phases),
    visit_markers: Array.isArray(row.visit_markers) ? cleanVisitMarkers(row.visit_markers as CarePlanVisitMarker[]) : [],
    payment_kind: kind === 'bono' || kind === 'membership' ? kind : 'per_visit',
    is_maintenance: row.is_maintenance === true,
    sort_order: whole(row.sort_order, -1_000_000, 1_000_000, 0),
  }
}

/** "2 visits a week · 12 visits → weekly · 6 visits": every phase, in order. */
export function carePlanTemplateSummary(tpl: Pick<CarePlanTemplate, 'visits_per_period' | 'frequency_value' | 'frequency_unit' | 'total_visits' | 'next_phases'>, t: (en: string, es: string) => string): string {
  const first: CarePlanNextPhase = { visits_per_period: tpl.visits_per_period, frequency_value: tpl.frequency_value, frequency_unit: tpl.frequency_unit, total_visits: tpl.total_visits }
  const rest = tpl.total_visits === null ? [] : tpl.next_phases
  return [first, ...rest].map((p) => nextPhaseLabel(p, t)).join(' → ')
}

/** Templates in the order the clinic set, then by name; the maintenance one is not singled out. */
export function sortCarePlanTemplates(list: CarePlanTemplate[]): CarePlanTemplate[] {
  return [...list].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'es'))
}

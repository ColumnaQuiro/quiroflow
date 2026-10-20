// Re-exam visits on a care plan (care_plans.visit_markers, migration
// care_plan_visit_markers): "visit 3", "every 12th visit", "scans on visit 11
// of every 12". Visits are counted, not dated -- the Nth appointment since the
// plan started that was not cancelled, missed or deleted -- so a marker works
// on an open-ended plan with no fixed cadence too.
//
// A marker with an appointment type says how that visit should be booked;
// one without only highlights it. The numbering and matching live in SQL
// (care_plan_marked_visits, care_plan_visit_markers_at); markerForVisit is the
// same rule as care_plan_marker_for, for the plan form's preview.
export interface CarePlanVisitMarker {
  /** The first visit it falls on, 1-based. */
  at: number
  /** Repeats every this many visits after `at`; null for once. */
  every?: number | null
  appointment_type_id?: string | null
  label?: string | null
}

export const MAX_VISIT_MARKERS = 8

/** The marker visit n falls on: the first that matches, in the plan's order. */
export function markerForVisit(markers: CarePlanVisitMarker[] | null | undefined, n: number): CarePlanVisitMarker | null {
  for (const m of markers ?? []) {
    if (n < m.at) continue
    if (n === m.at) return m
    if (m.every && (n - m.at) % m.every === 0) return m
  }
  return null
}

/** The first few visit numbers a marker falls on, for "Visits 12, 24, 36…". */
export function markerVisitNumbers(m: CarePlanVisitMarker, count = 3): number[] {
  if (!m.every) return [m.at]
  return Array.from({ length: count }, (_, i) => m.at + i * m.every!)
}

/** What a marked visit is called: its own label, else its type's name, else "Re-exam". */
export function visitMarkerLabel(
  marker: { label?: string | null; expected_type_name?: string | null } | null | undefined,
  t: (en: string, es: string) => string,
): string {
  return marker?.label?.trim() || marker?.expected_type_name?.trim() || t('Re-exam', 'Revisión')
}

/** Whole numbers in range, empty labels dropped, at most MAX_VISIT_MARKERS -- what the check constraint accepts. */
export function cleanVisitMarkers(markers: CarePlanVisitMarker[]): CarePlanVisitMarker[] {
  const whole = (v: unknown) => {
    const n = Math.round(Number(v))
    return Number.isFinite(n) && n >= 1 && n <= 999 ? n : null
  }
  const out: CarePlanVisitMarker[] = []
  for (const m of markers) {
    const at = whole(m.at)
    if (at === null) continue
    const every = m.every == null ? null : whole(m.every)
    const label = m.label?.trim().slice(0, 40) || null
    out.push({ at, every, appointment_type_id: m.appointment_type_id || null, label })
  }
  return out.slice(0, MAX_VISIT_MARKERS)
}

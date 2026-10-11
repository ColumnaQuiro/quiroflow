// A care plan as the patient sees it: how far along they are, which of its
// visits are already booked, and how many still have no date.
//
// Counted the way the staff record counts it (components/patients/PhaseStats.vue):
// every visit since the plan started, attended ones as done. A visit marked
// as missed or cancelled is neither done nor booked -- it is one the plan
// still needs.
export interface PlanVisit {
  id: string
  starts_at: string
  status: string
}

export interface PlanProgress<V extends PlanVisit> {
  done: number
  left: number
  /** Booked visits still ahead, soonest first. */
  booked: V[]
  /** Visits the plan still needs that have no date yet. */
  toBook: number
  pct: number
}

export function patientPlanProgress<V extends PlanVisit>(plan: { total_visits: number; started_at: string }, visits: V[], now: Date): PlanProgress<V> {
  const inPlan = visits.filter((v) => v.starts_at >= plan.started_at)
  const done = inPlan.filter((v) => v.status === 'completed').length
  const nowIso = now.toISOString()
  const booked = inPlan.filter((v) => v.status === 'booked' && v.starts_at >= nowIso).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const left = Math.max(0, plan.total_visits - done)
  return {
    done,
    left,
    booked,
    toBook: Math.max(0, left - booked.length),
    pct: plan.total_visits > 0 ? Math.min(100, Math.round((done / plan.total_visits) * 100)) : 0,
  }
}

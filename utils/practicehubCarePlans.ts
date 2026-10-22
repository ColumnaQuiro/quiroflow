// What a PracticeHub 2.0 care plan becomes in QuiroFlow.
//
// PracticeHub 2.0 merged Classic's packages and memberships into "care plans":
// a visit schedule plus a billing type. Its own migration turns each Classic
// prepaid package into a care plan with Prepayment billing (the visits left
// become the plan's allowance, the money paid becomes plan credit) and each
// membership into one with Membership billing. So for a clinic that has
// switched, its bonos and memberships are care plans, read from
// GET /v3/api/care_plans/{id} -- the list leaves out `billing.periods`, where
// the visits and the money are.
//
// Pure: no database, no network. The importer applies the result.

export interface V3BillingPeriod {
  period_number: number
  start_date: string | null
  end_date: string | null
  status: string
  amount_due: string | null
  amount_paid: string | null
  visits_expected: number | null
  visits_used: number | null
  rollover_visits: number | null
}

export interface V3CarePlan {
  id: number
  patient_id: number
  name: string
  status: string
  billing: {
    billing_type: string
    status: string | null
    start_date: string | null
    interval_unit: string | null
    interval_length: number | null
    is_ongoing: boolean | null
    total_price: string | null
    periods?: V3BillingPeriod[]
  } | null
  members?: { patient_id: number; status: string }[]
  schedules?: { patient_id: number; tracking?: { total_planned: number | null; total_completed: number | null } | null }[]
}

export type CarePlanOutcome =
  | {
      kind: 'bono'
      name: string
      sessionsTotal: number
      sessionsUsed: number
      priceCents: number
      paidCents: number
      owedCents: number
      startedOn: string | null
      closed: boolean
      /** Everyone sharing it, the holder included (PracticeHub patient ids). */
      patientIds: number[]
    }
  | {
      kind: 'membership'
      name: string
      /** Charged each interval. */
      priceCents: number
      intervalUnit: 'week' | 'month' | 'year'
      intervalLength: number
      startedOn: string | null
      ended: boolean
      patientIds: number[]
    }
  | { kind: 'skip'; reason: 'no_billing' | 'pay_as_you_go' | 'third_party' | 'postpay' }

const FINISHED = new Set(['completed', 'cancelled', 'expired'])

/** "460.00" -> 46000. PracticeHub sends money as 2-decimal strings. */
export function v3Cents(amount: string | null | undefined): number {
  if (!amount) return 0
  const n = Number(amount)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

function patientIdsOf(plan: V3CarePlan): number[] {
  const ids = new Set<number>([plan.patient_id])
  for (const m of plan.members ?? []) if (m.status !== 'removed') ids.add(m.patient_id)
  return [...ids]
}

export function carePlanOutcome(plan: V3CarePlan): CarePlanOutcome {
  const b = plan.billing
  if (!b) return { kind: 'skip', reason: 'no_billing' }
  const finished = FINISHED.has(plan.status)

  // Prepaid sessions -- a bono. An instalment plan is the same course paid in
  // parts, so it is a bono that may still be owed money.
  if (b.billing_type === 'prepayment' || b.billing_type === 'installment') {
    const periods = b.periods ?? []
    let total = periods.reduce((s, p) => s + (p.visits_expected ?? 0) + (p.rollover_visits ?? 0), 0)
    let used = periods.reduce((s, p) => s + (p.visits_used ?? 0), 0)
    // No periods (the list response, or a plan with no allowance set): the
    // schedule's own tracking is the next best count.
    if (total === 0) {
      const tr = plan.schedules?.find((s) => s.patient_id === plan.patient_id)?.tracking
      total = tr?.total_planned ?? 0
      used = tr?.total_completed ?? 0
    }
    const due = periods.reduce((s, p) => s + v3Cents(p.amount_due), 0)
    const paid = periods.reduce((s, p) => s + v3Cents(p.amount_paid), 0)
    return {
      kind: 'bono',
      name: plan.name,
      sessionsTotal: total,
      sessionsUsed: Math.min(used, total),
      priceCents: v3Cents(b.total_price),
      paidCents: paid,
      owedCents: finished ? 0 : Math.max(0, due - paid),
      startedOn: b.start_date,
      closed: finished || (total > 0 && used >= total),
      patientIds: patientIdsOf(plan),
    }
  }

  if (b.billing_type === 'membership') {
    const unit = b.interval_unit === 'week' || b.interval_unit === 'year' ? b.interval_unit : 'month'
    return {
      kind: 'membership',
      name: plan.name,
      priceCents: v3Cents(b.total_price),
      intervalUnit: unit,
      intervalLength: b.interval_length && b.interval_length > 0 ? b.interval_length : 1,
      startedOn: b.start_date,
      ended: finished,
      patientIds: patientIdsOf(plan),
    }
  }

  // Nothing prepaid to carry over: visits are charged as they happen (or to
  // an insurer), which the ledger import brings across as invoices.
  if (b.billing_type === 'third_party') return { kind: 'skip', reason: 'third_party' }
  if (b.billing_type === 'postpay') return { kind: 'skip', reason: 'postpay' }
  return { kind: 'skip', reason: 'pay_as_you_go' }
}

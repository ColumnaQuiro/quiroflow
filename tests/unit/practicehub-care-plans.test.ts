import { describe, it, expect } from 'vitest'
import { carePlanOutcome, v3Cents, type V3CarePlan } from '../../utils/practicehubCarePlans'

// A PracticeHub 2.0 care plan, shaped as GET /v3/api/care_plans/{id} returns
// it (build.practicehub.io openapi), and what it becomes here.

const base = (billing: V3CarePlan['billing'], extra: Partial<V3CarePlan> = {}): V3CarePlan => ({ id: 1, patient_id: 10, name: 'Bono 12', status: 'active', billing, ...extra })
const period = (o: Partial<import('../../utils/practicehubCarePlans').V3BillingPeriod>) => ({ period_number: 1, start_date: '2026-09-01', end_date: null, status: 'paid', amount_due: '0.00', amount_paid: '0.00', visits_expected: 0, visits_used: 0, rollover_visits: 0, ...o })

describe('carePlanOutcome', () => {
  it('turns a Prepayment plan into a bono, with the visits and the money from its periods', () => {
    const out = carePlanOutcome(
      base(
        { billing_type: 'prepayment', status: 'active', start_date: '2026-09-01', interval_unit: null, interval_length: null, is_ongoing: false, total_price: '528.00', periods: [period({ amount_due: '528.00', amount_paid: '528.00', visits_expected: 12, visits_used: 7 })] },
        { members: [{ patient_id: 10, status: 'active' }, { patient_id: 11, status: 'active' }, { patient_id: 12, status: 'removed' }] },
      ),
    )
    expect(out).toEqual({ kind: 'bono', name: 'Bono 12', sessionsTotal: 12, sessionsUsed: 7, priceCents: 52800, paidCents: 52800, owedCents: 0, startedOn: '2026-09-01', closed: false, patientIds: [10, 11] })
  })

  it('counts rollover visits, owes what is unpaid, and closes once used up', () => {
    const owing = carePlanOutcome(base({ billing_type: 'installment', status: 'active', start_date: null, interval_unit: 'month', interval_length: 1, is_ongoing: false, total_price: '480.00', periods: [period({ amount_due: '240.00', amount_paid: '240.00', visits_expected: 6 }), period({ period_number: 2, status: 'due', amount_due: '240.00', amount_paid: '0.00', visits_expected: 6, rollover_visits: 1, visits_used: 2 })] }))
    expect(owing).toMatchObject({ kind: 'bono', sessionsTotal: 13, sessionsUsed: 2, owedCents: 24000, closed: false })
    const usedUp = carePlanOutcome(base({ billing_type: 'prepayment', status: 'active', start_date: null, interval_unit: null, interval_length: null, is_ongoing: false, total_price: '100.00', periods: [period({ visits_expected: 2, visits_used: 2 })] }))
    expect(usedUp).toMatchObject({ kind: 'bono', closed: true })
  })

  it('falls back to the schedule tracking when the plan has no periods (the list response)', () => {
    const out = carePlanOutcome(base({ billing_type: 'prepayment', status: 'completed', start_date: null, interval_unit: null, interval_length: null, is_ongoing: false, total_price: '460.00' }, { status: 'completed', schedules: [{ patient_id: 10, tracking: { total_planned: 10, total_completed: 4 } }] }))
    expect(out).toMatchObject({ kind: 'bono', sessionsTotal: 10, sessionsUsed: 4, owedCents: 0, closed: true })
  })

  it('turns Membership billing into a membership with its interval', () => {
    expect(carePlanOutcome(base({ billing_type: 'membership', status: 'active', start_date: '2026-10-01', interval_unit: 'month', interval_length: 1, is_ongoing: true, total_price: '240.00' }, { name: 'Bono Mantenimiento' }))).toEqual({
      kind: 'membership',
      name: 'Bono Mantenimiento',
      priceCents: 24000,
      intervalUnit: 'month',
      intervalLength: 1,
      startedOn: '2026-10-01',
      ended: false,
      patientIds: [10],
    })
  })

  it('skips what has nothing prepaid to carry over', () => {
    expect(carePlanOutcome(base(null))).toEqual({ kind: 'skip', reason: 'no_billing' })
    for (const [type, reason] of [['payg', 'pay_as_you_go'], ['third_party', 'third_party'], ['postpay', 'postpay']] as const) {
      expect(carePlanOutcome(base({ billing_type: type, status: 'active', start_date: null, interval_unit: null, interval_length: null, is_ongoing: false, total_price: null }))).toEqual({ kind: 'skip', reason })
    }
  })
})

describe('v3Cents', () => {
  it('reads PracticeHub money strings', () => {
    expect([v3Cents('460.00'), v3Cents('0.10'), v3Cents(null), v3Cents('n/a')]).toEqual([46000, 10, 0, 0])
  })
})

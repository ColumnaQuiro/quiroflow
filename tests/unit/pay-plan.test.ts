import { describe, expect, it } from 'vitest'
import { computePay, payFactsByMember, visitPay, EMPTY_PAY_PLAN, type PayPlan } from '../../utils/payPlan'

// A month's pay from a pay plan (utils/payPlan.ts). The two plans a clinic
// actually runs: a share of the payments, and a fixed base plus a per-visit
// rate that rises with the month's visits -- in each of the three tier modes.
const tiers = [
  { from: 20, cents: 1200 },
  { from: 30, cents: 1500 },
]
const plan = (p: Partial<PayPlan>): PayPlan => ({ ...EMPTY_PAY_PLAN, ...p })

describe('visitPay', () => {
  it("'reached': every visit at the rate of the tier reached", () => {
    expect(visitPay(plan({ visit_cents: 1000, tier_mode: 'reached', tiers }), 35).cents).toBe(35 * 1500)
    expect(visitPay(plan({ visit_cents: 1000, tier_mode: 'reached', tiers }), 25).cents).toBe(25 * 1200)
    expect(visitPay(plan({ visit_cents: 1000, tier_mode: 'reached', tiers }), 12).cents).toBe(12 * 1000)
  })
  it("'band': each visit at the rate of its own band, like tax brackets", () => {
    // Visits 1-19 at 10, 20-29 at 12, 30-35 at 15.
    const r = visitPay(plan({ visit_cents: 1000, tier_mode: 'band', tiers }), 35)
    expect(r.cents).toBe(19 * 1000 + 10 * 1200 + 6 * 1500)
    expect(r.detail).toBe('19 × 10,00 € + 10 × 12,00 € + 6 × 15,00 €'.replace(/ €/g, ' €'))
  })
  it("'bonus': the per-visit rate, plus a lump for each tier reached", () => {
    expect(visitPay(plan({ visit_cents: 1000, tier_mode: 'bonus', tiers: [{ from: 20, cents: 5000 }, { from: 30, cents: 8000 }] }), 31).cents).toBe(31 * 1000 + 5000 + 8000)
  })
  it('no visits, no visit pay; tiers out of order or repeated are tidied', () => {
    expect(visitPay(plan({ visit_cents: 1000 }), 0).cents).toBe(0)
    expect(visitPay(plan({ tier_mode: 'reached', tiers: [{ from: 30, cents: 1500 }, { from: 20, cents: 1200 }, { from: 20, cents: 999 }] }), 25).cents).toBe(25 * 1200)
  })
})

describe('computePay', () => {
  it('a share of the month’s payments', () => {
    const r = computePay(plan({ payments_pct: 35 }), { paymentsCents: 420000, visits: 80, newPatients: 4, salesCents: 0 })
    expect(r.totalCents).toBe(147000)
    expect(r.lines.map((l) => l.key)).toEqual(['payments'])
  })
  it('a fixed base plus tiered visits, a new-patient bonus and a share of sales', () => {
    const r = computePay(plan({ base_cents: 100000, visit_cents: 1000, tier_mode: 'reached', tiers, new_patient_cents: 1000, sales_pct: 5 }), { paymentsCents: 0, visits: 32, newPatients: 3, salesCents: 60000 })
    expect(r.lines.map((l) => [l.key, l.cents])).toEqual([
      ['base', 100000],
      ['visits', 32 * 1500],
      ['new_patients', 3000],
      ['sales', 3000],
    ])
    expect(r.totalCents).toBe(100000 + 48000 + 3000 + 3000)
  })
})

describe('payFactsByMember', () => {
  it('attributes payments, visits, first visits and sales to the right person', () => {
    const m = payFactsByMember({
      payments: [
        { cents: 4500, practitionerId: 'ana' },
        { cents: 6000, practitionerId: 'ana' },
        { cents: 3000, practitionerId: 'leo' },
        { cents: 999, practitionerId: null },
      ],
      visits: [
        { practitionerId: 'ana', patientId: 'p1' },
        { practitionerId: 'ana', patientId: 'p1' },
        { practitionerId: 'leo', patientId: 'p2' },
        { practitionerId: 'leo', patientId: 'old' },
      ],
      seenBefore: new Set(['old']),
      sales: [{ cents: 30000, soldBy: 'desk' }],
    })
    expect(m.get('ana')).toEqual({ paymentsCents: 10500, visits: 2, newPatients: 1, salesCents: 0 })
    expect(m.get('leo')).toEqual({ paymentsCents: 3000, visits: 2, newPatients: 1, salesCents: 0 })
    expect(m.get('desk')).toEqual({ paymentsCents: 0, visits: 0, newPatients: 0, salesCents: 30000 })
  })
})

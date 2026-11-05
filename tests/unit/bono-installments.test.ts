import { describe, it, expect } from 'vitest'
import { bonoDueCents, installmentBeingPaid, installmentsDue, readInstallmentOptions } from '../../utils/bonoInstallments'
import { bonoDueNowCents, bonoOwedCents } from '../../utils/bonoOwed'

// A bono sold in plazos owes everything not yet paid, but only the plazos
// already due are a debt: plazo k falls due once the sessions the plazos before
// it paid for have been used.
const tenInTwo = { installments: 2, installmentCents: 25000, sessionsTotal: 10 }

describe('installmentsDue', () => {
  it('has the first plazo due at the sale and the second once 5 of 10 sessions are used', () => {
    expect(installmentsDue({ ...tenInTwo, sessionsUsed: 0 })).toBe(1)
    expect(installmentsDue({ ...tenInTwo, sessionsUsed: 4 })).toBe(1)
    expect(installmentsDue({ ...tenInTwo, sessionsUsed: 5 })).toBe(2)
    expect(installmentsDue({ ...tenInTwo, sessionsUsed: 10 })).toBe(2)
  })

  it('spreads plazos that do not divide the sessions evenly', () => {
    const tenInThree = { installments: 3, installmentCents: 18000, sessionsTotal: 10 }
    expect([0, 2, 3, 5, 6].map((sessionsUsed) => installmentsDue({ ...tenInThree, sessionsUsed }))).toEqual([1, 1, 2, 2, 3])
  })

  it('treats a bono paid at once as wholly due', () => {
    expect(installmentsDue({ installments: null, installmentCents: null, sessionsTotal: 10, sessionsUsed: 0 })).toBe(1)
  })
})

describe('bonoDueCents', () => {
  it('owes nothing between plazos once the first is paid', () => {
    expect(bonoDueCents(25000, { ...tenInTwo, sessionsUsed: 3 })).toBe(0)
    expect(bonoDueCents(25000, { ...tenInTwo, sessionsUsed: 5 })).toBe(25000)
  })

  it('owes the first plazo at the sale, not the whole bono', () => {
    expect(bonoDueCents(50000, { ...tenInTwo, sessionsUsed: 0 })).toBe(25000)
  })

  it('counts money paid ahead of a plazo towards it', () => {
    expect(bonoDueCents(20000, { ...tenInTwo, sessionsUsed: 0 })).toBe(0)
    expect(bonoDueCents(20000, { ...tenInTwo, sessionsUsed: 6 })).toBe(20000)
  })

  it('leaves a bono paid at once alone', () => {
    expect(bonoDueCents(30000, null)).toBe(30000)
    expect(bonoDueCents(30000, { installments: null, installmentCents: null, sessionsTotal: 10, sessionsUsed: 0 })).toBe(30000)
  })
})

describe('bonoDueNowCents', () => {
  it('is what is owed less the plazos still to come', () => {
    const input = {
      purchaseId: 'b1',
      invoiceId: null,
      priceCents: 54000,
      owedCents: 54000,
      invoice: null,
      payments: [{ amount_cents: 18000, invoice_id: null, package_purchase_id: 'b1', external_reference: null, purpose: 'bono' }],
    }
    expect(bonoOwedCents(input)).toBe(36000)
    const plan = { installments: 3, installmentCents: 18000, sessionsTotal: 10 }
    expect(bonoDueNowCents({ ...input, plan: { ...plan, sessionsUsed: 1 } })).toBe(0)
    expect(bonoDueNowCents({ ...input, plan: { ...plan, sessionsUsed: 3 } })).toBe(18000)
    expect(bonoDueNowCents({ ...input, plan: { ...plan, sessionsUsed: 6 } })).toBe(36000)
  })
})

describe('installmentBeingPaid', () => {
  const plan = { installments: 2, installmentCents: 25000 }
  it('names the plazo a one-plazo payment is', () => {
    expect(installmentBeingPaid(plan, 0, 25000)).toEqual({ number: 1, of: 2 })
    expect(installmentBeingPaid(plan, 25000, 25000)).toEqual({ number: 2, of: 2 })
  })

  it('names nothing for any other amount, or past the last plazo', () => {
    expect(installmentBeingPaid(plan, 0, 50000)).toBeNull()
    expect(installmentBeingPaid(plan, 10000, 25000)).toBeNull()
    expect(installmentBeingPaid(plan, 50000, 25000)).toBeNull()
    expect(installmentBeingPaid({ installments: null, installmentCents: null }, 0, 25000)).toBeNull()
  })
})

describe('readInstallmentOptions', () => {
  it('keeps well-formed options, sorted, one per number of plazos', () => {
    expect(
      readInstallmentOptions([
        { installments: 3, installment_cents: 18000 },
        { installments: 2, installment_cents: 25000 },
        { installments: 2, installment_cents: 26000 },
        { installments: 1, installment_cents: 50000 },
        { installments: 4.5, installment_cents: 100 },
        'nonsense',
      ]),
    ).toEqual([
      { installments: 2, installmentCents: 25000 },
      { installments: 3, installmentCents: 18000 },
    ])
    expect(readInstallmentOptions(null)).toEqual([])
  })
})

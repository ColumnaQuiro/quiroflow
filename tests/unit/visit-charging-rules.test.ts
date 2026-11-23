import { describe, it, expect } from 'vitest'
import {
  bonoPerSessionCents,
  bonoVisitChargeCents,
  creditExceedsSpendable,
  isVisitUpcoming,
  lineItemsTotalCents,
  linePriceChangeable,
  openingPaymentRows,
  planInvoiceUnderBono,
  practiceHubChargedAtPurchase,
  visitLineMissing,
} from '../../utils/visitCharging'

// The decisions behind charging one visit, shared by the calendar's Billing
// tab and the staff app's visit screen -- see utils/visitCharging.ts.

const line = (id: string, over: Partial<{ price_cents: number; quantity: number; service_id: string | null }> = {}) => ({
  id,
  price_cents: 4400,
  quantity: 1,
  service_id: null,
  ...over,
})

describe('What a visit is worth against a bono', () => {
  it('is the price over the sessions, rounded once', () => {
    expect(bonoPerSessionCents({ price_cents: 26400, sessions_total: 6 })).toBe(4400)
    // 100 / 3 = 33.33 -> 33 cents
    expect(bonoPerSessionCents({ price_cents: 100, sessions_total: 3 })).toBe(33)
    // 200 / 3 = 66.67 -> 67 cents
    expect(bonoPerSessionCents({ price_cents: 200, sessions_total: 3 })).toBe(67)
  })

  it('is nothing for a bono with no sessions, not Infinity', () => {
    expect(bonoPerSessionCents({ price_cents: 26400, sessions_total: 0 })).toBe(0)
  })
})

describe('What a visit is charged against a bono', () => {
  it('is the per-session rate for a bono sold without an invoice', () => {
    expect(bonoVisitChargeCents({ price_cents: 80000, sessions_total: 20 })).toBe(4000)
    expect(bonoVisitChargeCents({ price_cents: 80000, sessions_total: 20, charged_at_purchase: false })).toBe(4000)
  })

  // A Bono 20 invoiced at 800 when it was sold, sessions at 0 in PracticeHub.
  // Charging 40 here billed a session the bono's own invoice had paid for.
  it('is nothing for a bono whose price was invoiced when it was sold', () => {
    expect(bonoVisitChargeCents({ price_cents: 80000, sessions_total: 20, charged_at_purchase: true })).toBe(0)
  })

  it('leaves what a session is worth alone', () => {
    expect(bonoPerSessionCents({ price_cents: 80000, sessions_total: 20 })).toBe(4000)
  })
})

describe('Whether PracticeHub has already invoiced a bono in full', () => {
  it('is no for a clinic that charges every visit', () => {
    expect(practiceHubChargedAtPurchase({ visits: 10, visits_left: 4, free_visits: 0 })).toBe(false)
    expect(practiceHubChargedAtPurchase({ visits: 10, visits_left: 0, free_visits: 0 })).toBe(false)
    expect(practiceHubChargedAtPurchase({ visits: 10, visits_left: 4 })).toBe(false)
  })

  // Bono 20 NEW: free_visits 19, the 800 on the visit it was bought at.
  it('is yes once the charged visit is behind it', () => {
    expect(practiceHubChargedAtPurchase({ visits: 20, visits_left: 15, free_visits: 19 })).toBe(true)
    expect(practiceHubChargedAtPurchase({ visits: 20, visits_left: 19, free_visits: 19 })).toBe(true)
    expect(practiceHubChargedAtPurchase({ visits: 20, visits_left: 0, free_visits: 19 })).toBe(true)
  })

  // Nothing invoiced yet: charging per session here is what collects it.
  it('is no while a visit PracticeHub would charge is still to come', () => {
    expect(practiceHubChargedAtPurchase({ visits: 20, visits_left: 20, free_visits: 19 })).toBe(false)
    // Paid in two instalments on two visits; only the first has happened.
    expect(practiceHubChargedAtPurchase({ visits: 20, visits_left: 19, free_visits: 18 })).toBe(false)
    expect(practiceHubChargedAtPurchase({ visits: 20, visits_left: 18, free_visits: 18 })).toBe(true)
  })
})

describe("An invoice's total", () => {
  it('counts quantity', () => {
    // The app's copy summed price_cents alone, so two of something cost one.
    expect(lineItemsTotalCents([line('a', { price_cents: 1500, quantity: 2 }), line('b', { price_cents: 4400 })])).toBe(7400)
  })

  it('is zero with no lines', () => {
    expect(lineItemsTotalCents([])).toBe(0)
  })
})

describe('Whether the visit has happened yet', () => {
  const now = new Date('2026-10-03T10:00:00Z')

  it('is upcoming when it starts later and nobody has checked in', () => {
    expect(isVisitUpcoming({ starts_at: '2026-10-03T10:30:00Z', checked_in_at: null }, now)).toBe(true)
  })

  it('is not upcoming once the patient has checked in early', () => {
    expect(isVisitUpcoming({ starts_at: '2026-10-03T10:30:00Z', checked_in_at: '2026-10-03T09:50:00Z' }, now)).toBe(false)
  })

  it('is not upcoming once its time has passed', () => {
    expect(isVisitUpcoming({ starts_at: '2026-10-03T09:00:00Z', checked_in_at: null }, now)).toBe(false)
  })

  it('is not upcoming when there is no appointment to read', () => {
    expect(isVisitUpcoming(null, now)).toBe(false)
  })
})

describe('An invoice the visit carries when a bono then pays for it', () => {
  it('is deleted when it holds only the visit and nothing was collected', () => {
    expect(planInvoiceUnderBono([line('visit')], 0)).toEqual({ action: 'delete' })
  })

  it('is never deleted once money was taken against it -- payments cascade', () => {
    expect(planInvoiceUnderBono([line('visit', { price_cents: 5500 })], 1)).toEqual({ action: 'reprice', removeLineId: 'visit', totalCents: 0 })
  })

  it('keeps the extras and drops the covered visit line', () => {
    const plan = planInvoiceUnderBono(
      [line('visit', { price_cents: 5500 }), line('cream', { price_cents: 1200, quantity: 2, service_id: 'svc-cream' })],
      0,
    )
    expect(plan).toEqual({ action: 'reprice', removeLineId: 'visit', totalCents: 2400 })
  })

  it('reprices without removing anything when there is no visit line', () => {
    const plan = planInvoiceUnderBono([line('cream', { price_cents: 1200, service_id: 'svc-cream' })], 0)
    expect(plan).toEqual({ action: 'reprice', removeLineId: null, totalCents: 1200 })
  })
})

describe('Spending credit on a visit', () => {
  it('is refused past what is spendable', () => {
    expect(creditExceedsSpendable(5000, 4000)).toBe(true)
  })

  it('is allowed up to exactly what is spendable', () => {
    expect(creditExceedsSpendable(4000, 4000)).toBe(false)
  })

  it('never blocks a payment that spends no credit, whatever the figure reads', () => {
    expect(creditExceedsSpendable(0, -1200)).toBe(false)
  })
})

describe('The payment form a visit opens with', () => {
  it('opens on the default method when there is no credit', () => {
    expect(openingPaymentRows(10000, 0, 'card')).toEqual([{ method: 'card', cents: 10000 }])
  })

  it('opens on credit when it covers the visit', () => {
    expect(openingPaymentRows(10000, 10000, 'card')).toEqual([{ method: 'credit', cents: 10000 }])
  })

  it('never offers more credit than is due', () => {
    expect(openingPaymentRows(4400, 10000, 'card')).toEqual([{ method: 'credit', cents: 4400 }])
  })

  it('splits when credit covers part of it, the rest on the default method', () => {
    expect(openingPaymentRows(10000, 5000, 'card')).toEqual([
      { method: 'credit', cents: 5000 },
      { method: 'card', cents: 5000 },
    ])
  })

  it('leaves a fully paid visit alone', () => {
    expect(openingPaymentRows(0, 5000, 'cash')).toEqual([{ method: 'cash', cents: 0 }])
  })
})

describe('visitLineMissing', () => {
  const open = { invoiceStatus: 'unpaid', coveredByBono: false, chargedToThirdParty: false, visitPriceCents: 6500 }

  it('offers the visit on a receipt left with no lines, raised while the type cost 0 €', () => {
    expect(visitLineMissing({ ...open, lines: [] })).toBe(true)
  })

  it('offers it when the visit line is still at the 0 € it was raised with', () => {
    expect(visitLineMissing({ ...open, lines: [{ price_cents: 0, service_id: null }] })).toBe(true)
  })

  it('a service on the receipt is not the visit', () => {
    expect(visitLineMissing({ ...open, lines: [{ price_cents: 1500, service_id: 'svc' }] })).toBe(true)
  })

  it('does not offer it when the visit is already on at a price', () => {
    expect(visitLineMissing({ ...open, lines: [{ price_cents: 6500, service_id: null }] })).toBe(false)
  })

  it('does not offer it on a closed receipt, a bono visit or a type with no price', () => {
    expect(visitLineMissing({ ...open, invoiceStatus: 'paid', lines: [] })).toBe(false)
    expect(visitLineMissing({ ...open, invoiceStatus: 'void', lines: [] })).toBe(false)
    expect(visitLineMissing({ ...open, invoiceStatus: null, lines: [] })).toBe(false)
    expect(visitLineMissing({ ...open, coveredByBono: true, lines: [] })).toBe(false)
    // An insurer paying the whole visit leaves the patient's line at 0 € on purpose.
    expect(visitLineMissing({ ...open, chargedToThirdParty: true, lines: [{ price_cents: 0, service_id: null }] })).toBe(false)
    expect(visitLineMissing({ ...open, visitPriceCents: 0, lines: [] })).toBe(false)
  })
})

describe('A special price on the visit (seniors, students...)', () => {
  const visitLine = { service_id: null, package_purchase_id: null }
  const open = { invoiceStatus: 'unpaid', totalCents: 4500, paymentCount: 0, coveredByBono: false, chargedToThirdParty: false, line: visitLine }

  it('can be set on an open receipt nothing has been paid on', () => {
    expect(linePriceChangeable(open)).toBe(true)
  })

  it('is closed once any money is taken -- that payment has its factura', () => {
    // Part paid: still 'unpaid', but a factura exists for what came in.
    expect(linePriceChangeable({ ...open, paymentCount: 1 })).toBe(false)
    expect(linePriceChangeable({ ...open, invoiceStatus: 'paid', paymentCount: 1 })).toBe(false)
  })

  it('is closed on a paid or void receipt', () => {
    expect(linePriceChangeable({ ...open, invoiceStatus: 'paid' })).toBe(false)
    expect(linePriceChangeable({ ...open, invoiceStatus: 'void' })).toBe(false)
    expect(linePriceChangeable({ ...open, invoiceStatus: null })).toBe(false)
  })

  it('is open on a free visit\'s 0 € receipt, raised paid with nothing paid on it', () => {
    expect(linePriceChangeable({ ...open, invoiceStatus: 'paid', totalCents: 0 })).toBe(true)
  })

  it('is only the visit itself: not a service, not a bono session', () => {
    expect(linePriceChangeable({ ...open, line: { service_id: 'svc', package_purchase_id: null } })).toBe(false)
    expect(linePriceChangeable({ ...open, line: { service_id: null, package_purchase_id: 'bono' } })).toBe(false)
  })

  it('is not offered on a visit drawn from a bono or split with an insurer', () => {
    expect(linePriceChangeable({ ...open, coveredByBono: true })).toBe(false)
    expect(linePriceChangeable({ ...open, chargedToThirdParty: true })).toBe(false)
  })
})

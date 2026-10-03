import { describe, it, expect } from 'vitest'
import { bonoPerSessionCents, creditExceedsLedger, isVisitUpcoming, lineItemsTotalCents, planInvoiceUnderBono } from '../../utils/visitCharging'

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
  it('is refused past what the credit ledger holds', () => {
    expect(creditExceedsLedger(5000, 4000)).toBe(true)
  })

  it('is allowed up to exactly the ledger', () => {
    expect(creditExceedsLedger(4000, 4000)).toBe(false)
  })

  it('never blocks a payment that spends no credit, whatever the ledger reads', () => {
    expect(creditExceedsLedger(0, -1200)).toBe(false)
  })
})

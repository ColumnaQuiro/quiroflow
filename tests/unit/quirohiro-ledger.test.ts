import { describe, expect, it } from 'vitest'
import { quirohiroBonoSessions, quirohiroBonoSessionsUsed, quirohiroLedgerRows, quirohiroPaymentMethod, type QuirohiroInvoice, type QuirohiroTransaction } from '../../utils/quirohiroRows'

// QuiroHiro's (GoHighLevel's) invoices and payments as QuiroFlow's charges,
// payments and bonos. Every amount and contact here is invented.

const inv = (o: Partial<QuirohiroInvoice> & { _id: string }): QuirohiroInvoice => ({
  status: 'paid', liveMode: true, currency: 'EUR', contactDetails: { id: 'c1' }, issueDate: '2026-03-01T10:00:00.000Z', total: 45, amountPaid: 45, amountDue: 0, invoiceItems: [{ name: 'Sesión de ajuste', amount: 45, qty: 1 }], ...o,
})
const tx = (o: Partial<QuirohiroTransaction> & { _id: string }): QuirohiroTransaction => ({
  contactId: 'c1', status: 'succeeded', liveMode: true, currency: 'EUR', amount: 45, paymentProviderType: 'stripe', createdAt: '2026-03-01T10:05:00.000Z', ...o,
})

describe('QuiroHiro invoices and payments', () => {
  it('pairs a paid invoice with its payment, in cents', () => {
    const l = quirohiroLedgerRows({ invoices: [inv({ _id: 'i1', invoiceNumber: 'INV-7' })], transactions: [tx({ _id: 't1', entityType: 'invoice', entityId: 'i1' })] })
    expect(l.charges).toEqual([expect.objectContaining({ ref: 'QH-inv-i1', patientRef: 'QH-c1', number: 'QHI-INV-7', totalCents: 4500, status: 'paid' })])
    expect(l.payments).toEqual([expect.objectContaining({ ref: 'QH-pay-t1', amountCents: 4500, method: 'card', chargeRef: 'QH-inv-i1' })])
    expect(l.transactionsInCents).toBe(false)
  })

  it('keeps an unpaid invoice owed, and leaves drafts, voids, test mode and other currencies out', () => {
    const l = quirohiroLedgerRows({
      invoices: [
        inv({ _id: 'owed', status: 'sent', amountPaid: 0, amountDue: 45 }),
        inv({ _id: 'draft', status: 'draft' }),
        inv({ _id: 'void', status: 'void' }),
        inv({ _id: 'test', liveMode: false }),
        inv({ _id: 'usd', currency: 'USD' }),
      ],
      transactions: [],
    })
    expect(l.charges.map((c) => [c.ref, c.status])).toEqual([['QH-inv-owed', 'unpaid']])
    expect(l.payments).toEqual([])
    expect(l.skipped).toMatchObject({ test: 1, notEuro: 1 })
  })

  it('gives a payment with no invoice a paid receipt of its own, net of refunds', () => {
    const l = quirohiroLedgerRows({ invoices: [], transactions: [tx({ _id: 't2', entityType: 'order', entitySourceName: 'Primera visita online', amount: 50, amountRefunded: 10, status: 'partially_refunded' }), tx({ _id: 'gone', status: 'refunded' })] })
    expect(l.charges).toEqual([expect.objectContaining({ ref: 'QH-sale-t2', totalCents: 4000, status: 'paid', what: 'Primera visita online' })])
    expect(l.payments).toEqual([expect.objectContaining({ ref: 'QH-pay-t2', amountCents: 4000, chargeRef: 'QH-sale-t2' })])
  })

  it('adds the part of a paid invoice recorded by hand in QuiroHiro as a payment', () => {
    const l = quirohiroLedgerRows({ invoices: [inv({ _id: 'i3', total: 90, amountPaid: 90 })], transactions: [tx({ _id: 't3', entityType: 'invoice', entityId: 'i3', amount: 50 })] })
    expect(l.payments.map((p) => [p.ref, p.amountCents, p.method])).toEqual([['QH-pay-t3', 5000, 'card'], ['QH-invpay-i3', 4000, 'other']])
  })

  it('reads payments counted in cents by the invoices they paid', () => {
    const l = quirohiroLedgerRows({ invoices: [inv({ _id: 'i4', total: 45 })], transactions: [tx({ _id: 't4', entityType: 'invoice', entityId: 'i4', amount: 4500 })] })
    expect(l.transactionsInCents).toBe(true)
    expect(l.payments[0]!.amountCents).toBe(4500)
  })
})

describe('bonos', () => {
  it('reads the sessions out of the name, and only of a bono', () => {
    expect(quirohiroBonoSessions('Bono 10 sesiones')).toBe(10)
    expect(quirohiroBonoSessions('BONO 5 ajustes')).toBe(5)
    expect(quirohiroBonoSessions('Bono de 8')).toBe(8)
    expect(quirohiroBonoSessions('Bono familiar')).toBeNull()
    expect(quirohiroBonoSessions('Sesión de ajuste')).toBeUndefined()
  })

  it('makes a bono charged at sale from an invoice line, and one from a payment with no invoice', () => {
    const l = quirohiroLedgerRows({
      invoices: [inv({ _id: 'i5', total: 400, amountPaid: 400, invoiceItems: [{ name: 'Bono 10 sesiones', amount: 400, qty: 1 }] })],
      transactions: [tx({ _id: 't6', contactId: 'c2', entityType: 'payment_link', entitySourceName: 'Bono 5 ajustes', amount: 180 }), tx({ _id: 't7', entityType: 'order', entitySourceName: 'Bono familiar', amount: 300 })],
    })
    expect(l.bonos.map((b) => [b.ref, b.patientRef, b.sessionsTotal, b.priceCents, b.chargeRef])).toEqual([
      ['QH-bono-sale-t6', 'QH-c2', 5, 18000, 'QH-sale-t6'],
      ['QH-bono-i5-0', 'QH-c1', 10, 40000, 'QH-inv-i5'],
    ])
    expect(l.payments.find((p) => p.ref === 'QH-pay-t6')!.bonoRef).toBe('QH-bono-sale-t6')
    expect(l.bonosWithoutSessions).toEqual(['Bono familiar'])
  })

  it('counts the visits attended since each bono was bought, oldest bono first', () => {
    const bonos = [
      { ref: 'b2', patientRef: 'p', name: 'Bono 2', priceCents: 1, sessionsTotal: 2, purchasedAt: '2026-03-10T00:00:00.000Z', chargeRef: 'x' },
      { ref: 'b1', patientRef: 'p', name: 'Bono 2', priceCents: 1, sessionsTotal: 2, purchasedAt: '2026-03-01T00:00:00.000Z', chargeRef: 'x' },
    ]
    const visits = ['2026-02-20', '2026-03-02', '2026-03-05', '2026-03-12', '2026-03-20'].map((d) => ({ patientRef: 'p', startsAt: `${d}T10:00:00.000Z`, status: 'completed' }))
    visits.push({ patientRef: 'p', startsAt: '2026-03-25T10:00:00.000Z', status: 'cancelled' })
    expect(Object.fromEntries(quirohiroBonoSessionsUsed(bonos, visits))).toEqual({ b1: 2, b2: 2 })
  })
})

describe('payment methods', () => {
  it('names how the money was taken', () => {
    expect(quirohiroPaymentMethod({ paymentProviderType: 'stripe' })).toBe('card')
    expect(quirohiroPaymentMethod({ paymentProviderType: 'manual' })).toBe('other')
    expect(quirohiroPaymentMethod({ paymentProviderType: 'cash' })).toBe('cash')
  })
})

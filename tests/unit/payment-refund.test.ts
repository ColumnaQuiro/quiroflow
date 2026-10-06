import { describe, it, expect } from 'vitest'
import {
  isLoosePayment,
  onAccountShareCents,
  paymentRefundableCents,
  refundedAgainstPaymentCents,
  type LedgerPayment,
  type RefundablePayment,
  type RefundInvoice,
} from '../../utils/paymentRefund'

// Refunding one payment. See utils/paymentRefund.ts for why a payment with no
// invoice -- every imported PracticeHub payment -- is now refundable, and which
// ones still are not.

const none = new Set<string>()

const payment = (over: Partial<RefundablePayment> = {}): RefundablePayment => ({
  id: 'pay',
  invoice_id: null,
  amount_cents: 20400,
  method: 'card',
  purpose: null,
  package_purchase_id: null,
  ...over,
})

const refundInvoice = (over: Partial<RefundInvoice> & { id: string }): RefundInvoice => ({
  status: 'paid',
  total_cents: -3900,
  is_refund: true,
  refunds_invoice_id: null,
  refunds_payment_id: 'pay',
  ...over,
})

describe('A payment with no invoice', () => {
  it('can be refunded in full when nothing else hangs off it', () => {
    // Viviane Vieira Tostes: 204 EUR by card on 13 Aug, imported from
    // PracticeHub with no invoice. The button used to be missing entirely.
    expect(paymentRefundableCents(payment(), [], [], none)).toBe(20400)
  })

  it('can be refunded only for what has not gone back already', () => {
    const invoices = [refundInvoice({ id: 'ref' })]
    const payments: LedgerPayment[] = [{ invoice_id: 'ref', amount_cents: -3900, method: 'card' }]
    expect(paymentRefundableCents(payment(), invoices, payments, none)).toBe(16500)
  })

  it('counts what was paid out, not the refund invoice total, so on-account money cannot go back twice', () => {
    // 40 refunded, all of it unspent money on account: the refund invoice
    // carries none of it, the payment carries all of it.
    const invoices = [refundInvoice({ id: 'ref', total_cents: 0 })]
    const payments: LedgerPayment[] = [{ invoice_id: 'ref', amount_cents: -4000, method: 'card' }]
    expect(refundedAgainstPaymentCents('pay', invoices, payments)).toBe(4000)
    expect(paymentRefundableCents(payment(), invoices, payments, none)).toBe(16400)
  })

  it('reads a refund written before the split exactly as before', () => {
    // A refund invoice with no payment of its own on screen still counts.
    const invoices = [refundInvoice({ id: 'ref', total_cents: -3900 })]
    expect(refundedAgainstPaymentCents('pay', invoices, [])).toBe(3900)
  })

  it('stays unrefundable when it is a top-up, whose credit row would outlive the refund', () => {
    expect(paymentRefundableCents(payment({ purpose: 'on_account' }), [], [], none)).toBe(0)
    expect(paymentRefundableCents(payment(), [], [], new Set(['pay']))).toBe(0)
  })

  it('stays unrefundable when it paid for a bono or a membership', () => {
    expect(paymentRefundableCents(payment({ purpose: 'bono' }), [], [], none)).toBe(0)
    expect(paymentRefundableCents(payment({ package_purchase_id: 'bono-1' }), [], [], none)).toBe(0)
    expect(paymentRefundableCents(payment({ purpose: 'membership' }), [], [], none)).toBe(0)
  })

  it('is not money that came in when it is credit, a write-off, or a refund itself', () => {
    expect(paymentRefundableCents(payment({ method: 'credit' }), [], [], none)).toBe(0)
    expect(paymentRefundableCents(payment({ method: 'write_off' }), [], [], none)).toBe(0)
    expect(paymentRefundableCents(payment({ amount_cents: -3900 }), [], [], none)).toBe(0)
  })

  it('is loose only without an invoice', () => {
    expect(isLoosePayment(payment(), none)).toBe(true)
    expect(isLoosePayment(payment({ invoice_id: 'inv' }), none)).toBe(false)
  })
})

describe('A payment on a receipt', () => {
  const receipt: RefundInvoice = { id: 'inv', status: 'paid', total_cents: 5000, is_refund: false, refunds_invoice_id: null, refunds_payment_id: null }

  it('is capped by what is left of its receipt', () => {
    // 30 cash + 20 card on one receipt; 50 already refunded against the
    // receipt as a whole leaves the card payment nothing.
    const card = payment({ id: 'card', invoice_id: 'inv', amount_cents: 2000 })
    const invoices = [receipt, refundInvoice({ id: 'ref', total_cents: -5000, refunds_invoice_id: 'inv', refunds_payment_id: null })]
    const payments: LedgerPayment[] = [
      { invoice_id: 'inv', amount_cents: 3000, method: 'cash' },
      { invoice_id: 'inv', amount_cents: 2000, method: 'card' },
    ]
    expect(paymentRefundableCents(card, invoices, payments, none)).toBe(0)
  })

  it('is capped by its own amount', () => {
    const card = payment({ id: 'card', invoice_id: 'inv', amount_cents: 2000 })
    const payments: LedgerPayment[] = [
      { invoice_id: 'inv', amount_cents: 3000, method: 'cash' },
      { invoice_id: 'inv', amount_cents: 2000, method: 'card' },
    ]
    expect(paymentRefundableCents(card, [receipt], payments, none)).toBe(2000)
  })

  it('offers nothing on a voided receipt', () => {
    const card = payment({ invoice_id: 'inv' })
    expect(paymentRefundableCents(card, [{ ...receipt, status: 'void' }], [{ invoice_id: 'inv', amount_cents: 20400, method: 'card' }], none)).toBe(0)
  })
})

describe('The share of a refund that was money on account', () => {
  it('is nothing when the patient holds no surplus -- the refund corrects a charge', () => {
    // Viviane's balance was 0 before her 39 EUR came back.
    expect(onAccountShareCents(3900, 0)).toBe(0)
    expect(onAccountShareCents(3900, -5000)).toBe(0)
  })

  it('is the whole refund when the surplus covers it', () => {
    expect(onAccountShareCents(4000, 10000)).toBe(4000)
  })

  it('is the surplus when the refund is larger', () => {
    expect(onAccountShareCents(4000, 1500)).toBe(1500)
  })
})

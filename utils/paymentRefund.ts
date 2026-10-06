import { isReceipt } from './paymentReceipts'

// How much of ONE payment can still go back to the patient, and how a refund
// of it is written.
//
// The ledger offers the action and BillingTab's createRefund re-derives the cap
// on the write; both read this, so the button and the write cannot disagree
// about what is refundable.
//
// A payment with no invoice was never refundable here, and that turned out to
// be most of the money the clinic holds. PracticeHub links no payment to
// anything, so all 3,259 imported payments arrived with invoice_id null.
// Viviane Vieira Tostes was refunded 39 EUR of a 204 EUR card payment on
// 23 Sep 2026; the button was not there, so reception left a 0 EUR note on her
// account instead, and Natacha Felix's September takings read 39 EUR high
// until it was entered by hand as REF-0006.
//
// What still stays unrefundable without an invoice is money with something
// else hanging off it, because refunding the payment alone leaves that thing
// standing:
//
//   * a top-up ('on_account', or any payment an account_credits row names) --
//     its credit row would stay spendable, so the patient is paid twice;
//   * a bono or membership sale -- the bono keeps its sessions and the
//     membership stays active, both paid for by money that went back.
//
// Those need their own reversal, not this one.

export interface RefundablePayment {
  id: string
  invoice_id: string | null
  amount_cents: number
  method: string
  purpose?: string | null
  package_purchase_id?: string | null
}

export interface RefundInvoice {
  id: string
  status: string
  total_cents: number
  is_refund: boolean
  refunds_invoice_id: string | null
  refunds_payment_id: string | null
}

export interface LedgerPayment {
  invoice_id: string | null
  amount_cents: number
  method: string
}

const TIED_PURPOSES = ['on_account', 'bono', 'membership']

/** True when nothing but the money itself hangs off a payment with no invoice. */
export function isLoosePayment(p: RefundablePayment, creditPaymentIds: ReadonlySet<string>): boolean {
  if (p.invoice_id) return false
  if (p.purpose && TIED_PURPOSES.includes(p.purpose)) return false
  if (p.package_purchase_id) return false
  return !creditPaymentIds.has(p.id)
}

/**
 * What has already gone back out against one payment.
 *
 * Read off the refund PAYMENTS, not only the refund invoices' totals. The two
 * are equal for every refund but one kind: a loose payment refunded out of
 * money still sitting on the account, whose refund invoice carries only the
 * part that corrects a charge (see onAccountShareCents). Its total alone would
 * understate what was returned, and let the same euros go back twice.
 */
export function refundedAgainstPaymentCents(paymentId: string, invoices: RefundInvoice[], payments: LedgerPayment[]): number {
  return invoices
    .filter((r) => r.is_refund && r.refunds_payment_id === paymentId)
    .reduce((sum, r) => {
      const paidOut = -payments.filter((q) => q.invoice_id === r.id).reduce((s, q) => s + q.amount_cents, 0)
      return sum + Math.max(Math.abs(r.total_cents), paidOut)
    }, 0)
}

/**
 * The lower of two rooms, which is what stops the same money being returned
 * twice by two different routes: what's left of this payment (its amount less
 * refunds naming it), and what's left of its receipt (everything received on
 * it less every refund against it, payment-level ones included). Refund EUR 20
 * against the card payment and then EUR 50 against the receipt and the second
 * is capped at EUR 30 -- in the other order, the payment is capped instead.
 *
 * A loose payment has no receipt, so its own room is the only one.
 */
export function paymentRefundableCents(
  p: RefundablePayment,
  invoices: RefundInvoice[],
  payments: LedgerPayment[],
  creditPaymentIds: ReadonlySet<string>,
): number {
  // Only money that came in can go back out. That rules out the negative row
  // a refund writes (refunding a refund), a write-off, which settles a balance
  // without collecting anything, and a 'credit' payment, which spent money
  // received -- and refundable -- on a payment of its own.
  if (p.amount_cents <= 0 || !isReceipt(p.method)) return 0

  const paymentRoom = p.amount_cents - refundedAgainstPaymentCents(p.id, invoices, payments)

  if (!p.invoice_id) return isLoosePayment(p, creditPaymentIds) ? Math.max(0, paymentRoom) : 0

  const invoice = invoices.find((i) => i.id === p.invoice_id)
  // A voided receipt offers no Refund action at receipt level either.
  if (!invoice || invoice.status === 'void') return 0

  const receivedForInvoice = payments
    .filter((q) => q.invoice_id === p.invoice_id && isReceipt(q.method))
    .reduce((sum, q) => sum + q.amount_cents, 0)
  const refundedAgainstInvoice = invoices
    .filter((r) => r.is_refund && r.refunds_invoice_id === p.invoice_id)
    .reduce((sum, r) => sum + Math.abs(r.total_cents), 0)

  return Math.max(0, Math.min(paymentRoom, receivedForInvoice - refundedAgainstInvoice))
}

/**
 * How much of a loose payment's refund is the patient's unspent money going
 * back, rather than a charge being corrected.
 *
 * Every refund is written as a refund invoice of minus the amount, plus a
 * payment of minus the amount. The pair leaves the balance where it was, which
 * is right when the refund corrects a charge: the patient was charged 39 too
 * much, gets 39 back, and owed nothing before or after.
 *
 * It is wrong when the money was never spent. A patient with 100 EUR sitting
 * unallocated on the account who is handed 40 of it back should have 60 left,
 * not 100 -- and spendable credit is read off that surplus, so the 40 would be
 * offered again at the desk. So that share is left off the refund invoice's
 * total while the payment still carries the whole amount: the balance drops by
 * exactly the money that was on account, and the Income report still sees
 * every euro that went back.
 *
 * Nothing records which of the two a given refund is, so the surplus is taken
 * to go first. That can only under-state what the patient has left, never
 * over-state it, and under-offering credit is the safe direction to be wrong
 * in (see spendableCreditCents in BillingTab).
 *
 * `surplusCents` is the patient's money on account that is neither credit on
 * the ledger nor paid towards an unused bono -- the second term of
 * spendableCreditCents.
 */
export function onAccountShareCents(amountCents: number, surplusCents: number): number {
  return Math.max(0, Math.min(amountCents, surplusCents))
}

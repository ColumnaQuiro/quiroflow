// What a patient owes right now.
//
// Not the balance. The balance is paid minus invoiced over everything that has
// ever happened to them, and it answers a different question -- how the
// account stands -- which is why it is right for exports and recalls and wrong
// for "does this person owe us money?".
//
// The two come apart wherever the money that settled a charge does not sit on
// the same patient row as the charge. That is not an edge case here:
//
//   * A family bono. settle_imported_invoices() pools payments and invoices
//     across the sharing graph (20260915183351), so a child's visits are
//     correctly marked paid out of a parent's money -- while the child's own
//     paid-minus-invoiced still reads as debt. One child showed
//     "174,00 EUR due" for four visits drawn on a parent's bonos, and
//     their Money tab printed that figure directly above "Nothing outstanding."
//   * A bono sale raises no invoice on purpose (20260914150556), so the money
//     paid for it sits in the balance until the sessions are used.
//   * PracticeHub links no payment to an invoice at all, so 3,262 imported
//     payments are unallocated by nature.
//
// Measured on the live account: 49 patients and 6,326 EUR read as owing from
// the balance; 10 patients and 508 EUR have an invoice that is actually
// unpaid.
//
// So owing is read off the invoices, which is where the settlement -- the only
// thing that knows about families -- already wrote its answer. `paid` is
// settled however it got there; `void` was cancelled; anything else is owed,
// less whatever payments are allocated to it, because a part-paid invoice owes
// only the remainder.
//
// Refunds are left out. A refund invoice is money going the other way (0128:
// is_refund, negative total), and counting it here would either cancel real
// debt or, with the per-invoice floor below, quietly do nothing.
export interface OwingInvoice {
  id: string
  status: string
  total_cents: number
  is_refund?: boolean | null
}

export interface OwingPayment {
  invoice_id: string | null
  amount_cents: number
  method?: string | null
}

export function outstandingCentsOf(invoices: OwingInvoice[], payments: OwingPayment[]): number {
  const allocated = new Map<string, number>()
  let paidCents = 0
  for (const p of payments) {
    // Allocation and the money term treat a 'credit' payment differently, and
    // both readings are right.
    //
    // Against a particular invoice it really did settle that charge, wholly or
    // in part, so it belongs in `allocated` -- a 50,00 invoice half paid out of
    // credit owes 25,00, not 50,00.
    //
    // It is not money arriving, though: it moves euros the patient already
    // handed over, counted once when they did (see
    // 20260924095218_credit_payment_is_never_money.sql). Adding it to paidCents
    // as well would let spending credit on a BONO shrink the money term and
    // quietly cancel an unpaid invoice it never touched.
    if (p.method !== 'credit') paidCents += p.amount_cents
    if (!p.invoice_id) continue
    allocated.set(p.invoice_id, (allocated.get(p.invoice_id) ?? 0) + p.amount_cents)
  }

  let unpaidCents = 0
  let invoicedCents = 0
  for (const i of invoices) {
    if (i.status === 'void' || i.is_refund) continue
    invoicedCents += i.total_cents
    if (i.status === 'paid') continue
    // Floored per invoice, not over the total: an overpayment on one charge is
    // credit on the account, not a discount on somebody else's unpaid visit.
    unpaidCents += Math.max(0, i.total_cents - (allocated.get(i.id) ?? 0))
  }

  // Two upper bounds on real debt, and the truth is the smaller of them.
  //
  // What the invoices say is unpaid overstates it wherever money arrived
  // without settling a particular charge -- which is every imported
  // PracticeHub payment and every bono sale. The settled patient in
  // owing-counts-unallocated-payments.cy.ts has a 50,00 invoice still marked
  // unpaid and 50,00 of unallocated cash: the invoice says they owe, the money
  // says they do not.
  //
  // What the money says -- invoiced minus paid -- overstates it wherever the
  // money sits on another patient's row, which is the family bono this was
  // written for.
  //
  // Neither term can be trusted alone and both err upwards, so a patient owes
  // only what BOTH agree on. Credit is deliberately not in the money term: an
  // unpaid invoice is still unpaid while the patient holds credit beside it,
  // because applying it is a decision somebody makes (see BillingTab's
  // spendableCreditCents), not something that has already happened.
  return Math.min(unpaidCents, Math.max(0, invoicedCents - paidCents))
}

/**
 * What a patient can put towards a charge as "credit on account": the credit
 * ledger in full, plus money paid ahead -- paid beyond what has been charged
 * and what their bonos have already committed.
 *
 * The ledger alone is what every charge screen but the patient's Billing tab
 * used to offer, and it counts only account_credits rows -- which an imported
 * PracticeHub payment never has. A patient who paid 50 EUR ahead in
 * PracticeHub showed +50 on their balance and no credit to spend on the
 * visit that money was for, so reception was asked for it again in full.
 *
 * The balance is read with the unpaid invoices added back (outstandingCents):
 * paying those is the main thing credit is FOR. Read straight off the
 * balance, the 50 EUR above vanished the moment the visit it was meant for
 * was invoiced -- 50 paid, 50 charged, 0 left -- on the one screen that had
 * offered it.
 *
 * The bonos' committed value still comes off: a balance carries prepaid bono
 * money, which buys the sessions and is not spendable twice (the double count
 * 0161 removed).
 */
export function spendableCreditOf(f: { creditLedgerCents: number; balanceCents: number; outstandingCents: number; bonoValueCents: number }): number {
  const paidAheadCents = Math.max(0, f.balanceCents + f.outstandingCents - f.creditLedgerCents - f.bonoValueCents)
  return Math.max(0, f.creditLedgerCents) + paidAheadCents
}

/**
 * How much of a credit spend comes off the credit LEDGER -- the size of the
 * negative account_credits row to write beside the 'credit' payment. The rest
 * was money paid ahead (spendableCreditOf) and needs no row at all.
 *
 * Writing the row for the whole amount took the same euros off twice. A
 * 'credit' payment is never money (20260924095218), so spending 50 EUR paid
 * ahead on a 50 EUR visit reads 50 paid - 50 charged = 0 with no row -- and
 * -50 with one, against an account_credits balance that never had the +50 to
 * net it against. The same shape the backfill in 20260924095305 repaired by
 * hand for one patient.
 */
export function ledgerDrawCents(spendCents: number, creditLedgerCents: number): number {
  return Math.max(0, Math.min(spendCents, creditLedgerCents))
}

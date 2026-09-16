// What is still owed on a bono, in one place.
//
// This was written three times -- the patient's Billing tab, the Debtors
// report, and the dashboard's Debtors widget -- and the three did not agree.
// Billing read owed_cents; the other two read the bono's sale invoice and
// nothing else, so with 518 of 522 bonos carrying no invoice, Debtors was
// reporting almost nothing while 21,930 EUR sat outstanding on migrated
// bonos.
//
// There are two ways a bono records what it costs, and the rule differs:
//
//  - MIGRATED from PracticeHub (external_reference set). owed_cents is
//    PracticeHub's own outstanding figure, already net of everything paid
//    over there -- including payments that came across into this ledger. So
//    only money taken on THIS side comes off it; subtracting an imported
//    payment as well would clear a debt that is real.
//
//  - SOLD here. owed_cents is the full price and every payment against the
//    bono comes off it. There is no sale invoice: raising one would charge
//    the patient a second time, because each visit drawn from the bono is
//    charged as it happens.
//
// A bono with neither owed_cents nor a valid invoice owes nothing. That is
// deliberate: "we have no record of a charge" and "they have not paid" are
// different things, and treating the first as the second once put 210,147 EUR
// of invented debt on 427 migrated bonos.
//
// Money taken ON ACCOUNT never counts towards a bono, even when it is linked
// to one. Adding credit writes a payment AND an account_credits row for the
// same euros -- the payment records that the money arrived, the credit row is
// what the patient can still direct somewhere -- so letting it pay down a
// bono as well spends it twice: Adrian Oropeza's 115 EUR read as 115 of loose
// credit and 115 off his bono at the same time, and "available" came out 292
// where he has 177. It buys bono sessions when somebody actually spends it,
// through Collect with method 'credit', which draws the credit row down and
// writes a payment with purpose 'bono'.

export interface BonoOwedPayment {
  amount_cents: number
  invoice_id: string | null
  package_purchase_id: string | null
  external_reference: string | null
  purpose: string | null
}

export interface BonoOwedInput {
  purchaseId: string
  invoiceId: string | null
  priceCents: number
  owedCents: number | null
  /** The bono's own sale invoice, where one exists. Void counts as none. */
  invoice: { status: string; total_cents: number } | null
  /** Every payment on the patient's ledger; this picks out the relevant ones. */
  payments: BonoOwedPayment[]
}

/** A payment that came across from PracticeHub rather than one taken here. */
export function wasImportedFromPracticeHub(payment: { external_reference: string | null }): boolean {
  return !!payment.external_reference?.startsWith('phpay-')
}

export function bonoOwedCents(input: BonoOwedInput): number {
  const invoiceIsValid = !!input.invoice && input.invoice.status !== 'void'

  let paidCents = 0
  let paidHereCents = 0
  let hasAnyLinkedPayment = false
  for (const p of input.payments) {
    if (p.purpose === 'on_account') continue
    const countsViaInvoice = invoiceIsValid && input.invoiceId !== null && p.invoice_id === input.invoiceId
    const countsViaBono = p.package_purchase_id === input.purchaseId
    if (!countsViaInvoice && !countsViaBono) continue
    paidCents += p.amount_cents
    hasAnyLinkedPayment = true
    if (!wasImportedFromPracticeHub(p)) paidHereCents += p.amount_cents
  }

  if (input.owedCents !== null && input.owedCents !== undefined) {
    return Math.max(0, input.owedCents - paidHereCents)
  }
  if (!invoiceIsValid && !hasAnyLinkedPayment) return 0
  // Measured against what was actually invoiced, never the bono's price: a
  // migrated bono's invoice covered only the part still owed at migration, so
  // the price overstated the debt by 18,647 EUR across 84 bonos.
  const chargedCents = invoiceIsValid && input.invoice ? input.invoice.total_cents : input.priceCents
  return Math.max(0, chargedCents - paidCents)
}

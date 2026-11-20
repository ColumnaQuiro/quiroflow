// The arithmetic and the decisions behind charging one visit, with no
// database and no Vue in them -- so they can be unit tested, and so the two
// screens that charge a visit (the calendar's Billing tab on the web and the
// visit screen in the staff app) cannot answer them differently.
// composables/useVisitCharging.ts does the writing.
//
// Pure on purpose: this file is auto-imported by the mobile app too, where
// `~` means mobile/, so it must not import anything by value.

/**
 * What one visit is worth against a bono: the bono's own per-session value,
 * total price over total sessions -- what the patient actually paid per visit
 * when they bought it, not the appointment type's walk-in price.
 *
 * Rounded once, here, so the button that quotes the rate and the charge that
 * bills it cannot disagree. A bono with no sessions is worth nothing per
 * session rather than Infinity.
 */
export function bonoPerSessionCents(bono: { price_cents: number; sessions_total: number }): number {
  if (!bono.sessions_total) return 0
  return Math.round(bono.price_cents / bono.sessions_total)
}

/**
 * What a session drawn from this bono is CHARGED, which is not always what it
 * is worth.
 *
 * A bono sold here raises no invoice: its money sits in the balance and each
 * visit's charge, at bonoPerSessionCents, is what spends it. A bono whose
 * whole price was invoiced when it was sold (`charged_at_purchase`, set by the
 * PracticeHub importer for a clinic that bills that way) has nothing left in
 * the balance to spend -- its own invoice already took it. Charging the
 * per-session rate there bills every remaining session a second time: 40 EUR
 * a visit on a Bono 20 PracticeHub had invoiced at 800 and then charged 0 per
 * visit.
 *
 * bonoPerSessionCents stays what a session is WORTH (the bono's history, the
 * value still on its counter); this is what the visit costs today.
 */
export function bonoVisitChargeCents(bono: { price_cents: number; sessions_total: number; charged_at_purchase?: boolean | null }): number {
  return bono.charged_at_purchase ? 0 : bonoPerSessionCents(bono)
}

/**
 * Whether PracticeHub has already invoiced everything a package costs, so the
 * sessions still on it are paid for.
 *
 * PracticeHub charges `visits - free_visits` of a package's visits and lets
 * the rest through at 0. A clinic that bills per visit has free_visits = 0
 * (every package on Columnaquiro, Castellón and QuiroBalance, checked 16 Nov
 * 2026). One that bills the whole price up front has free_visits =
 * visits - 1: the price lands on the visit the bono is bought at, and every
 * visit after it is free (310 of Elevate Chiropractic's 332).
 *
 * Once no charged visit is left -- visits_left <= free_visits -- whatever the
 * counter still holds was paid for by invoices that are already here. Before
 * that the price has not all been invoiced, and charging per session (the
 * QuiroFlow way) still collects it.
 */
export function practiceHubChargedAtPurchase(pkg: { visits: number | null; visits_left: number | null; free_visits?: number | null }): boolean {
  const free = pkg.free_visits ?? 0
  if (free <= 0) return false
  const left = pkg.visits_left ?? pkg.visits ?? 0
  return left <= free
}

/** An invoice's total, from its lines. Quantity counts. */
export function lineItemsTotalCents(lines: { price_cents: number; quantity: number }[]): number {
  return lines.reduce((sum, l) => sum + l.price_cents * l.quantity, 0)
}

/**
 * The status a visit's receipt is raised with when someone presses "Charge".
 *
 * A visit whose price is 0 € -- a free adjustment, a report-of-findings, a
 * talk -- owes nothing, so its receipt is settled the moment it exists. It
 * used to be raised 'unpaid' like any other, and since a receipt only turns
 * paid when payments cover it, and there is no 0 € payment to record, it then
 * sat in Billing's unpaid list and on the patient's visits as "Unpaid · 0,00 €"
 * for good -- 68 such receipts across three clinics by 20 Nov 2026, none with
 * a payment or a priced line -- and the visit was never completed.
 */
export function newVisitReceiptStatus(priceCents: number): 'paid' | 'unpaid' {
  return priceCents > 0 ? 'unpaid' : 'paid'
}

/**
 * Whether the lines of a visit's receipt can still be changed.
 *
 * An unpaid receipt can. A paid one normally cannot -- money was taken against
 * those lines -- except a 0 € receipt nothing was paid on, which is what a
 * free visit is now raised as (newVisitReceiptStatus). Selling a product at a
 * free visit is ordinary, and that receipt is where it goes. A visit drawn
 * from a bono is paid with no payment row too, but its price is the bono's, so
 * it stays closed.
 */
export function visitReceiptEditable(input: { status: string | null | undefined; totalCents: number; paidCents: number; coveredByBono: boolean }): boolean {
  if (!input.status || input.status === 'void') return false
  if (input.status !== 'paid') return true
  return !input.coveredByBono && input.totalCents === 0 && input.paidCents === 0
}

/**
 * What a receipt's status should be after its lines changed: a settled free
 * receipt that now carries something priced is owed again. Anything else
 * keeps the status it had -- an unpaid receipt is settled by taking a payment,
 * not by editing it.
 */
export function receiptStatusAfterLinesChange(input: { status: string; totalCents: number; paidCents: number; coveredByBono: boolean }): string {
  if (input.status === 'paid' && !input.coveredByBono && input.totalCents > input.paidCents) return 'unpaid'
  return input.status
}

/**
 * Whether an open receipt is missing the visit itself, so the visit's price
 * can be put (back) on it.
 *
 * A receipt takes the appointment type's price once, when it is raised, and
 * never looks again. Raise it while the type still costs 0 € -- a new clinic
 * charging its first visits before filling in prices -- and it stays at 0 €
 * after the price is set. If its 0 € line is then removed, nothing on the
 * screen brings the visit back: "Charge" only shows while there is no receipt,
 * and the add-a-line picker lists services and products, not appointment
 * types. The patient could not be charged at all.
 *
 * The visit's own line is the one with no service_id. A line priced at
 * 0 € does not count as the visit being on the receipt: that is the stale
 * line this exists to replace. A visit drawn from a bono is billed at the bono
 * rate instead, and a paid or void receipt is closed, so neither is offered.
 * Nor is a visit charged to a third party: charge_visit_to_third_party leaves
 * the patient's line at their copago, which is 0 € when the insurer pays it
 * all -- a correct 0, not a stale one.
 */
export function visitLineMissing(input: {
  invoiceStatus: string | null | undefined
  coveredByBono: boolean
  chargedToThirdParty: boolean
  visitPriceCents: number
  lines: { price_cents: number; service_id: string | null }[]
}): boolean {
  if (!input.invoiceStatus || input.invoiceStatus === 'paid' || input.invoiceStatus === 'void') return false
  if (input.coveredByBono || input.chargedToThirdParty || input.visitPriceCents <= 0) return false
  return !input.lines.some((l) => l.service_id == null && l.price_cents > 0)
}

/**
 * Whether a visit has not happened yet, so there is nothing to bill.
 *
 * A patient who has checked in is being seen, whatever the clock says about
 * the slot: early arrivals are routine, and going by starts_at alone refused
 * to charge a visit that had happened. No appointment at all counts as "not
 * upcoming" -- the same answer the Billing tab has always given.
 */
export function isVisitUpcoming(appt: { starts_at: string; checked_in_at: string | null } | null | undefined, now: Date = new Date()): boolean {
  return !!appt && !appt.checked_in_at && new Date(appt.starts_at) > now
}

/**
 * What happens to an invoice the visit already carries when the visit is
 * then drawn from a bono instead.
 *
 * The walk-in price is the wrong number once a bono pays for the visit.
 * Extras -- a product, an added service: the lines carrying a service_id --
 * are real money owed on top of the bono, so those keep their invoice; the
 * covered visit line (the one without a service_id) goes.
 *
 * With nothing chargeable left AND nothing collected, the invoice should
 * never have existed and is deleted. That branch is guarded on there being no
 * payments for a reason: payments cascade on invoice delete, so deleting an
 * invoice with payments would destroy real money records.
 */
export type BonoCoverPlan =
  | { action: 'delete' }
  | { action: 'reprice'; removeLineId: string | null; totalCents: number }

export function planInvoiceUnderBono(
  lines: { id: string; price_cents: number; quantity: number; service_id: string | null }[],
  paymentCount: number,
): BonoCoverPlan {
  const extraLines = lines.filter((l) => l.service_id)
  if (extraLines.length === 0 && paymentCount === 0) return { action: 'delete' }
  const baseLine = lines.find((l) => !l.service_id)
  const remaining = baseLine ? lines.filter((l) => l.id !== baseLine.id) : lines
  return { action: 'reprice', removeLineId: baseLine?.id ?? null, totalCents: lineItemsTotalCents(remaining) }
}

/**
 * Whether the credit part of a payment asks for more than there is.
 *
 * Capped by what is SPENDABLE (utils/owing spendableCreditOf), not by the raw
 * balance: a balance carries prepaid bono money, which buys the sessions and
 * is not spendable twice (the double-count migration 0161 removed). Nor by the
 * credit ledger alone, which an imported PracticeHub prepayment never reaches.
 * Only asked when credit is actually being spent -- otherwise 0 against a
 * negative figure reads as "exceeded" and blocks a plain cash or card payment.
 */
export function creditExceedsSpendable(creditCents: number, spendableCreditCents: number): boolean {
  return creditCents > 0 && creditCents > spendableCreditCents
}

/**
 * The rows a visit's payment form opens with: the patient's spendable credit
 * first, up to what is due, and anything it does not cover on the clinic's
 * default method.
 *
 * Credit used to be offered and never chosen. The form opened at the full
 * price on cash, "Credit on account" sat in the dropdown, and a patient with
 * 100 EUR on account was shown 100 EUR to pay for a 100 EUR visit -- which is
 * how reception reads it, and they asked why the money was not being used.
 * Opening on credit says it before anyone has to look for it; changing the
 * method is still one click.
 */
export function openingPaymentRows(dueCents: number, spendableCreditCents: number, defaultMethod: string): { method: string; cents: number }[] {
  const fromCreditCents = Math.min(Math.max(0, spendableCreditCents), Math.max(0, dueCents))
  if (fromCreditCents <= 0) return [{ method: defaultMethod, cents: dueCents }]
  const restCents = dueCents - fromCreditCents
  return restCents > 0
    ? [{ method: 'credit', cents: fromCreditCents }, { method: defaultMethod, cents: restCents }]
    : [{ method: 'credit', cents: fromCreditCents }]
}

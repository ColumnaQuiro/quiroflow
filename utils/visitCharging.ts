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

/** An invoice's total, from its lines. Quantity counts. */
export function lineItemsTotalCents(lines: { price_cents: number; quantity: number }[]): number {
  return lines.reduce((sum, l) => sum + l.price_cents * l.quantity, 0)
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
 * Capped by the credit LEDGER, not the balance: a balance carries prepaid
 * bono money, which buys the sessions and is not spendable twice (the
 * double-count migration 0161 removed). Only asked when credit is actually
 * being spent -- otherwise 0 against a negative figure reads as "exceeded"
 * and blocks a plain cash or card payment.
 */
export function creditExceedsLedger(creditCents: number, creditLedgerCents: number): boolean {
  return creditCents > 0 && creditCents > creditLedgerCents
}

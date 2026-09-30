/**
 * Flip an invoice to 'paid' when its own payments now cover it.
 *
 * Four screens took a payment and then decided, each in its own way, whether
 * that settled the invoice. BillingTab re-read the payments from the database
 * first; the appointment dialog and /billing/[id] compared against
 * `paidCents.value` and `invoice.value.total_cents` -- both loaded when the
 * screen opened and neither re-checked since. Whatever happened in between
 * (another till, a line item added, a slow round trip that let the screen's
 * own reload land first) was invisible to the comparison.
 *
 * One invoice out of 7,101 is wrong because of it: INV-3500, 50 EUR charged,
 * 50 EUR taken by card 38 seconds later, factura issued, status still unpaid.
 * Rare, and worth removing rather than tolerating, because the failure is
 * silent in both directions -- the patient is not chased, and the invoice
 * sits in Billing's unpaid list looking like money owed.
 *
 * The write is also checked. `update()` with no `.select()` returns no rows
 * and an error nobody reads, so a refused write looked exactly like a
 * successful one.
 *
 * Returns true when this call settled the invoice -- the appointment dialog
 * needs to know, since completing the visit and firing invoice.paid hang off
 * the same answer.
 */
export async function settleInvoiceIfCovered(supabase: any, invoiceId: string): Promise<boolean> {
  const [{ data: invoice }, { data: payments }] = await Promise.all([
    supabase.from('invoices').select('total_cents, status').eq('id', invoiceId).maybeSingle(),
    supabase.from('payments').select('amount_cents').eq('invoice_id', invoiceId),
  ])
  if (!invoice) return false
  // Already settled: nothing to write, but the caller's "did this settle it"
  // question is still yes, so a double-click doesn't undo the side effects.
  if (invoice.status === 'paid') return true

  const paidCents = (payments ?? []).reduce((sum: number, p: { amount_cents: number }) => sum + p.amount_cents, 0)
  if (paidCents < invoice.total_cents) return false

  const { error } = await supabase.from('invoices').update({ status: 'paid' }).eq('id', invoiceId)
  if (error) throw error
  return true
}

/**
 * What is still due on one invoice: nothing once it is paid or void, however
 * many payment rows sit under it; otherwise its total less what was paid.
 *
 * A 'paid' invoice with no payments is a real and common shape -- a visit
 * drawn from a prepaid bono is raised paid with no payment row, and so is the
 * whole migrated PracticeHub history (settle_imported_invoices) -- and status
 * is trustworthy because deletePayment recomputes it from what is left.
 * Reading payments alone showed the session price as due on those, with a
 * form to take it again. Used by the receipt page, its PDF/email and the
 * appointment dialog so they cannot disagree.
 *
 * This is one receipt's figure only. It is not the patient's balance, which
 * is computed elsewhere (patient_live_balances / utils/owing.ts) and is not
 * affected by this.
 */
export function invoiceDueCents(invoice: { status: string; total_cents: number } | null | undefined, paidCents: number): number {
  if (!invoice) return 0
  if (invoice.status === 'paid' || invoice.status === 'void') return 0
  return invoice.total_cents - paidCents
}

/**
 * Card money taken through Stripe for one visit before it happened -- paid
 * ahead from the patient app, or an online-booking deposit -- less anything
 * already refunded. What the cancel step asks about: give it back to the
 * card, or keep it as credit (server/api/appointments/prepaid-visit.post.ts).
 *
 * Shared with the app's cancel sheet, so value imports stay relative (inside
 * the app `~` is mobile/).
 */
export async function prepaidCardCents(supabase: any, appointmentId: string): Promise<number> {
  const { data: invoices } = await supabase.from('invoices').select('id, status, is_refund').eq('appointment_id', appointmentId)
  const ids = ((invoices ?? []) as { id: string; status: string; is_refund: boolean | null }[]).filter((i) => i.status !== 'void' && !i.is_refund).map((i) => i.id)
  if (ids.length === 0) return 0
  const [{ data: payments }, { data: refunds }] = await Promise.all([
    supabase.from('payments').select('amount_cents, stripe_payment_intent_id').in('invoice_id', ids),
    supabase.from('invoices').select('total_cents').eq('is_refund', true).in('refunds_invoice_id', ids),
  ])
  const paid = ((payments ?? []) as { amount_cents: number; stripe_payment_intent_id: string | null }[])
    .filter((p) => p.stripe_payment_intent_id && p.amount_cents > 0)
    .reduce((sum, p) => sum + p.amount_cents, 0)
  const refunded = ((refunds ?? []) as { total_cents: number }[]).reduce((sum, r) => sum + Math.abs(r.total_cents), 0)
  return Math.max(0, paid - refunded)
}

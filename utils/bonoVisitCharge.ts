/**
 * Whether the charge for a bono visit is already paid for.
 *
 * A bono visit is charged at the bono's per-session rate -- that charge is
 * what draws the prepayment down -- and marked paid when the money is already
 * on the account. Three screens record that visit (the calendar's billing
 * tab, the Money tab's "use a session", and the mobile visit screen) and all
 * three asked the same wrong question:
 *
 *   status: balanceCents.value >= perSessionCents ? 'paid' : 'unpaid'
 *
 * `balanceCents` is ONE patient's balance. A family bono's money sits on the
 * owner's record, so a beneficiary's own balance is negative by construction
 * and the check can never pass for them: their visit is billed even though
 * their family prepaid for it and the session has just come off the bono.
 *
 * Santiago Nawab, 23 Sep 2026: a session off Henna's Bono 12 and INV-3576 for
 * 44 EUR raised 0.3s later, unpaid. His balance -173 EUR, his family's +44 --
 * exactly the session that had just been drawn. The family nets to zero.
 *
 * So the question is asked of the family, via patient_family_balance_cents()
 * -- the same sharing graph settle_imported_invoices() pools by, so a visit
 * taken today is settled the way the imported history already was.
 *
 * `ownBalanceCents` is the fallback and nothing more: if the RPC cannot be
 * reached the answer is what this screen would have said before, which is
 * wrong for a beneficiary but no more wrong than it is today. Money is never
 * blocked over this -- the patient is in the chair and the visit happened.
 */
export async function bonoVisitChargeStatus(
  supabase: any,
  patientId: string,
  perSessionCents: number,
  ownBalanceCents: number,
): Promise<'paid' | 'unpaid'> {
  const { data } = await supabase.rpc('patient_family_balance_cents', { p_patient_id: patientId })
  const balanceCents = typeof data === 'number' ? data : ownBalanceCents
  return balanceCents >= perSessionCents ? 'paid' : 'unpaid'
}

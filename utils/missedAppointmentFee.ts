/**
 * The missed-appointment fee from Settings > Scheduling Policies, charged to
 * the patient's balance when a visit is marked a no-show.
 *
 * Shared by the web's appointment panel and the staff app's visit screen, so
 * a no-show marked on either raises the same charge: an unpaid invoice
 * numbered by next_invoice_number with one "Missed appointment fee" line.
 * Asking whether to add it is the caller's job -- both ask once, with the
 * amount, before calling chargeMissedAppointmentFee.
 */
export async function missedAppointmentFeeCents(supabase: any, accountId: string): Promise<number | null> {
  const { data } = await supabase.from('accounts').select('missed_appointment_fee_cents').eq('id', accountId).maybeSingle()
  return (data as { missed_appointment_fee_cents: number | null } | null)?.missed_appointment_fee_cents || null
}

export async function chargeMissedAppointmentFee(supabase: any, args: { accountId: string; patientId: string; feeCents: number }): Promise<boolean> {
  const { data: invoiceNumber } = await supabase.rpc('next_invoice_number', { p_account_id: args.accountId })
  if (!invoiceNumber) return false
  const { data: invoice } = await supabase
    .from('invoices')
    .insert({ account_id: args.accountId, patient_id: args.patientId, invoice_number: invoiceNumber, status: 'unpaid', total_cents: args.feeCents })
    .select('id')
    .single()
  if (!invoice) return false
  const { error } = await supabase.from('invoice_line_items').insert({
    account_id: args.accountId,
    invoice_id: (invoice as { id: string }).id,
    description: 'Missed appointment fee',
    quantity: 1,
    price_cents: args.feeCents,
  })
  return !error
}

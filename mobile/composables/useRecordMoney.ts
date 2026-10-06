import { settleInvoiceIfCovered } from '../../utils/settleInvoice'

// Taking money at the desk from a patient's record, in the app: paying an
// unpaid invoice, and selling a bono. Step for step what the web's patient
// Billing tab does (components/patients/BillingTab.vue takePayment and
// sellPackage / recordPackagePayment), because each of those steps is there
// for a reason written up beside it -- the factura per payment, settling the
// invoice from what was actually paid, no invoice for a bono sale (its price is
// owed on the purchase, so visits drawn from it are not billed twice).
//
// Paying WITH credit is left to the web: it writes the credit ledger and has
// its own limits (spendable credit vs. prepaid bono value), and the payment
// methods offered here (usePaymentMethods) never include it.
export function useRecordMoney(opts: { patientId: () => string; accountId: () => string | null | undefined; teamMemberId: () => string | null | undefined }) {
  const supabase = useSupabaseClient()
  const { issueFactura } = useFacturas()
  const t = useT()

  const refused = (error: { message?: string } | null) => t('The payment could not be recorded', 'No se pudo registrar el pago') + (error?.message ? `: ${error.message}` : '.')

  /** Pays (part of) an unpaid invoice. Returns why it failed, or null. */
  async function payInvoice(invoiceId: string, amountCents: number, method: string): Promise<string | null> {
    const accountId = opts.accountId()
    if (!accountId || amountCents <= 0) return refused(null)
    const { data: payment, error } = await supabase
      .from('payments')
      .insert({ account_id: accountId, patient_id: opts.patientId(), invoice_id: invoiceId, amount_cents: amountCents, method, purpose: 'visit' } as never)
      .select('id, amount_cents')
      .single()
    if (error || !payment) return refused(error)
    await issueFactura({ accountId, patientId: opts.patientId(), paymentId: (payment as { id: string }).id, amountCents, purpose: 'visit' })
    if (await settleInvoiceIfCovered(supabase, invoiceId)) {
      // As the web: an invoice paid off is emailed when the patient opted in.
      const { data: p } = await supabase.from('patients').select('invoice_email_enabled, email').eq('id', opts.patientId()).maybeSingle()
      const patient = p as { invoice_email_enabled: boolean; email: string | null } | null
      if (patient?.invoice_email_enabled && patient.email) useStaffFetch(`/api/invoices/${invoiceId}/send`, { method: 'POST' }).catch(() => {})
    }
    return null
  }

  /**
   * Sells a bono and records what was paid now (may be less than its price;
   * the rest stays owed on the purchase). Returns why the payment failed, or
   * null -- the bono is sold either way, as on the web.
   */
  async function sellBono(packageId: string, amountCents: number, method: string): Promise<{ error: string | null; sold: boolean }> {
    const accountId = opts.accountId()
    if (!accountId) return { error: refused(null), sold: false }
    // Read again at the sale: a price changed in Settings since the list was
    // loaded must not be sold at the old one.
    const { data: tplRow } = await supabase.from('packages').select('id, name, session_count, price_cents').eq('id', packageId).maybeSingle()
    const tpl = tplRow as { id: string; name: string; session_count: number; price_cents: number } | null
    if (!tpl) return { error: t('That bono no longer exists.', 'Ese bono ya no existe.'), sold: false }
    const { data: purchase, error: purchaseError } = await supabase
      .from('package_purchases')
      .insert({
        account_id: accountId,
        patient_id: opts.patientId(),
        package_id: tpl.id,
        package_name: tpl.name,
        sessions_total: tpl.session_count,
        price_cents: tpl.price_cents,
        invoice_id: null,
        owed_cents: tpl.price_cents,
        created_by: opts.teamMemberId() ?? null,
      } as never)
      .select('id')
      .single()
    if (purchaseError || !purchase) return { error: purchaseError?.message ?? t('Could not sell the bono.', 'No se ha podido vender el bono.'), sold: false }
    if (amountCents <= 0) return { error: null, sold: true }
    const purchaseId = (purchase as { id: string }).id
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({ account_id: accountId, patient_id: opts.patientId(), invoice_id: null, package_purchase_id: purchaseId, amount_cents: amountCents, method, purpose: 'bono' } as never)
      .select('id')
      .single()
    if (paymentError || !payment) return { error: refused(paymentError), sold: true }
    await issueFactura({
      accountId,
      patientId: opts.patientId(),
      paymentId: (payment as { id: string }).id,
      amountCents,
      purpose: 'bono',
      bono: { packageName: tpl.name, priceCents: tpl.price_cents, sessionsTotal: tpl.session_count },
    })
    return { error: null, sold: true }
  }

  return { payInvoice, sellBono }
}

import { settleInvoiceIfCovered } from '../../utils/settleInvoice'
import { recordBonoSale } from '../../utils/bonoSale'

// Taking money at the desk from a patient's record, in the app: paying an
// unpaid invoice, and selling a bono. Step for step what the web's patient
// Billing tab does (components/patients/BillingTab.vue takePayment and
// sellPackage / recordPackagePayment, both now utils/bonoSale), because each of those steps is there
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
  // An owner's widget shows the month's takings and bonos sold.
  const homeWidget = useStaffHomeWidget()

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
    homeWidget.refresh({ force: true })
    return null
  }

  /**
   * Sells a bono and records what was paid now (may be less than its price;
   * the rest stays owed on the purchase). Returns why the payment failed, or
   * null -- the bono is sold either way, as on the web. `priceCents` is a
   * special price for this sale (utils/bonoSale specialBonoPriceCents), null
   * for the bono's own. The same steps as the
   * web's Billing tab and the visit checkout: utils/bonoSale.
   */
  async function sellBono(packageId: string, amountCents: number, method: string, priceCents: number | null = null): Promise<{ error: string | null; sold: boolean }> {
    const accountId = opts.accountId()
    if (!accountId) return { error: refused(null), sold: false }
    const { purchase, error } = await recordBonoSale(supabase, { issueFactura, t }, {
      accountId,
      patientId: opts.patientId(),
      teamMemberId: opts.teamMemberId() ?? null,
      packageId,
      installments: 1,
      amountCents,
      // A special price (a discount) for this sale, or null for the bono's
      // own. At once only, which is all the app sells.
      priceCents,
      method,
      // Never 'credit' here (see the header), so nothing to check or draw.
      spendableCreditCents: 0,
      creditLedgerCents: 0,
    })
    if (purchase) homeWidget.refresh({ force: true })
    return { error, sold: !!purchase }
  }

  return { payInvoice, sellBono }
}

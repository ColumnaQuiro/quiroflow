// Issuing the fiscal document for a payment.
//
// One place, because a payment can be taken from five screens (the patient
// Billing tab, the calendar Billing tab, the invoice page, mobile, and the
// Stripe webhook) and a factura that only appears from some of them is worse
// than none: the series would have holes and nobody would know which.
//
// The document describes what the money BOUGHT, which is not the same as what
// it settled. A patient handing over 264 EUR toward a 528 EUR bono has bought
// half of it -- six of twelve sessions -- and that is what the line should
// say, not "payment received".
export type PaymentPurpose = 'visit' | 'bono' | 'membership' | 'on_account'

// A full factura carries the recipient's NIF and address; a simplified one
// does not need them. Everyday visits are well under the threshold and a bono
// purchase is well over it, so in practice this splits exactly along the two
// kinds of thing the clinic sells.
const FULL_INVOICE_THRESHOLD_CENTS = 40000

export interface IssueFacturaInput {
  accountId: string
  patientId: string
  paymentId: string
  amountCents: number
  purpose: PaymentPurpose
  /** For 'bono': the package the money went toward. */
  bono?: { packageName: string; priceCents: number; sessionsTotal: number }
  /** For 'visit' or 'membership': what the patient was treated for, or bought. */
  serviceName?: string
}

const money = (cents: number) => `€${(cents / 100).toFixed(2)}`

// What the patient reads on the document.
export function facturaDescription(input: IssueFacturaInput): string {
  if (input.purpose === 'bono' && input.bono) {
    const { packageName, priceCents, sessionsTotal } = input.bono
    // How much of the bono this payment buys, in sessions. Rounded down: a
    // payment that covers five and a half sessions has bought five, and
    // claiming six would hand over a session that has not been paid for.
    const sessionsCovered =
      priceCents > 0 ? Math.floor((input.amountCents / priceCents) * sessionsTotal) : 0
    return `${packageName} — ${money(input.amountCents)} of ${money(priceCents)} (${sessionsCovered} of ${sessionsTotal} sessions)`
  }
  if ((input.purpose === 'visit' || input.purpose === 'membership') && input.serviceName) return input.serviceName
  if (input.purpose === 'visit') return 'Consulta'
  if (input.purpose === 'membership') return 'Membresía'
  return 'Saldo a cuenta para servicios en la clínica'
}

export function facturaKind(input: IssueFacturaInput): 'simplified' | 'full' {
  // A bono or a membership is always a full invoice: those are the things the
  // clinic sells that are reliably over the threshold, and the patient is
  // buying a course of treatment rather than paying for the visit in front of
  // them.
  if (input.purpose === 'bono' || input.purpose === 'membership') return 'full'
  return input.amountCents > FULL_INVOICE_THRESHOLD_CENTS ? 'full' : 'simplified'
}

export function useFacturas() {
  const supabase = useSupabaseClient()
  const { showToast } = useToast()
  const t = useT()

  /**
   * Numbers and writes the factura in ONE call -- issue_factura() -- so a
   * write the database refuses gives its number back. It used to be two: the
   * number was taken by next_factura_number() and committed, then the insert
   * failed, and the series had a hole nothing could fill. See the migration.
   */
  async function insertFactura(row: {
    accountId: string
    patientId: string
    paymentId: string | null
    kind: string
    description: string
    amountCents: number
    tax: { taxBaseCents: number; taxRateBp: number; taxAmountCents: number; taxExemptionCode: string | null }
    rectifiesFacturaId?: string | null
  }): Promise<{ number: string } | null> {
    const { data, error } = await supabase.rpc('issue_factura', {
      p_account_id: row.accountId,
      p_patient_id: row.patientId,
      p_payment_id: row.paymentId,
      p_kind: row.kind,
      p_description: row.description,
      p_amount_cents: row.amountCents,
      p_tax_base_cents: row.tax.taxBaseCents,
      p_tax_rate_bp: row.tax.taxRateBp,
      p_tax_amount_cents: row.tax.taxAmountCents,
      p_tax_exemption_code: row.tax.taxExemptionCode,
      p_rectifies_factura_id: row.rectifiesFacturaId ?? null,
    })
    const issued = Array.isArray(data) ? data[0] : data
    if (error || !issued?.number) {
      // Said out loud. This returned null and every caller dropped it, so a
      // payment with no factura behind it looked exactly like one with.
      const detail = error?.message ? `: ${error.message}` : '.'
      console.error('[facturas] could not issue', row.kind, 'for payment', row.paymentId, error)
      showToast(
        row.kind === 'rectificativa'
          ? t(`The rectifying factura could not be issued${detail}`, `No se ha podido emitir la factura rectificativa${detail}`)
          : t(
              `The payment was recorded, but its factura could not be issued${detail}`,
              `El pago se ha registrado, pero no se ha podido emitir su factura${detail}`,
            ),
        'error',
        10000,
      )
      return null
    }
    return { number: issued.number }
  }

  // Never throws and never blocks the payment. Taking the money is the thing
  // that must not fail; a factura that could not be issued is recoverable
  // (the payment is there, and it can be issued again), whereas a payment
  // rolled back because of a document is money the clinic actually took and
  // has no record of. A failure is reported -- toast here, null to the caller
  // -- rather than swallowed.
  async function issueFactura(input: IssueFacturaInput): Promise<{ number: string } | null> {
    // Same lookup and the same helper as issueFacturaServer -- a factura
    // issued at the desk and one issued by a Stripe webhook have to carry the
    // same tax breakdown for the same money.
    const { data: taxDefaults } = await supabase
      .from('accounts')
      .select('factura_tax_rate_bp, factura_tax_exemption_code')
      .eq('id', input.accountId)
      .maybeSingle()
    const tax = facturaTaxFor(input.amountCents, taxDefaults)

    // Recipient left null on purpose: it resolves from the patient record
    // when the document is rendered, so a NIF collected next week appears
    // on this factura without anyone reissuing it. Setting these freezes
    // the document, which is what to do once it has been delivered.
    return insertFactura({
      accountId: input.accountId,
      patientId: input.patientId,
      paymentId: input.paymentId,
      kind: facturaKind(input),
      description: facturaDescription(input),
      amountCents: input.amountCents,
      tax,
    })
  }

  /**
   * The rectifying document for money going back to a patient.
   *
   * A refund used to write the REF- invoice and the negative payment and stop
   * there, leaving the factura that says the money came in standing on its own
   * -- every refund the clinic had ever made was in that state.
   *
   * Its own R- series rather than the next F- number: see the migration for
   * why (issue_factura picks it from the kind). Same never-throws contract as
   * issueFactura -- the money has already gone back to the patient by the
   * time this runs, and failing the refund over a document would leave the
   * clinic with no record of it at all.
   */
  async function issueRectificativa(input: {
    accountId: string
    patientId: string
    /**
     * The refund's own negative payment row. Null when no money moved: a
     * factura annulled because the payment it documented was recorded in
     * error and has been removed (see annulFactura in BillingTab).
     */
    paymentId: string | null
    /** Negative: what is going back. */
    amountCents: number
    /** Set when the refunded invoice had exactly one factura behind it. */
    rectifiesFacturaId?: string | null
    /** The number being corrected, for the line the patient reads. */
    rectifiesNumber?: string | null
    reason?: string
  }): Promise<{ number: string } | null> {
    const corrects = input.rectifiesNumber ? `Rectificación de ${input.rectifiesNumber}` : 'Rectificación'

    // A rectificativa carries the same tax treatment as the operation it
    // corrects, negated with it: money going back under an exemption does not
    // become taxable on the way out. Read from the account for the same reason
    // the original was -- and it must be set, because a factura with no base
    // is rejected, which is how this path was found: it inserted separately
    // from issueFactura and silently produced nothing.
    const { data: taxDefaults } = await supabase
      .from('accounts')
      .select('factura_tax_rate_bp, factura_tax_exemption_code')
      .eq('id', input.accountId)
      .maybeSingle()
    const refunded = -Math.abs(input.amountCents)
    const tax = facturaTaxFor(Math.abs(input.amountCents), taxDefaults)

    return insertFactura({
      accountId: input.accountId,
      patientId: input.patientId,
      paymentId: input.paymentId,
      kind: 'rectificativa',
      description: input.reason?.trim() ? `${corrects} — ${input.reason.trim()}` : corrects,
      // Negative, mirroring the payment. The sign is what makes this a
      // correction rather than a second sale.
      amountCents: refunded,
      tax: {
        taxBaseCents: -tax.taxBaseCents,
        taxRateBp: tax.taxRateBp,
        taxAmountCents: -tax.taxAmountCents,
        taxExemptionCode: tax.taxExemptionCode,
      },
      rectifiesFacturaId: input.rectifiesFacturaId ?? null,
    })
  }

  return { issueFactura, issueRectificativa, facturaDescription, facturaKind }
}

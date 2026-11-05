import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { facturaTaxFor } from '~/utils/facturaTax'
import { bonoPaymentDescription } from '~/utils/billingDescriptions'

// The server-side twin of useFacturas(). Money can also arrive without anyone
// at a screen -- a Stripe autopay instalment on a bono, a membership renewal --
// and a factura series with holes in it where those landed is worse than one
// that is simply short.
//
// Same rules as the client: what the money bought, a full invoice for a bono or
// membership, and never blocking the payment if the document fails -- but a
// failure is logged with the payment it belongs to, not dropped. Numbered and
// written in one call (issue_factura) so a refused write does not spend a
// number; see 20261003135743_issue_factura_atomically.sql.
export async function issueFacturaServer(
  supabase: SupabaseClient<Database>,
  input: {
    accountId: string
    patientId: string
    paymentId: string
    amountCents: number
    purpose: 'visit' | 'bono' | 'membership' | 'on_account'
    bono?: { packageName: string; priceCents: number; sessionsTotal: number; installment?: { number: number; of: number } | null }
    serviceName?: string
    /**
     * Goods sold over the counter (server/api/products/sell.post.ts) carry
     * their own IVA, 21 / 10 / 4 %, whatever the account's rule for its
     * services is (exempt, for a physiotherapy clinic).
     */
    taxRateBp?: number
  },
): Promise<string | null> {
  let description: string
  if (input.purpose === 'bono' && input.bono) {
    const { packageName, priceCents, sessionsTotal, installment } = input.bono
    description = bonoPaymentDescription(packageName, input.amountCents, priceCents, sessionsTotal, installment)
  } else if (input.serviceName) {
    description = input.serviceName
  } else if (input.purpose === 'on_account') {
    description = 'Saldo a cuenta para servicios en la clínica'
  } else {
    description = 'Consulta'
  }

  const kind = input.purpose === 'bono' || input.purpose === 'membership' || input.amountCents > 40000 ? 'full' : 'simplified'

  // The tax position is read at issue time and stored on the factura, not
  // resolved when the PDF is rendered: it is a fact about the day the money
  // changed hands. See utils/facturaTax.ts.
  const { data: taxDefaults } = await supabase
    .from('accounts')
    .select('factura_tax_rate_bp, factura_tax_exemption_code')
    .eq('id', input.accountId)
    .maybeSingle()
  const tax = facturaTaxFor(
    input.amountCents,
    input.taxRateBp !== undefined ? { factura_tax_rate_bp: input.taxRateBp, factura_tax_exemption_code: null } : taxDefaults,
  )

  const { data, error } = await supabase.rpc('issue_factura', {
    p_account_id: input.accountId,
    p_patient_id: input.patientId,
    p_payment_id: input.paymentId,
    p_kind: kind,
    p_description: description,
    p_amount_cents: input.amountCents,
    p_tax_base_cents: tax.taxBaseCents,
    p_tax_rate_bp: tax.taxRateBp,
    p_tax_amount_cents: tax.taxAmountCents,
    p_tax_exemption_code: tax.taxExemptionCode,
  })
  const issued = Array.isArray(data) ? data[0] : data
  if (error || !issued?.number) {
    console.error('[facturas] could not issue a factura for payment', input.paymentId, error?.message ?? 'no row returned')
    return null
  }
  return issued.number
}

// The server-side twin of useFacturas().issueRectificativa: the document for
// money going back to a patient, in the R- series, carrying the tax treatment
// of the factura it corrects (or the account's, when that is not known).
// Same never-throws contract -- the money has already gone back by the time
// this runs. Written for a refund made with nobody at a screen: a patient
// cancelling a visit they paid for from the app (server/utils/appPayments.ts).
export async function issueRectificativaServer(
  supabase: SupabaseClient<Database>,
  input: {
    accountId: string
    patientId: string
    /** The refund's own negative payment row. */
    paymentId: string
    /** What is going back; the sign is applied here. */
    amountCents: number
    rectifiesFacturaId: string | null
    rectifiesNumber: string | null
    reason?: string
  },
): Promise<string | null> {
  const corrects = input.rectifiesNumber ? `Rectificación de ${input.rectifiesNumber}` : 'Rectificación'
  const [{ data: taxDefaults }, { data: original }] = await Promise.all([
    supabase.from('accounts').select('factura_tax_rate_bp, factura_tax_exemption_code').eq('id', input.accountId).maybeSingle(),
    input.rectifiesFacturaId
      ? supabase.from('facturas').select('tax_rate_bp, tax_exemption_code').eq('id', input.rectifiesFacturaId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const amount = Math.abs(input.amountCents)
  const tax = facturaTaxFor(amount, original ? { factura_tax_rate_bp: original.tax_rate_bp, factura_tax_exemption_code: original.tax_exemption_code } : taxDefaults)

  const { data, error } = await supabase.rpc('issue_factura', {
    p_account_id: input.accountId,
    p_patient_id: input.patientId,
    p_payment_id: input.paymentId,
    p_kind: 'rectificativa',
    p_description: input.reason?.trim() ? `${corrects} — ${input.reason.trim()}` : corrects,
    p_amount_cents: -amount,
    p_tax_base_cents: -tax.taxBaseCents,
    p_tax_rate_bp: tax.taxRateBp,
    p_tax_amount_cents: -tax.taxAmountCents,
    p_tax_exemption_code: tax.taxExemptionCode,
    p_rectifies_factura_id: input.rectifiesFacturaId ?? undefined,
  })
  const issued = Array.isArray(data) ? data[0] : data
  if (error || !issued?.number) {
    console.error('[facturas] could not issue a rectificativa for payment', input.paymentId, error?.message ?? 'no row returned')
    return null
  }
  return issued.number
}

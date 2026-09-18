import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { facturaTaxFor } from '~/utils/facturaTax'

// The server-side twin of useFacturas(). Money can also arrive without anyone
// at a screen -- a Stripe autopay instalment on a bono, a membership renewal --
// and a factura series with holes in it where those landed is worse than one
// that is simply short.
//
// Same rules as the client: what the money bought, a full invoice for a bono or
// membership, and never blocking the payment if the document fails.
export async function issueFacturaServer(
  supabase: SupabaseClient<Database>,
  input: {
    accountId: string
    patientId: string
    paymentId: string
    amountCents: number
    purpose: 'visit' | 'bono' | 'membership' | 'on_account'
    bono?: { packageName: string; priceCents: number; sessionsTotal: number }
    serviceName?: string
  },
): Promise<string | null> {
  const { data: number } = await supabase.rpc('next_factura_number', { p_account_id: input.accountId })
  if (!number) return null

  const money = (cents: number) => `€${(cents / 100).toFixed(2)}`

  let description: string
  if (input.purpose === 'bono' && input.bono) {
    const { packageName, priceCents, sessionsTotal } = input.bono
    // Rounded down, same as the client: a payment covering five and a half
    // sessions has bought five.
    const covered = priceCents > 0 ? Math.floor((input.amountCents / priceCents) * sessionsTotal) : 0
    description = `${packageName} — ${money(input.amountCents)} of ${money(priceCents)} (${covered} of ${sessionsTotal} sessions)`
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
  const tax = facturaTaxFor(input.amountCents, taxDefaults)

  const { error } = await supabase.from('facturas').insert({
    account_id: input.accountId,
    patient_id: input.patientId,
    payment_id: input.paymentId,
    number,
    kind,
    description,
    amount_cents: input.amountCents,
    tax_base_cents: tax.taxBaseCents,
    tax_rate_bp: tax.taxRateBp,
    tax_amount_cents: tax.taxAmountCents,
    tax_exemption_code: tax.taxExemptionCode,
  })
  if (error) return null
  return number
}

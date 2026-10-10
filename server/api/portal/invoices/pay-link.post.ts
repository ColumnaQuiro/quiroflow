import { invoiceCheckoutUrl } from '~/server/utils/invoiceCheckout'

// "Pagar" on one of the patient's own unpaid invoices: a Stripe-hosted
// Checkout page for what is still owed on it, opened in the system browser
// (the app is a WKWebView; a hosted page also keeps card details away from
// it entirely). See server/utils/invoiceCheckout.ts.
//
// The read of the invoice runs as the patient, so the invoices RLS policy
// decides whether it is theirs.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ invoiceId?: string }>(event)
  if (!body?.invoiceId) throw createError({ statusCode: 400, statusMessage: 'invoiceId is required' })

  const { supabase } = await requireAuthedUser(event)
  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, account_id, patient_id, invoice_number, status, total_cents, is_refund')
    .eq('id', body.invoiceId)
    .maybeSingle()
  if (!invoice) throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })

  const { url } = await invoiceCheckoutUrl(event, invoice)
  return { url }
})

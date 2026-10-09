import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeClientFor } from '~/server/utils/stripe'

// "Pagar" on one of the patient's own unpaid invoices: a Stripe-hosted
// Checkout page for what is still owed on it, opened in the system browser
// (the app is a WKWebView; a hosted page also keeps card details away from
// it entirely).
//
// Recording the money is NOT done here. The PaymentIntent carries
// metadata.invoice_id, exactly as online booking's does
// (public-booking/create-payment-intent.post.ts), so the webhook's existing
// payment_intent.succeeded branch (server/utils/stripeWebhookHandlers.ts)
// records the payment, issues its factura and marks the invoice paid once
// covered -- one path for a card payment against an invoice, not two.
//
// The read of the invoice runs as the patient, so the invoices RLS policy
// decides whether it is theirs; the amount is always derived here from the
// invoice and its payments, never taken from the client.
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
  if (invoice.is_refund || invoice.status !== 'unpaid') {
    throw createError({ statusCode: 400, statusMessage: 'This invoice is already settled.' })
  }

  const service = serverSupabaseServiceRole<Database>(event)
  const { data: payments } = await service.from('payments').select('amount_cents').eq('invoice_id', invoice.id)
  const remainingCents = invoice.total_cents - (payments ?? []).reduce((sum, p) => sum + p.amount_cents, 0)
  // Stripe's minimum charge in euros.
  if (remainingCents < 50) throw createError({ statusCode: 400, statusMessage: 'This invoice is already settled.' })

  const { data: account } = await service
    .from('accounts')
    .select('id, name, stripe_connect_account_id, stripe_publishable_key')
    .eq('id', invoice.account_id)
    .maybeSingle()
  if (!account?.stripe_publishable_key) {
    throw createError({ statusCode: 400, statusMessage: 'Online payment is not configured for this clinic.' })
  }

  const { stripe, options } = await stripeClientFor(event, account.id, account)
  const origin = getRequestURL(event).origin
  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      locale: 'es',
      line_items: [
        {
          quantity: 1,
          price_data: { currency: 'eur', unit_amount: remainingCents, product_data: { name: `${account.name} · ${invoice.invoice_number}` } },
        },
      ],
      // source: the webhook tells the clinic a patient paid on their own
      // (pushPatientAction); online booking's intents carry no source.
      payment_intent_data: { metadata: { invoice_id: invoice.id, account_id: account.id, source: 'patient_pay' } },
      success_url: `${origin}/payment-done?status=success`,
      cancel_url: `${origin}/payment-done?status=cancelled`,
    },
    options,
  )
  if (!session.url) throw createError({ statusCode: 502, statusMessage: 'Could not start the payment' })
  return { url: session.url }
})

import type { H3Event } from 'h3'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeClientFor } from '~/server/utils/stripe'

// A Stripe-hosted Checkout page for what is still owed on one unpaid invoice:
// the patient's own "Pagar" in the portal and the app, and the payment link
// the front desk sends from an Inbox conversation. The same page either way.
//
// Recording the money is NOT done here. The PaymentIntent carries
// metadata.invoice_id, exactly as online booking's does
// (public-booking/create-payment-intent.post.ts), so the webhook's existing
// payment_intent.succeeded branch (server/utils/stripeWebhookHandlers.ts)
// records the payment, issues its factura and marks the invoice paid once
// covered -- one path for a card payment against an invoice, not two.
// source 'patient_pay' is what tells the clinic a patient paid on their own
// (pushPatientAction), which is true of a sent link too.
//
// The caller reads the invoice through the signed-in person's own client, so
// RLS decides whether they may; the amount is always derived here from the
// invoice and its payments, never taken from the client.
export async function invoiceCheckoutUrl(
  event: H3Event,
  invoice: { id: string; account_id: string; invoice_number: string; status: string; total_cents: number; is_refund: boolean | null },
): Promise<{ url: string; remainingCents: number }> {
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
      payment_intent_data: { metadata: { invoice_id: invoice.id, account_id: account.id, source: 'patient_pay' } },
      success_url: `${origin}/payment-done?status=success`,
      cancel_url: `${origin}/payment-done?status=cancelled`,
    },
    options,
  )
  if (!session.url) throw createError({ statusCode: 502, statusMessage: 'Could not start the payment' })
  return { url: session.url, remainingCents }
}

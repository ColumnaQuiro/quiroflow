import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeClientFor } from '~/server/utils/stripe'

// Anonymous-safe -- the public booking widget has no session, so this uses
// the service-role client (like the webhook routes) instead of
// requirePermission. The amount is always re-derived from the invoice's own
// total_cents, never trusted from the client, since create_public_booking
// already computed it server-side from the appointment type's effective
// price at booking time.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ accountSlug: string; invoiceId: string }>(event)
  if (!body?.accountSlug || !body?.invoiceId) {
    throw createError({ statusCode: 400, statusMessage: 'accountSlug and invoiceId are required' })
  }

  const supabase = serverSupabaseServiceRole<Database>(event)

  const { data: account } = await supabase
    .from('accounts')
    .select('id, stripe_connect_account_id, stripe_secret_key, stripe_publishable_key')
    .eq('slug', body.accountSlug)
    .maybeSingle()
  if (!account?.stripe_publishable_key) {
    throw createError({ statusCode: 400, statusMessage: 'Online payment is not configured for this clinic.' })
  }

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, account_id, status, total_cents')
    .eq('id', body.invoiceId)
    .maybeSingle()
  if (!invoice || invoice.account_id !== account.id) {
    throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
  }
  if (invoice.status !== 'unpaid') {
    throw createError({ statusCode: 400, statusMessage: 'This invoice is already settled.' })
  }

  const { stripe, options } = stripeClientFor(account)

  const intent = await stripe.paymentIntents.create(
    {
      amount: invoice.total_cents,
      currency: 'eur',
      metadata: { invoice_id: invoice.id, account_id: account.id },
    },
    options,
  )

  return {
    clientSecret: intent.client_secret,
    publishableKey: account.stripe_publishable_key,
    connectAccountId: account.stripe_connect_account_id,
  }
})

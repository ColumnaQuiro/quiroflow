import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeForPlatform } from '~/server/utils/stripe'
import { handleStripeEvent } from '~/server/utils/stripeWebhookHandlers'
import type Stripe from 'stripe'

// One endpoint for every Connect-linked clinic: register this once in the
// platform Stripe account's Connect webhook settings ("Listen to events on
// Connected accounts"). Each event carries `event.account` (the connected
// account id) so we can resolve which clinic it belongs to -- no per-clinic
// registration needed, unlike the legacy webhook/[accountId] path.
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  if (!config.stripeConnectWebhookSecret) {
    throw createError({ statusCode: 500, statusMessage: 'Stripe Connect webhook is not configured on this deployment' })
  }

  const signature = getHeader(event, 'stripe-signature')
  const rawBody = await readRawBody(event)
  if (!signature || !rawBody) {
    throw createError({ statusCode: 400, statusMessage: 'Missing signature or body' })
  }

  const platform = stripeForPlatform()
  let stripeEvent: Stripe.Event
  try {
    stripeEvent = platform.webhooks.constructEvent(rawBody, signature, config.stripeConnectWebhookSecret)
  } catch (err: any) {
    throw createError({ statusCode: 400, statusMessage: `Invalid signature: ${err?.message}` })
  }

  if (!stripeEvent.account) {
    // A platform-account event (not from a connected account) -- nothing to do.
    return { received: true }
  }

  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data: account } = await supabase
    .from('accounts')
    .select('id')
    .eq('stripe_connect_account_id', stripeEvent.account)
    .maybeSingle()
  if (!account) {
    return { received: true }
  }

  await handleStripeEvent(supabase, account.id, stripeEvent)

  return { received: true }
})

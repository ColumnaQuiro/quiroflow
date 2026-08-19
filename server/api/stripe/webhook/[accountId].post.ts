import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeForAccount } from '~/server/utils/stripe'
import { handleStripeEvent } from '~/server/utils/stripeWebhookHandlers'
import type Stripe from 'stripe'

// Legacy path, kept for accounts that registered a per-clinic webhook before
// Connect existed (own secret key + own signing secret). New connections use
// the single platform endpoint at webhook.post.ts instead.
export default defineEventHandler(async (event) => {
  const accountId = getRouterParam(event, 'accountId')
  if (!accountId) throw createError({ statusCode: 400, statusMessage: 'Missing account id' })

  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data: account } = await supabase
    .from('accounts')
    .select('id, stripe_secret_key, stripe_webhook_secret')
    .eq('id', accountId)
    .maybeSingle()
  if (!account?.stripe_secret_key || !account?.stripe_webhook_secret) {
    throw createError({ statusCode: 400, statusMessage: 'Stripe is not configured for this account' })
  }

  const signature = getHeader(event, 'stripe-signature')
  const rawBody = await readRawBody(event)
  if (!signature || !rawBody) {
    throw createError({ statusCode: 400, statusMessage: 'Missing signature or body' })
  }

  const stripe = stripeForAccount(account.stripe_secret_key)
  let stripeEvent: Stripe.Event
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, account.stripe_webhook_secret)
  } catch (err: any) {
    throw createError({ statusCode: 400, statusMessage: `Invalid signature: ${err?.message}` })
  }

  await handleStripeEvent(supabase, account.id, stripeEvent)

  return { received: true }
})

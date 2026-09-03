import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeForPlatformBilling } from '~/server/utils/platformBillingStripe'
import type Stripe from 'stripe'

// Register this URL once in the platform-billing Stripe account's own
// webhook settings (NOT the Connect "connected accounts" listener --
// server/api/stripe/webhook.post.ts already owns that), subscribed to
// customer.subscription.created/updated/deleted. There's no
// checkout.session.completed handling here on purpose: whatever creates the
// Checkout Session should set subscription_data.metadata.account_id, and
// Stripe always fires a customer.subscription.created event once that
// Session completes -- so every event this endpoint cares about already
// carries a full Subscription object with everything needed to sync
// `subscriptions`, with no separate cross-reference step.
const STATUS_MAP: Partial<Record<Stripe.Subscription.Status, Database['public']['Tables']['subscriptions']['Row']['status']>> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
  unpaid: 'locked',
  paused: 'locked',
  // incomplete: omitted on purpose -- the first payment never completed, so
  // there's nothing real to reflect yet; incomplete_expired means it never
  // will, which is what `canceled` already means for our purposes.
  incomplete_expired: 'canceled',
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  if (!config.stripePlatformBillingWebhookSecret) {
    throw createError({ statusCode: 500, statusMessage: 'Platform billing webhook is not configured on this deployment' })
  }

  const signature = getHeader(event, 'stripe-signature')
  const rawBody = await readRawBody(event)
  if (!signature || !rawBody) {
    throw createError({ statusCode: 400, statusMessage: 'Missing signature or body' })
  }

  const stripe = stripeForPlatformBilling()
  let stripeEvent: Stripe.Event
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, config.stripePlatformBillingWebhookSecret)
  } catch (err: any) {
    throw createError({ statusCode: 400, statusMessage: `Invalid signature: ${err?.message}` })
  }

  if (!['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(stripeEvent.type)) {
    return { received: true }
  }

  const subscription = stripeEvent.data.object as Stripe.Subscription
  const accountId = subscription.metadata?.account_id
  if (!accountId) {
    // Not one of ours -- e.g. created by hand in the Stripe dashboard while
    // testing, with no account_id metadata set.
    return { received: true }
  }

  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data: plans } = await supabase
    .from('plans')
    .select('id, stripe_monthly_price_id, stripe_annual_price_id, stripe_extra_professional_monthly_price_id, stripe_extra_professional_annual_price_id')

  let planId: string | null = null
  let billingInterval: Database['public']['Tables']['subscriptions']['Row']['billing_interval'] = 'monthly'
  let extraProfessionals = 0

  for (const item of subscription.items.data) {
    const priceId = item.price.id
    const plan = (plans ?? []).find((p) => p.stripe_monthly_price_id === priceId || p.stripe_annual_price_id === priceId)
    if (plan) {
      planId = plan.id
      billingInterval = plan.stripe_annual_price_id === priceId ? 'annual' : 'monthly'
      continue
    }
    const addOnPlan = (plans ?? []).find((p) => p.stripe_extra_professional_monthly_price_id === priceId || p.stripe_extra_professional_annual_price_id === priceId)
    if (addOnPlan) extraProfessionals = item.quantity ?? 0
  }

  const mappedStatus = stripeEvent.type === 'customer.subscription.deleted' ? 'canceled' : STATUS_MAP[subscription.status]

  await supabase.from('subscriptions').upsert(
    {
      account_id: accountId,
      plan_id: planId as string, // null only if Stripe sent a price this deployment's `plans` table doesn't know about -- a real bug worth a loud DB error, not a silent skip
      billing_interval: billingInterval,
      ...(mappedStatus ? { status: mappedStatus } : {}),
      extra_professionals: extraProfessionals,
      trial_ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
      stripe_customer_id: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
      stripe_subscription_id: subscription.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id' },
  )

  return { received: true }
})

import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeForPlatformBilling } from '~/server/utils/platformBillingStripe'
import { isSupersededSubscriptionEvent } from '~/utils/billing'
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

  // Every failure from here on answers 500, never 200. Stripe retries a
  // non-2xx for three days and shows it in the dashboard; a 200 tells it the
  // event was applied. This endpoint used to fire the upsert and return
  // `received: true` whatever came back, so a database error -- or a plan it
  // could not map -- dropped a payment on the floor, and the only trace was a
  // clinic that had paid and was still locked.
  const fail = (message: string, detail?: unknown): never => {
    console.error(`[platform-billing-webhook] ${stripeEvent.type} ${subscription.id} account=${accountId}: ${message}`, detail ?? '')
    throw createError({ statusCode: 500, statusMessage: message })
  }

  const { data: row, error: rowError } = await supabase
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('account_id', accountId)
    .maybeSingle()
  if (rowError) fail('Could not read the subscription row', rowError)

  if (
    isSupersededSubscriptionEvent({
      rowSubscriptionId: row?.stripe_subscription_id,
      eventSubscriptionId: subscription.id,
      eventStatus: subscription.status,
      deleted: stripeEvent.type === 'customer.subscription.deleted',
    })
  ) {
    // Last subscription's news, arriving after the account moved on to a new
    // one. Acknowledged so Stripe stops sending it, and not applied.
    return { received: true, superseded: true }
  }

  const { data: plans, error: plansError } = await supabase
    .from('plans')
    .select('id, stripe_monthly_price_id, stripe_annual_price_id, stripe_extra_professional_monthly_price_id, stripe_extra_professional_annual_price_id')

  if (plansError) fail('Could not read plans', plansError)

  const { data: addons, error: addonsError } = await supabase
    .from('addons')
    .select('id, stripe_monthly_price_id, stripe_annual_price_id')
  if (addonsError) fail('Could not read addons', addonsError)

  let planId: string | null = null
  let billingInterval: Database['public']['Tables']['subscriptions']['Row']['billing_interval'] = 'monthly'
  let extraProfessionals = 0
  let growthAddon = false
  const unmatchedPriceIds: string[] = []

  for (const item of subscription.items.data) {
    const priceId = item.price.id
    const plan = (plans ?? []).find((p) => p.stripe_monthly_price_id === priceId || p.stripe_annual_price_id === priceId)
    if (plan) {
      planId = plan.id
      billingInterval = plan.stripe_annual_price_id === priceId ? 'annual' : 'monthly'
      continue
    }
    const addOnPlan = (plans ?? []).find((p) => p.stripe_extra_professional_monthly_price_id === priceId || p.stripe_extra_professional_annual_price_id === priceId)
    if (addOnPlan) {
      extraProfessionals = item.quantity ?? 0
      continue
    }
    const growth = (addons ?? []).find((a) => a.id === 'growth' && (a.stripe_monthly_price_id === priceId || a.stripe_annual_price_id === priceId))
    if (growth) {
      growthAddon = true
      continue
    }
    unmatchedPriceIds.push(priceId)
  }

  const mappedStatus = stripeEvent.type === 'customer.subscription.deleted' ? 'canceled' : STATUS_MAP[subscription.status]

  // What was bought is only written when every item on the subscription was
  // recognised. A price the catalogue no longer names is what every existing
  // subscription carries after a reprice repoints `plans` and `addons` at new
  // prices -- Stripe keeps billing them at the rate they agreed to. Mapping
  // what it can would read an unrecognised Growth item as "no Growth" and
  // switch it off for a clinic paying for it; failing the event would retry
  // it for three days and then have Stripe disable the endpoint, taking every
  // other account's events with it. So the plan, interval, seats and Growth
  // the row already has are kept, the rest of the event (status, above all)
  // is applied, and the mismatch is logged loudly enough to find.
  const itemsRecognised = !!planId && unmatchedPriceIds.length === 0
  if (!itemsRecognised) {
    console.error(
      `[platform-billing-webhook] ${subscription.id} account=${accountId}: unrecognised prices ${unmatchedPriceIds.join(', ') || '(no plan item)'}; keeping the plan, seats and add-ons already on the row`,
    )
  }

  // An update, not an upsert: every account has its row from signup, so a
  // missing one means the metadata names an account that does not exist,
  // which is worth failing on rather than inventing a row for.
  const { data: updated, error: updateError } = await supabase
    .from('subscriptions')
    .update({
      ...(itemsRecognised
        ? {
            plan_id: planId as string,
            billing_interval: billingInterval,
            extra_professionals: extraProfessionals,
            // Absent item means absent add-on: dropping Growth has to turn the
            // column off, not just leave it wherever it was. That makes the
            // Stripe subscription the single source of truth for what was
            // *bought*, which is why the two ways of granting Growth without
            // buying it -- `comped` and an active trial -- are separate
            // columns and separate branches in hasGrowth(), rather than this
            // one being set by hand.
            growth_addon: growthAddon,
          }
        : {}),
      ...(mappedStatus ? { status: mappedStatus } : {}),
      trial_ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
      stripe_customer_id: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
      stripe_subscription_id: subscription.id,
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)
    .select('account_id')
  if (updateError) fail('Could not update the subscription row', updateError)
  if (!updated?.length) fail('No subscription row for this account')

  return { received: true }
})

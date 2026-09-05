import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeForPlatformBilling } from '~/server/utils/platformBillingStripe'

// Read-only view of the platform billing (QuiroFlow's own subscription of the
// clinic, NOT the per-clinic Connect account used to bill patients) Stripe
// customer -- billing country, default card, and next renewal date, for the
// page header and the in-app "Billing info" tab. Fetched eagerly on page load
// (not lazily on tab-open) since the header needs the renewal date up front.
// Editing still happens on Stripe's hosted portal (portal-session.post.ts);
// this route only reads.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireTeamMember(event)
  if (!teamMember.is_owner) {
    throw createError({ statusCode: 403, statusMessage: 'Only the account owner can view billing details' })
  }

  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id, stripe_subscription_id')
    .eq('account_id', teamMember.account_id)
    .maybeSingle()
  if (!subscription?.stripe_customer_id) {
    return { hasCustomer: false as const }
  }

  const stripe = stripeForPlatformBilling()
  const customer = await stripe.customers.retrieve(subscription.stripe_customer_id, {
    expand: ['invoice_settings.default_payment_method'],
  })
  if (customer.deleted) {
    return { hasCustomer: false as const }
  }

  let card: { brand: string; last4: string } | null = null
  const defaultPm = customer.invoice_settings?.default_payment_method
  if (defaultPm && typeof defaultPm !== 'string' && defaultPm.card) {
    card = { brand: defaultPm.card.brand, last4: defaultPm.card.last4 }
  } else {
    // No default set explicitly -- fall back to whatever card is on file.
    const methods = await stripe.paymentMethods.list({ customer: subscription.stripe_customer_id, type: 'card', limit: 1 })
    const pm = methods.data[0]
    if (pm?.card) card = { brand: pm.card.brand, last4: pm.card.last4 }
  }

  let nextPaymentDate: string | null = null
  if (subscription.stripe_subscription_id) {
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id)
    // current_period_end lives on the subscription ITEM, not the subscription
    // itself, as of this pinned API version -- every item on a single-price
    // subscription shares the same renewal date, so the first is enough.
    const periodEnd = stripeSubscription.items.data[0]?.current_period_end
    if (periodEnd) nextPaymentDate = new Date(periodEnd * 1000).toISOString()
  }

  return {
    hasCustomer: true as const,
    country: customer.address?.country ?? null,
    card,
    nextPaymentDate,
  }
})

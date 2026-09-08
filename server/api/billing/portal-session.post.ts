import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeForPlatformBilling } from '~/server/utils/platformBillingStripe'

// Lets an account owner update their payment method / view invoices without
// QuiroFlow building any of that UI itself -- Stripe's own hosted Customer
// Portal covers it. Only reachable once a real subscription exists (a
// trialing account with no stripe_customer_id yet has nothing to manage
// here); the admin panel's "Start subscription" is what creates that.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireTeamMember(event)
  if (!teamMember.is_owner) {
    throw createError({ statusCode: 403, statusMessage: 'Only the account owner can manage billing' })
  }

  const body = await readBody<{ flow?: 'cancel' }>(event).catch(() => null)

  // subscriptions has no RLS policy granting UPDATE/INSERT to staff (by
  // design, see 0132's migration comment) and this route only reads it, but
  // the caller's own client can't see stripe_customer_id unless the 0134
  // SELECT policy covers it -- it does, this just avoids relying on that
  // indirectly and matches every other billing-adjacent route's use of the
  // service-role client for subscriptions access.
  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data: subscription } = await supabase.from('subscriptions').select('stripe_customer_id, stripe_subscription_id').eq('account_id', teamMember.account_id).maybeSingle()
  if (!subscription?.stripe_customer_id) {
    throw createError({ statusCode: 400, statusMessage: 'No billing account yet -- contact us to start a subscription.' })
  }

  const stripe = stripeForPlatformBilling()
  const origin = getRequestURL(event).origin

  // flow: 'cancel' deep-links straight into Stripe's own cancellation flow
  // (immediate vs. end-of-period, any retention offer -- all governed by the
  // portal's own configuration in the Stripe dashboard, not by us) instead of
  // landing on the generic portal home and making the owner find it
  // themselves. Silently falls back to the plain portal if there's no real
  // subscription to cancel yet (e.g. a comped account somehow reaching this).
  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripe_customer_id,
    return_url: `${origin}/subscription`,
    ...(body?.flow === 'cancel' && subscription.stripe_subscription_id
      ? { flow_data: { type: 'subscription_cancel' as const, subscription_cancel: { subscription: subscription.stripe_subscription_id } } }
      : {}),
  })

  return { url: session.url }
})

import Stripe from 'stripe'
import { canChangeInPlace } from '~/utils/billing'

const API_VERSION = '2026-07-29.dahlia'

// QuiroFlow's OWN billing of clinic accounts for using the product itself --
// a completely separate Stripe account/keys from server/utils/stripe.ts's
// stripeForPlatform() (Connect, used to bill clinics' OWN patients on their
// behalf). Never share a client between the two: a bug here must not be
// able to touch real clinic payment data, and vice versa.
export function stripeForPlatformBilling(): Stripe {
  const config = useRuntimeConfig()
  if (!config.stripePlatformBillingSecretKey) {
    throw createError({ statusCode: 500, statusMessage: 'Platform billing Stripe is not configured on this deployment' })
  }
  return new Stripe(config.stripePlatformBillingSecretKey, { apiVersion: API_VERSION })
}

/**
 * The account's Stripe subscription, if it is one that can still be changed
 * in place -- or null, meaning "start a new one through Checkout".
 *
 * The id on `subscriptions` outlives the subscription it names: the webhook
 * mirrors a cancellation as status 'canceled' and keeps the id. subscribe and
 * preview both used to take that id's existence to mean "update it", and
 * Stripe refuses to update a cancelled subscription, so an account that had
 * ever cancelled could never pay again. Null for a missing one too (an id
 * from another Stripe account, a test-mode leftover): Checkout is the one
 * path that recovers from all of these.
 */
export async function retrieveChangeableSubscription(
  stripe: Stripe,
  subscriptionId: string | null | undefined,
): Promise<Stripe.Subscription | null> {
  if (!subscriptionId) return null
  let current: Stripe.Subscription
  try {
    current = await stripe.subscriptions.retrieve(subscriptionId)
  } catch (err: any) {
    if (err?.code === 'resource_missing') return null
    throw err
  }
  return canChangeInPlace(current.status) ? current : null
}

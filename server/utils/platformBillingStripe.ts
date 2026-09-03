import Stripe from 'stripe'

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

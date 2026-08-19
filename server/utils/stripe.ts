import Stripe from 'stripe'

const API_VERSION = '2026-07-29.dahlia'

// The platform's own Stripe account -- used to talk to Connect accounts
// (with `{ stripeAccount: ... }` on each call) and to exchange OAuth codes.
export function stripeForPlatform(): Stripe {
  const config = useRuntimeConfig()
  if (!config.stripeSecretKey) {
    throw createError({ statusCode: 500, statusMessage: 'Stripe Connect is not configured on this deployment' })
  }
  return new Stripe(config.stripeSecretKey, { apiVersion: API_VERSION })
}

// Legacy path: a clinic pasted its own secret key into Settings > Payments
// before Connect existed. Still supported for accounts that haven't
// reconnected via OAuth yet.
export function stripeForAccount(secretKey: string): Stripe {
  return new Stripe(secretKey, { apiVersion: API_VERSION })
}

interface StripeAccountRow {
  stripe_connect_account_id: string | null
  stripe_secret_key: string | null
}

// Every Stripe call site needs both a client and the per-request options --
// Connect accounts use the platform's own key plus `stripeAccount`, legacy
// accounts use their own key with no extra options. Centralized here so a
// call site can't accidentally use the platform key without `stripeAccount`
// (which would hit the platform's own Stripe account, not the clinic's).
export function stripeClientFor(account: StripeAccountRow): { stripe: Stripe; options: Stripe.RequestOptions } {
  if (account.stripe_connect_account_id) {
    return { stripe: stripeForPlatform(), options: { stripeAccount: account.stripe_connect_account_id } }
  }
  if (account.stripe_secret_key) {
    return { stripe: stripeForAccount(account.stripe_secret_key), options: {} }
  }
  throw createError({ statusCode: 400, statusMessage: 'Stripe is not configured. Set it up in Settings > Payments.' })
}

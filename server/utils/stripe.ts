import Stripe from 'stripe'

// Each clinic connects its own Stripe account (test or live), so there's no
// single global API key -- callers fetch the account's stripe_secret_key
// from the DB and build a client with it per request.
export function stripeForAccount(secretKey: string): Stripe {
  return new Stripe(secretKey, { apiVersion: '2026-07-29.dahlia' })
}

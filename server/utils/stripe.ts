import Stripe from 'stripe'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { H3Event } from 'h3'
import type { Database } from '~/types/database.types'

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
}

// Every Stripe call site needs both a client and the per-request options --
// Connect accounts use the platform's own key plus `stripeAccount`, legacy
// accounts use their own key with no extra options. Centralized here so a
// call site can't accidentally use the platform key without `stripeAccount`
// (which would hit the platform's own Stripe account, not the clinic's).
//
// Takes the event and builds its own service-role client rather than accepting
// one, because the legacy key now lives in account_secrets, which denies
// `authenticated` outright. Most callers hold the RLS-scoped client from
// requirePermission; handed that, the lookup would return null and every
// legacy clinic would read as "Stripe is not configured". Sourcing the client
// here makes that mistake unavailable rather than merely documented.
export async function stripeClientFor(
  event: H3Event,
  accountId: string,
  account: StripeAccountRow,
): Promise<{ stripe: Stripe; options: Stripe.RequestOptions }> {
  if (account.stripe_connect_account_id) {
    return { stripe: stripeForPlatform(), options: { stripeAccount: account.stripe_connect_account_id } }
  }

  const admin = serverSupabaseServiceRole<Database>(event)
  const secretKey = await getAccountSecret(admin, accountId, 'stripe_secret_key')
  if (secretKey) {
    return { stripe: stripeForAccount(secretKey), options: {} }
  }

  throw createError({ statusCode: 400, statusMessage: 'Stripe is not configured. Set it up in Settings > Payments.' })
}

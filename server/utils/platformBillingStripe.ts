import type Stripe from 'stripe'
import { canChangeInPlace } from '~/utils/billing'

const API_VERSION = '2026-07-29.dahlia'

// QuiroFlow's OWN billing of clinic accounts for using the product itself --
// a completely separate Stripe account/keys from server/utils/stripe.ts's
// stripeForPlatform() (Connect, used to bill clinics' OWN patients on their
// behalf). Never share a client between the two: a bug here must not be
// able to touch real clinic payment data, and vice versa.
export async function stripeForPlatformBilling(): Promise<Stripe> {
  const config = useRuntimeConfig()
  if (!config.stripePlatformBillingSecretKey) {
    throw createError({ statusCode: 500, statusMessage: 'Platform billing Stripe is not configured on this deployment' })
  }
  const { default: Stripe } = await import('stripe')
  return new Stripe(config.stripePlatformBillingSecretKey, { apiVersion: API_VERSION })
}

/**
 * Makes Stripe render this customer's invoices, receipts and billing emails
 * in Spanish (Spain).
 *
 * Stripe picks the language from the customer's preferred_locales, which
 * Checkout fills from the browser. A clinic owner with an English browser
 * therefore got English invoices -- "Invoice", "Bill to", "Date due" -- which
 * is the wrong document for a Spanish B2B sale. Only the first locale is
 * checked, so a customer someone deliberately set to Catalan or Spanish is
 * left alone.
 *
 * Never throws: the caller is the billing webhook, and a failed cosmetic
 * update must not make Stripe retry (and eventually disable) the event that
 * unlocks a clinic that has just paid.
 */
export async function ensureSpanishInvoices(stripe: Stripe, customerId: string): Promise<void> {
  try {
    const customer = await stripe.customers.retrieve(customerId)
    if (customer.deleted) return
    const first = customer.preferred_locales?.[0] ?? ''
    if (first.startsWith('es') || first.startsWith('ca')) return
    await stripe.customers.update(customerId, { preferred_locales: ['es-ES'] })
  } catch (err) {
    console.error(`[platform-billing] could not set Spanish invoices for ${customerId}`, err)
  }
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

import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { canChangeInPlace } from '~/utils/billing'
import { isUiLanguage, type UiLanguage } from '~/utils/uiLanguage'

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

// Stripe's own code for each interface language, used both for Checkout and
// for the customer's preferred_locales. Every one of them is a language
// Stripe renders invoices, receipts and billing emails in.
const STRIPE_LOCALES: Record<UiLanguage, Stripe.Checkout.SessionCreateParams.Locale> = {
  es: 'es',
  en: 'en-GB',
  pt: 'pt',
  de: 'de',
}

/**
 * The language QuiroFlow bills a clinic in: the interface language of its
 * first owner (team_members.language_preference, chosen at onboarding and in
 * Account settings). Spanish when there is no owner to ask.
 *
 * The clinic's own interface, not Spanish for everyone and not the browser.
 * Stripe takes the invoice language from the customer's preferred_locales,
 * which Checkout fills from the browser -- so it used to be whatever the
 * computer happened to be set to. And an English invoice is a valid factura
 * in Spain (art. 12 of the Reglamento de facturación lets it be issued in any
 * language); what it cannot lack is the issuer's legal name and NIF, which
 * the Stripe account's invoice settings supply whatever the language.
 */
export async function billingLanguage(supabase: SupabaseClient<Database>, accountId: string): Promise<UiLanguage> {
  const { data } = await supabase
    .from('team_members')
    .select('language_preference')
    .eq('account_id', accountId)
    .eq('is_owner', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  const lang = data?.language_preference
  return isUiLanguage(lang) ? lang : 'es'
}

export function stripeLocale(lang: UiLanguage): Stripe.Checkout.SessionCreateParams.Locale {
  return STRIPE_LOCALES[lang]
}

/**
 * Points the customer's invoices, receipts and billing emails at `lang`.
 * Retrieves first and writes only on a difference, so an owner who changes
 * language is followed from their next subscription event on.
 *
 * Never throws: the caller is the billing webhook, and a failed cosmetic
 * update must not make Stripe retry (and eventually disable) the event that
 * unlocks a clinic that has just paid.
 */
export async function syncInvoiceLanguage(stripe: Stripe, customerId: string, lang: UiLanguage): Promise<void> {
  const want = stripeLocale(lang)
  try {
    const customer = await stripe.customers.retrieve(customerId)
    if (customer.deleted) return
    if (customer.preferred_locales?.[0]?.toLowerCase() === want.toLowerCase()) return
    await stripe.customers.update(customerId, { preferred_locales: [want] })
  } catch (err) {
    console.error(`[platform-billing] could not set invoice language ${want} for ${customerId}`, err)
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

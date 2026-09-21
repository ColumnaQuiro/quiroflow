import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeForPlatformBilling } from '~/server/utils/platformBillingStripe'

// Read-only view of the platform billing (QuiroFlow's own subscription of the
// clinic, NOT the per-clinic Connect account used to bill patients) Stripe
// customer: the billing record shown on /subscription, the card on file, and
// what the next invoice will actually be for. Editing still happens on
// Stripe's hosted portal (portal-session.post.ts); this route only reads.
//
// The next charge comes from Stripe's own invoice preview rather than from
// multiplying our plan prices. Those two disagree whenever a proration, a
// credit or a coupon is in play, and local arithmetic is what once told an
// annual customer their next payment was 44,00 EUR while Stripe took 528,00.
// The page falls back to computing it (utils/billing.ts) only when this call
// cannot answer -- an account with no Stripe customer yet, typically.
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

  let card: { brand: string; last4: string; expMonth: number; expYear: number } | null = null
  const defaultPm = customer.invoice_settings?.default_payment_method
  if (defaultPm && typeof defaultPm !== 'string' && defaultPm.card) {
    card = {
      brand: defaultPm.card.brand,
      last4: defaultPm.card.last4,
      expMonth: defaultPm.card.exp_month,
      expYear: defaultPm.card.exp_year,
    }
  } else {
    // No default set explicitly -- fall back to whatever card is on file.
    const methods = await stripe.paymentMethods.list({ customer: subscription.stripe_customer_id, type: 'card', limit: 1 })
    const pm = methods.data[0]
    if (pm?.card) {
      card = { brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year }
    }
  }

  // The NIF a Spanish clinic needs on its invoices. A customer can carry more
  // than one tax id; the first is the one Stripe prints.
  let taxId: string | null = null
  try {
    const taxIds = await stripe.customers.listTaxIds(subscription.stripe_customer_id, { limit: 1 })
    taxId = taxIds.data[0]?.value ?? null
  } catch {
    // Not fatal -- the billing record renders the row as unset.
  }

  let nextPaymentDate: string | null = null
  let cancelAt: string | null = null
  if (subscription.stripe_subscription_id) {
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id)
    // Set only when Stripe's dunning is configured to cancel after the last
    // retry. Absent, there is no date to promise.
    cancelAt = stripeSubscription.cancel_at ? new Date(stripeSubscription.cancel_at * 1000).toISOString() : null
    // current_period_end lives on the subscription ITEM, not the subscription
    // itself, as of this pinned API version -- every item on a single-price
    // subscription shares the same renewal date, so the first is enough.
    const periodEnd = stripeSubscription.items.data[0]?.current_period_end
    if (periodEnd) nextPaymentDate = new Date(periodEnd * 1000).toISOString()
  }

  // What Stripe will actually take next, with its own tax figure. Wrapped
  // because a subscription that is trialing with no card, or one Stripe
  // considers finished, has no upcoming invoice at all -- that is a normal
  // state, not an error, and the page renders the trial variant for it.
  let upcoming: { totalCents: number; subtotalCents: number; taxCents: number; currency: string } | null = null
  if (subscription.stripe_subscription_id) {
    try {
      const preview = await stripe.invoices.createPreview({
        customer: subscription.stripe_customer_id,
        subscription: subscription.stripe_subscription_id,
      })
      upcoming = {
        totalCents: preview.amount_due,
        subtotalCents: preview.subtotal,
        taxCents: (preview.total_taxes ?? []).reduce((sum, t) => sum + t.amount, 0),
        currency: preview.currency,
      }
    } catch {
      upcoming = null
    }
  }

  // What a past_due account actually needs to know: what we tried to take,
  // when we try again, and why the bank said no.
  //
  // All of it comes from Stripe because nothing in this app decides any of
  // it. trial-expiry-cron only locks TRIALING accounts that never had a
  // Stripe subscription; once a real subscription exists its status mirrors
  // Stripe's, and the retry schedule and what happens after the last retry
  // are Stripe dunning settings. cancelAt is therefore only present when
  // those settings are configured to cancel -- left null otherwise rather
  // than guessing a date a clinic would plan around.
  let pastDue: {
    amountCents: number
    attemptedAt: string | null
    nextAttemptAt: string | null
    declineReason: string | null
    invoiceUrl: string | null
    cancelAt: string | null
  } | null = null
  try {
    const open = await stripe.invoices.list({
      customer: subscription.stripe_customer_id,
      status: 'open',
      limit: 1,
    })
    const invoice = open.data[0]
    if (invoice) {
      // The message the bank gave, if Stripe recorded one. Shapes differ
      // across API versions, so each hop is optional and a miss just means
      // the banner says less rather than throwing.
      let declineReason: string | null = null
      try {
        const charge = (invoice as unknown as { charge?: string | { failure_message?: string | null } }).charge
        if (charge && typeof charge !== 'string') declineReason = charge.failure_message ?? null
        else if (typeof charge === 'string') {
          const full = await stripe.charges.retrieve(charge)
          declineReason = full.failure_message ?? null
        }
      } catch {
        declineReason = null
      }

      pastDue = {
        amountCents: invoice.amount_due,
        attemptedAt: invoice.status_transitions?.finalized_at
          ? new Date(invoice.status_transitions.finalized_at * 1000).toISOString()
          : null,
        nextAttemptAt: invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000).toISOString() : null,
        declineReason,
        invoiceUrl: invoice.hosted_invoice_url ?? null,
        cancelAt: cancelAt,
      }
    }
  } catch {
    pastDue = null
  }

  const address = customer.address
  return {
    hasCustomer: true as const,
    name: customer.name ?? null,
    email: customer.email ?? null,
    country: address?.country ?? null,
    taxId,
    address: address
      ? {
          line1: address.line1 ?? null,
          line2: address.line2 ?? null,
          postalCode: address.postal_code ?? null,
          city: address.city ?? null,
        }
      : null,
    card,
    nextPaymentDate,
    upcoming,
    pastDue,
  }
})

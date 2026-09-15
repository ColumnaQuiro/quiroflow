import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeForPlatformBilling } from '~/server/utils/platformBillingStripe'

// Starts a brand-new platform subscription (redirect to Stripe Checkout to
// collect a card) or changes an existing one's plan/interval/seat count in
// place via the Stripe API -- no redirect needed for that second case since
// the card is already on file. Either way, `subscriptions` itself is never
// written here: server/api/stripe/platform-billing-webhook.post.ts is the
// only writer, reacting to the customer.subscription.* event Stripe fires
// once Checkout completes or the update call above lands.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireTeamMember(event)
  if (!teamMember.is_owner) {
    throw createError({ statusCode: 403, statusMessage: 'Only the account owner can manage billing' })
  }

  const body = await readBody<{ planId: string; interval: 'monthly' | 'annual'; extraProfessionals?: number; growth?: boolean }>(event)
  if (!body?.planId || (body.interval !== 'monthly' && body.interval !== 'annual')) {
    throw createError({ statusCode: 400, statusMessage: 'planId and interval are required' })
  }
  const extraProfessionals = Math.max(0, Math.trunc(body.extraProfessionals ?? 0))
  const wantsGrowth = body.growth === true

  const serviceRole = serverSupabaseServiceRole<Database>(event)
  const { data: plan } = await serviceRole.from('plans').select('*').eq('id', body.planId).maybeSingle()
  if (!plan) throw createError({ statusCode: 400, statusMessage: 'Unknown plan' })

  const planPriceId = body.interval === 'annual' ? plan.stripe_annual_price_id : plan.stripe_monthly_price_id
  const addOnPriceId = body.interval === 'annual' ? plan.stripe_extra_professional_annual_price_id : plan.stripe_extra_professional_monthly_price_id
  if (!planPriceId) throw createError({ statusCode: 500, statusMessage: 'This plan has no Stripe price configured' })
  if (extraProfessionals > 0 && !addOnPriceId) {
    throw createError({ statusCode: 400, statusMessage: 'This plan does not support extra professionals' })
  }

  // Growth attaches to any plan, so it is resolved from `addons` rather than
  // from the chosen plan's columns -- that is the whole point of it being an
  // add-on and not a fourth tier. Whether a missing price is fatal is decided
  // below, after the seat check.
  const growth = await growthAddonPrices(serviceRole, body.interval)

  // enforce_practitioner_seats (0150) only blocks a plan limit from being
  // breached going FORWARD -- it has nothing to say about an account that's
  // already over a plan it hasn't switched to yet. Without this check, an
  // owner could downgrade from Clinic (6 seats) to Solo (1) with 5 active
  // practitioners and the switch would silently succeed: the trigger only
  // fires on team_members writes, not on a Stripe subscription update, so
  // every existing practitioner would be grandfathered in with no warning
  // that the account is now over its own plan. Checked here, before any
  // Stripe call, using the same "seat" definition (is_practitioner, not
  // soft-deleted) the trigger and pages/subscription.vue both use.
  if (plan.included_professionals !== null) {
    const { count: practitionerCount } = await serviceRole
      .from('team_members')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', teamMember.account_id)
      .eq('is_practitioner', true)
      .is('deleted_at', null)
    const allowance = plan.included_professionals + extraProfessionals
    if ((practitionerCount ?? 0) > allowance) {
      throw createError({
        statusCode: 400,
        statusMessage: `This plan covers ${allowance} practitioner(s), but ${practitionerCount} are currently active. Add more extra professionals, or mark some staff as non-practitioner, before switching.`,
      })
    }
  }

  // Deliberately after the seat check. This is an operator problem -- nobody
  // configured a Stripe price -- while the seat check is something the owner
  // can act on, and whichever throws first is the only message they see.
  // Refusing rather than quietly dropping Growth from the items: an account
  // that pays for it must not lose it as a side effect of changing plan.
  if (wantsGrowth && !growth.priceId) {
    throw createError({ statusCode: 500, statusMessage: 'Growth has no Stripe price configured for this billing interval' })
  }

  const { data: subscription } = await serviceRole
    .from('subscriptions')
    .select('stripe_customer_id, stripe_subscription_id')
    .eq('account_id', teamMember.account_id)
    .maybeSingle()

  const stripe = stripeForPlatformBilling()

  // VAT. QuiroFlow sells software to Spanish clinics, so every subscription
  // carries 21% IVA -- a fixed tax rate rather than Stripe Tax, which prices
  // per transaction and buys multi-jurisdiction determination we do not need
  // while the customers are domestic.
  //
  // Refuse rather than fall through when it is missing in live mode. Issuing a
  // VAT-free invoice for a Spanish B2B sale is not a smaller failure than not
  // taking the payment -- it is wrong on the customer's books as well as ours,
  // and correcting it afterwards means a credit note per invoice already sent.
  // Test keys are allowed through so a sandbox needs no tax rate configured.
  const config = useRuntimeConfig()
  const taxRateId = config.stripePlatformBillingTaxRateId || null
  const liveMode = config.stripePlatformBillingSecretKey.startsWith('sk_live_')
  if (!taxRateId && liveMode) {
    throw createError({
      statusCode: 500,
      statusMessage: 'No VAT rate is configured for billing. Set NUXT_STRIPE_PLATFORM_BILLING_TAX_RATE_ID before taking subscriptions.',
    })
  }
  const defaultTaxRates = taxRateId ? [taxRateId] : undefined

  // Already paying: change the existing subscription's items in place. No
  // checkout redirect -- the card on file is reused, matching how upgrading
  // a plan works on every subscription SaaS.
  if (subscription?.stripe_subscription_id) {
    const current = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id)
    // Every plan's price ids, not just the target plan's, so the item
    // actually carrying the CURRENT plan is found regardless of which
    // plan/interval that was.
    const { data: allPlans } = await serviceRole.from('plans').select('stripe_monthly_price_id, stripe_annual_price_id, stripe_extra_professional_monthly_price_id, stripe_extra_professional_annual_price_id')
    const allPlanPriceIds = new Set((allPlans ?? []).flatMap((p) => [p.stripe_monthly_price_id, p.stripe_annual_price_id].filter(Boolean)))
    const addOnPriceIds = new Set((allPlans ?? []).flatMap((p) => [p.stripe_extra_professional_monthly_price_id, p.stripe_extra_professional_annual_price_id].filter(Boolean)))

    const planItem = current.items.data.find((item) => allPlanPriceIds.has(item.price.id))
    const addOnItem = current.items.data.find((item) => addOnPriceIds.has(item.price.id))
    const growthItem = current.items.data.find((item) => growth.allPriceIds.has(item.price.id))

    const items: Array<{ id?: string; price?: string; quantity?: number; deleted?: boolean }> = []
    items.push(planItem ? { id: planItem.id, price: planPriceId, quantity: 1 } : { price: planPriceId, quantity: 1 })
    if (extraProfessionals > 0 && addOnPriceId) {
      items.push(addOnItem ? { id: addOnItem.id, price: addOnPriceId, quantity: extraProfessionals } : { price: addOnPriceId, quantity: extraProfessionals })
    } else if (addOnItem) {
      items.push({ id: addOnItem.id, deleted: true })
    }
    // Quantity 1 always: Growth is one flat thing per account, unlike extra
    // professionals which are priced per seat.
    if (wantsGrowth && growth.priceId) {
      items.push(growthItem ? { id: growthItem.id, price: growth.priceId, quantity: 1 } : { price: growth.priceId, quantity: 1 })
    } else if (growthItem) {
      items.push({ id: growthItem.id, deleted: true })
    }

    // default_tax_rates is set on every update, not just at creation, so a
    // subscription made before VAT was configured picks it up the next time
    // the customer changes plan instead of staying untaxed forever.
    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      items,
      proration_behavior: 'create_prorations',
      ...(defaultTaxRates ? { default_tax_rates: defaultTaxRates } : {}),
    })
    return { updated: true }
  }

  // No subscription yet: send them to Stripe Checkout to enter a card.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const origin = getRequestURL(event).origin
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: subscription?.stripe_customer_id ?? undefined,
    customer_email: subscription?.stripe_customer_id ? undefined : (user?.email ?? undefined),
    // A Spanish B2B invoice needs the buyer's NIF/CIF and address on it, or
    // the clinic cannot deduct the IVA it just paid. Both are collected at
    // checkout for that reason, not for our own records.
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    // Only valid alongside an existing `customer`; without it Stripe collects
    // the address and then discards it instead of saving it to the customer.
    ...(subscription?.stripe_customer_id ? { customer_update: { address: 'auto' as const, name: 'auto' as const } } : {}),
    line_items: [
      { price: planPriceId, quantity: 1 },
      ...(extraProfessionals > 0 && addOnPriceId ? [{ price: addOnPriceId, quantity: extraProfessionals }] : []),
      ...(wantsGrowth && growth.priceId ? [{ price: growth.priceId, quantity: 1 }] : []),
    ],
    // On the subscription rather than the line items: line-item tax_rates
    // apply to this one checkout's invoice, so every renewal after it would
    // have gone out with no VAT on it.
    subscription_data: {
      metadata: { account_id: teamMember.account_id },
      ...(defaultTaxRates ? { default_tax_rates: defaultTaxRates } : {}),
    },
    success_url: `${origin}/subscription?checkout=success`,
    cancel_url: `${origin}/subscription`,
  })

  return { url: session.url }
})

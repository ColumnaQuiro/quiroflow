import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { planIncludesGrowth, receptionistLineWanted } from '~/utils/growthPlans'
import { checkoutTrialEnd, graceBackdate, graceCatchUpCents } from '~/utils/billing'
import { billingLanguage, retrieveChangeableSubscription, stripeForPlatformBilling, stripeLocale } from '~/server/utils/platformBillingStripe'
import { verifactuFeeItemFor } from '~/server/utils/verifactuFee'
import { checkoutReferralCoupon } from '~/server/utils/clinicReferralRewards'

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

  const body = await readBody<{ planId: string; interval: 'monthly' | 'annual'; extraProfessionals?: number; extraClinics?: number; growth?: boolean; receptionist?: boolean; branding?: boolean }>(event)
  if (!body?.planId || (body.interval !== 'monthly' && body.interval !== 'annual')) {
    throw createError({ statusCode: 400, statusMessage: 'planId and interval are required' })
  }
  const extraProfessionals = Math.max(0, Math.trunc(body.extraProfessionals ?? 0))
  // A plan that includes Growth never gets a Growth line item, whatever the
  // client asked for. Billing 39 euros on top of a plan sold as "Growth
  // included" would be the invoice nobody can explain, and the entitlement
  // does not need it either -- hasGrowth() reads the plan.
  const wantsGrowth = body.growth === true && !planIncludesGrowth(body.planId)
  // And the receptionist never alongside Growth, which includes it.
  const wantsReceptionist = receptionistLineWanted({ receptionist: body.receptionist, growth: wantsGrowth, planId: body.planId })

  const serviceRole = serverSupabaseServiceRole<Database>(event)
  const { data: plan } = await serviceRole.from('plans').select('*').eq('id', body.planId).maybeSingle()
  if (!plan) throw createError({ statusCode: 400, statusMessage: 'Unknown plan' })

  const planPriceId = body.interval === 'annual' ? plan.stripe_annual_price_id : plan.stripe_monthly_price_id
  // Both of these are 19 EUR a month: seats carry no annual discount, unlike
  // the plans, which are 10% off.
  //
  // Not an oversight. `plans` has two Stripe price ids for seats but a single
  // extra_professional_price_cents to display, so a discounted annual seat
  // would show one number on the Subscription page and charge another -- and
  // an owner adding a seat mid-year is the person least likely to forgive
  // that. The choice is a second column or one price; one price won.
  //
  // So if you are here to "fix" the missing annual discount on seats, it
  // needs the column first, in plans and in the card that renders it.
  const addOnPriceId = body.interval === 'annual' ? plan.stripe_extra_professional_annual_price_id : plan.stripe_extra_professional_monthly_price_id
  if (!planPriceId) throw createError({ statusCode: 500, statusMessage: 'This plan has no Stripe price configured' })
  if (extraProfessionals > 0 && !addOnPriceId) {
    throw createError({ statusCode: 400, statusMessage: 'This plan does not support extra professionals' })
  }
  // Locations beyond the plan's own, sold only by a plan that prices them
  // (Clinic). The same 29 EUR on both intervals, for the reason above.
  const extraClinicPriceId = body.interval === 'annual' ? plan.stripe_extra_clinic_annual_price_id : plan.stripe_extra_clinic_monthly_price_id
  const sellsExtraClinics = plan.extra_clinic_price_cents !== null
  if ((body.extraClinics ?? 0) > 0 && !sellsExtraClinics) {
    throw createError({ statusCode: 400, statusMessage: 'This plan does not support extra locations' })
  }

  // Growth attaches to any plan, so it is resolved from `addons` rather than
  // from the chosen plan's columns -- that is the whole point of it being an
  // add-on and not a fourth tier. Whether a missing price is fatal is decided
  // below, after the seat check.
  const growth = await growthAddonPrices(serviceRole, body.interval)
  const receptionist = await receptionistAddonPrices(serviceRole, body.interval)
  const branding = await brandingAddonPrices(serviceRole, body.interval)

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

  const { data: subscription } = await serviceRole
    .from('subscriptions')
    .select('stripe_customer_id, stripe_subscription_id, status, trial_ends_at, comped, extra_clinics')
    .eq('account_id', teamMember.account_id)
    .maybeSingle()

  // A request that does not mention locations keeps the ones already bought:
  // the add-ons card and "add a card" know nothing about them, and turning
  // Growth on must not take a location away. Never on a plan that does not
  // sell them, which is how leaving Clinic drops the line.
  const extraClinics = sellsExtraClinics ? Math.max(0, Math.trunc(body.extraClinics ?? subscription?.extra_clinics ?? 0)) : 0
  if (extraClinics > 0 && !extraClinicPriceId) {
    throw createError({ statusCode: 500, statusMessage: 'Extra locations have no Stripe price configured for this billing interval' })
  }

  // The same going-forward gap as seats, for locations: the cap trigger
  // (enforce_clinic_location_cap) fires when a clinic is added or brought
  // back, not when the plan under it changes. So a group with three
  // locations could move to Solo, or drop a bought location while it is
  // still open, and keep all of them.
  if (plan.included_clinics !== null) {
    const { count: clinicCount } = await serviceRole
      .from('clinics')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', teamMember.account_id)
      .is('archived_at', null)
    const locationAllowance = plan.included_clinics + extraClinics
    if ((clinicCount ?? 0) > locationAllowance) {
      throw createError({
        statusCode: 400,
        statusMessage: sellsExtraClinics
          ? `This plan covers ${locationAllowance} location(s), but ${clinicCount} are open. Add more extra locations, or archive one, before switching.`
          : `This plan covers ${locationAllowance} location(s), but ${clinicCount} are open. Choose a plan that covers them, or archive one, before switching.`,
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
  if (wantsReceptionist && !receptionist.priceId) {
    throw createError({ statusCode: 500, statusMessage: 'The AI receptionist has no Stripe price configured for this billing interval' })
  }
  if (body.branding === true && !branding.priceId) {
    throw createError({ statusCode: 500, statusMessage: 'The brand add-on has no Stripe price configured for this billing interval' })
  }

  const stripe = await stripeForPlatformBilling()

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
  //
  // Only while that subscription is still alive. One that has been cancelled
  // (or never got its first payment) cannot be updated, so it falls through
  // to Checkout below, against the same Stripe customer -- which is how an
  // account that cancelled gets to pay again.
  const current = await retrieveChangeableSubscription(stripe, subscription?.stripe_subscription_id)
  if (current) {
    // Every plan's price ids, not just the target plan's, so the item
    // actually carrying the CURRENT plan is found regardless of which
    // plan/interval that was.
    const { data: allPlans } = await serviceRole
      .from('plans')
      .select('stripe_monthly_price_id, stripe_annual_price_id, stripe_extra_professional_monthly_price_id, stripe_extra_professional_annual_price_id, stripe_extra_clinic_monthly_price_id, stripe_extra_clinic_annual_price_id')
    const allPlanPriceIds = new Set((allPlans ?? []).flatMap((p) => [p.stripe_monthly_price_id, p.stripe_annual_price_id].filter(Boolean)))
    const addOnPriceIds = new Set((allPlans ?? []).flatMap((p) => [p.stripe_extra_professional_monthly_price_id, p.stripe_extra_professional_annual_price_id].filter(Boolean)))

    const planItem = current.items.data.find((item) => allPlanPriceIds.has(item.price.id))
    const addOnItem = current.items.data.find((item) => addOnPriceIds.has(item.price.id))
    const extraClinicPriceIds = new Set((allPlans ?? []).flatMap((p) => [p.stripe_extra_clinic_monthly_price_id, p.stripe_extra_clinic_annual_price_id].filter(Boolean)))
    const extraClinicItem = current.items.data.find((item) => extraClinicPriceIds.has(item.price.id))
    const growthItem = current.items.data.find((item) => growth.allPriceIds.has(item.price.id))

    const items: Array<{ id?: string; price?: string; quantity?: number; deleted?: boolean }> = []
    items.push(planItem ? { id: planItem.id, price: planPriceId, quantity: 1 } : { price: planPriceId, quantity: 1 })
    if (extraProfessionals > 0 && addOnPriceId) {
      items.push(addOnItem ? { id: addOnItem.id, price: addOnPriceId, quantity: extraProfessionals } : { price: addOnPriceId, quantity: extraProfessionals })
    } else if (addOnItem) {
      items.push({ id: addOnItem.id, deleted: true })
    }
    if (extraClinics > 0 && extraClinicPriceId) {
      items.push(extraClinicItem ? { id: extraClinicItem.id, price: extraClinicPriceId, quantity: extraClinics } : { price: extraClinicPriceId, quantity: extraClinics })
    } else if (extraClinicItem) {
      items.push({ id: extraClinicItem.id, deleted: true })
    }
    // Quantity 1 always: Growth is one flat thing per account, unlike extra
    // professionals which are priced per seat.
    if (wantsGrowth && growth.priceId) {
      items.push(growthItem ? { id: growthItem.id, price: growth.priceId, quantity: 1 } : { price: growth.priceId, quantity: 1 })
    } else if (growthItem) {
      items.push({ id: growthItem.id, deleted: true })
    }
    // Removed when Growth comes in: that is how an account moves from the
    // receptionist alone to Growth without paying for it twice.
    const receptionistItem = current.items.data.find((item) => receptionist.allPriceIds.has(item.price.id))
    if (wantsReceptionist && receptionist.priceId) {
      items.push(receptionistItem ? { id: receptionistItem.id, price: receptionist.priceId, quantity: 1 } : { price: receptionist.priceId, quantity: 1 })
    } else if (receptionistItem) {
      items.push({ id: receptionistItem.id, deleted: true })
    }
    // The clinic's own brand in the patient app. Unlike the two above, a
    // request that does not mention it leaves it as it is: Change plan and
    // the other callers know nothing about it, and a plan change must not
    // take off something the clinic pays for. Kept, it still follows the new
    // interval -- and if that interval has no price it is an operator
    // problem to refuse on, not a reason to drop it.
    const brandingItem = current.items.data.find((item) => branding.allPriceIds.has(item.price.id))
    const wantsBranding = body.branding ?? !!brandingItem
    if (wantsBranding) {
      if (!branding.priceId) throw createError({ statusCode: 500, statusMessage: 'The brand add-on has no Stripe price configured for this billing interval' })
      items.push(brandingItem ? { id: brandingItem.id, price: branding.priceId, quantity: 1 } : { price: branding.priceId, quantity: 1 })
    } else if (brandingItem) {
      items.push({ id: brandingItem.id, deleted: true })
    }
    // The VeriFactu fee is not the owner's to choose here, but it has to
    // follow the new interval: Stripe refuses items on mixed intervals.
    const verifactuFee = await verifactuFeeItemFor(serviceRole, teamMember.account_id, body.interval, current.items.data)
    if (verifactuFee) items.push(verifactuFee)

    // default_tax_rates is set on every update, not just at creation, so a
    // subscription made before VAT was configured picks it up the next time
    // the customer changes plan instead of staying untaxed forever.
    await stripe.subscriptions.update(current.id, {
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

  // A clinic still inside its free trial keeps the rest of it: the card goes
  // on file now and the first charge lands when the trial ends, which is what
  // the subscription page has always told them. See checkoutTrialEnd for when
  // it charges straight away instead. The webhook then mirrors Stripe's
  // `trialing` status and trial_end back onto the row, so the date the page
  // shows is the one Stripe will bill on.
  const trialEnd = checkoutTrialEnd(subscription)

  // A clinic already live on VeriFactu starts paying its fee with the rest.
  const verifactuFee = await verifactuFeeItemFor(serviceRole, teamMember.account_id, body.interval, [])
  const verifactuFeeLine = verifactuFee && 'price' in verifactuFee ? [{ price: verifactuFee.price, quantity: verifactuFee.quantity }] : []

  const recurringLines = [
    { price: planPriceId, quantity: 1 },
    ...(extraProfessionals > 0 && addOnPriceId ? [{ price: addOnPriceId, quantity: extraProfessionals }] : []),
    ...(extraClinics > 0 && extraClinicPriceId ? [{ price: extraClinicPriceId, quantity: extraClinics }] : []),
    ...(wantsGrowth && growth.priceId ? [{ price: growth.priceId, quantity: 1 }] : []),
    ...(wantsReceptionist && receptionist.priceId ? [{ price: receptionist.priceId, quantity: 1 }] : []),
    ...(body.branding === true && branding.priceId ? [{ price: branding.priceId, quantity: 1 }] : []),
    ...verifactuFeeLine,
  ]

  // A trial that ended a few days ago, card added now: the paid period starts
  // when the trial ended, not today, so the grace week is paid for rather than
  // given away and the billing date does not drift (graceBackdate says how).
  const language = await billingLanguage(serviceRole, teamMember.account_id)
  const backdate = trialEnd ? null : graceBackdate(subscription, body.interval)
  const catchUpLines: Array<{ price_data: { currency: string; unit_amount: number; product_data: { name: string } }; quantity: number; tax_rates?: string[] }> = []
  if (backdate) {
    const prices = await Promise.all(recurringLines.map((line) => stripe.prices.retrieve(line.price as string)))
    const periodCents = recurringLines.reduce((sum, line, i) => sum + (prices[i]?.unit_amount ?? 0) * (line.quantity ?? 1), 0)
    const cents = graceCatchUpCents(periodCents, backdate)
    if (cents > 0) {
      const from = new Date(backdate.periodStart * 1000).toLocaleDateString(language === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' })
      catchUpLines.push({
        price_data: {
          currency: prices[0]?.currency ?? 'eur',
          unit_amount: cents,
          product_data: { name: language === 'es' ? `Uso desde el fin de la prueba (${from})` : `Use since the trial ended (${from})` },
        },
        quantity: 1,
        // A one-off line is not a subscription item, so default_tax_rates does
        // not reach it: IVA goes on it directly.
        ...(defaultTaxRates ? { tax_rates: defaultTaxRates } : {}),
      })
    }
  }

  // A clinic that came through another clinic's referral link gets its 10%
  // on its first paid invoice. Without a trial that invoice is charged the
  // moment Checkout completes, with no draft for the webhook to add it to, so
  // the coupon goes on the Session; with one, the webhook adds it to the
  // invoice Stripe drafts when the trial ends (clinicReferralRewards.ts).
  // Never in the way of subscribing: if it fails, the reward stays pending
  // and lands on a later invoice.
  let referralCoupon: string | null = null
  if (!trialEnd) {
    try {
      referralCoupon = await checkoutReferralCoupon(stripe, serviceRole, teamMember.account_id)
    } catch (err) {
      console.error(`[billing/subscribe] account=${teamMember.account_id}: clinic referral coupon failed`, err)
    }
  }

  const origin = getRequestURL(event).origin
  const session = await stripe.checkout.sessions.create({
    ...(referralCoupon ? { discounts: [{ coupon: referralCoupon }] } : {}),
    mode: 'subscription',
    customer: subscription?.stripe_customer_id ?? undefined,
    customer_email: subscription?.stripe_customer_id ? undefined : (user?.email ?? undefined),
    // A Spanish B2B invoice needs the buyer's NIF/CIF and address on it, or
    // the clinic cannot deduct the IVA it just paid. Both are collected at
    // checkout for that reason, not for our own records.
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    // The clinic's language, not the browser's. A Checkout that creates the
    // customer records its locale as preferred_locales, and Stripe renders
    // every invoice and receipt in that language. The webhook keeps it in
    // line afterwards (syncInvoiceLanguage); see billingLanguage for why
    // this is the language to follow.
    locale: stripeLocale(language),
    // Only valid alongside an existing `customer`; without it Stripe collects
    // the address and then discards it instead of saving it to the customer.
    ...(subscription?.stripe_customer_id ? { customer_update: { address: 'auto' as const, name: 'auto' as const } } : {}),
    line_items: [...recurringLines, ...catchUpLines],
    // On the subscription rather than the line items: line-item tax_rates
    // apply to this one checkout's invoice, so every renewal after it would
    // have gone out with no VAT on it.
    subscription_data: {
      metadata: { account_id: teamMember.account_id },
      ...(defaultTaxRates ? { default_tax_rates: defaultTaxRates } : {}),
      ...(trialEnd ? { trial_end: trialEnd } : {}),
      ...(backdate ? { billing_cycle_anchor: backdate.anchor } : {}),
    },
    success_url: `${origin}/subscription?checkout=success`,
    cancel_url: `${origin}/subscription`,
  })

  return { url: session.url }
})

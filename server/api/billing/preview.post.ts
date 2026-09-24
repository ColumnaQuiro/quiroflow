import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { retrieveChangeableSubscription, stripeForPlatformBilling } from '~/server/utils/platformBillingStripe'

export interface PreviewResult {
  // Whether there's anything to preview at all -- a brand-new subscription
  // (no stripe_subscription_id yet) has no proration: the sticker price on
  // the plan card already IS what Checkout will charge.
  previewable: boolean
  amountDueCents?: number
  taxCents?: number
  currency?: string
}

// Shows what an in-place plan/interval/seat change will actually cost TODAY
// (prorated against whatever's left of the current billing period) before
// server/api/billing/subscribe.post.ts commits it. Read-only against Stripe
// -- Invoices.createPreview never creates a real invoice or touches the
// subscription, so calling this as often as the picker's inputs change is
// safe. Mirrors subscribe.post.ts's own item-resolution logic exactly (same
// plan/tax lookups, same items array shape) since the preview has to reflect
// precisely what that route would send moments later.
export default defineEventHandler(async (event): Promise<PreviewResult> => {
  const { teamMember } = await requireTeamMember(event)
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

  const growth = await growthAddonPrices(serviceRole, body.interval)
  if (wantsGrowth && !growth.priceId) {
    throw createError({ statusCode: 500, statusMessage: 'Growth has no Stripe price configured for this billing interval' })
  }

  const { data: subscription } = await serviceRole
    .from('subscriptions')
    .select('stripe_customer_id, stripe_subscription_id')
    .eq('account_id', teamMember.account_id)
    .maybeSingle()

  if (!subscription?.stripe_subscription_id) {
    return { previewable: false }
  }

  const stripe = stripeForPlatformBilling()

  const config = useRuntimeConfig()
  const taxRateId = config.stripePlatformBillingTaxRateId || null
  const defaultTaxRates = taxRateId ? [taxRateId] : undefined

  // A cancelled subscription has nothing to prorate against: the change will
  // go through Checkout at the sticker price, exactly like a first purchase.
  // subscribe.post.ts makes the same call with the same helper, so the two
  // cannot disagree about which path a change takes.
  const current = await retrieveChangeableSubscription(stripe, subscription.stripe_subscription_id)
  if (!current) {
    return { previewable: false }
  }
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
  if (wantsGrowth && growth.priceId) {
    items.push(growthItem ? { id: growthItem.id, price: growth.priceId, quantity: 1 } : { price: growth.priceId, quantity: 1 })
  } else if (growthItem) {
    items.push({ id: growthItem.id, deleted: true })
  }

  const preview = await stripe.invoices.createPreview({
    customer: subscription.stripe_customer_id ?? undefined,
    subscription: current.id,
    subscription_details: {
      items,
      proration_behavior: 'create_prorations',
      ...(defaultTaxRates ? { default_tax_rates: defaultTaxRates } : {}),
    },
  })

  const taxCents = (preview.total_taxes ?? []).reduce((sum, t) => sum + t.amount, 0)

  return {
    previewable: true,
    amountDueCents: preview.amount_due,
    taxCents,
    currency: preview.currency,
  }
})

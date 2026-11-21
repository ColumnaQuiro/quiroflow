import { serverSupabaseServiceRole } from '#supabase/server'
import type Stripe from 'stripe'
import type { Database } from '~/types/database.types'
import { stripeClientFor } from '~/server/utils/stripe'
import { membershipIntervalOf } from '~/utils/stripeMembershipSync'

// Says which membership plan a Stripe price is: an existing plan
// (membershipId), a new one made from the price (createPlan), or none
// (membershipId null) to take the mapping away. The price is read from the
// clinic's Stripe rather than trusted from the page, so a price of another
// account is refused because it is not found there.
//
// Taking a mapping away pairs nothing new from that price; memberships
// already paired keep going.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'billing_config')
  const body = await readBody<{ priceId?: string; membershipId?: string | null; createPlan?: boolean }>(event)
  if (!body?.priceId) throw createError({ statusCode: 400, statusMessage: 'priceId is required' })
  const accountId = teamMember.account_id
  const admin = serverSupabaseServiceRole<Database>(event)

  if (!body.createPlan && !body.membershipId) {
    const { error } = await admin.from('stripe_membership_prices').delete().eq('account_id', accountId).eq('stripe_price_id', body.priceId)
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    return { ok: true, membershipId: null }
  }

  const { data: account } = await admin.from('accounts').select('stripe_connect_account_id').eq('id', accountId).maybeSingle()
  if (!account) throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  const { stripe, options } = await stripeClientFor(event, accountId, account)
  let price: Stripe.Price
  try {
    price = await stripe.prices.retrieve(body.priceId, { expand: ['product'] }, options)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Price not found in this Stripe account' })
  }
  if (!price.recurring) throw createError({ statusCode: 400, statusMessage: 'This price does not recur, so it is not a membership' })
  const productId = typeof price.product === 'string' ? price.product : price.product.id

  let membershipId = body.membershipId ?? null
  if (body.createPlan) {
    const recurring = membershipIntervalOf(price.recurring)
    const product = price.product as Stripe.Product
    const name = (typeof price.product !== 'string' && product.name) || price.nickname || 'Membership'
    const { data: plan, error } = await admin
      .from('memberships')
      .insert({
        account_id: accountId,
        name,
        price_cents: price.unit_amount ?? 0,
        billing_interval: recurring?.interval ?? 'month',
        billing_interval_count: recurring?.count ?? 1,
      })
      .select('id')
      .single()
    if (error || !plan) throw createError({ statusCode: 500, statusMessage: error?.message ?? 'Could not create the plan' })
    membershipId = plan.id
  } else {
    const { data: plan } = await admin.from('memberships').select('id').eq('id', membershipId!).eq('account_id', accountId).maybeSingle()
    if (!plan) throw createError({ statusCode: 404, statusMessage: 'Plan not found' })
  }

  const { error } = await admin
    .from('stripe_membership_prices')
    .upsert({ account_id: accountId, stripe_price_id: price.id, stripe_product_id: productId, membership_id: membershipId! }, { onConflict: 'account_id,stripe_price_id' })
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return { ok: true, membershipId }
})

import { stripeClientFor } from '~/server/utils/stripe'

export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requirePermission(event, 'billing_config')

  const { data: account } = await supabase
    .from('accounts')
    .select('stripe_connect_account_id, stripe_secret_key')
    .eq('id', teamMember.account_id)
    .maybeSingle()
  if (!account) {
    throw createError({ statusCode: 400, statusMessage: 'Stripe is not configured yet' })
  }

  try {
    const { stripe, options } = stripeClientFor(account)
    const balance = await stripe.balance.retrieve({}, options)
    return { success: true, livemode: balance.livemode }
  } catch (err: any) {
    throw createError({ statusCode: 400, statusMessage: err?.message ?? 'Could not connect to Stripe' })
  }
})

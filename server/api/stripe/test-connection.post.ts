import { serverSupabaseClient } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeClientFor } from '~/server/utils/stripe'

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient<Database>(event)
  const { data: teamMember } = await supabase.from('team_members').select('id, account_id').maybeSingle()
  if (!teamMember) {
    throw createError({ statusCode: 403, statusMessage: 'Not signed in as a team member' })
  }

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

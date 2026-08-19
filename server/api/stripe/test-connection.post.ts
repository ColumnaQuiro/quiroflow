import { serverSupabaseClient } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeForAccount } from '~/server/utils/stripe'

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient<Database>(event)
  const { data: teamMember } = await supabase.from('team_members').select('id, account_id').maybeSingle()
  if (!teamMember) {
    throw createError({ statusCode: 403, statusMessage: 'Not signed in as a team member' })
  }

  const { data: account } = await supabase.from('accounts').select('stripe_secret_key').eq('id', teamMember.account_id).maybeSingle()
  if (!account?.stripe_secret_key) {
    throw createError({ statusCode: 400, statusMessage: 'No Stripe secret key saved yet' })
  }

  try {
    const stripe = stripeForAccount(account.stripe_secret_key)
    const balance = await stripe.balance.retrieve()
    return { success: true, livemode: balance.livemode }
  } catch (err: any) {
    throw createError({ statusCode: 400, statusMessage: err?.message ?? 'Could not connect to Stripe' })
  }
})

import { serverSupabaseClient } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeForAccount } from '~/server/utils/stripe'

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient<Database>(event)
  const body = await readBody<{ paymentScheduleId: string }>(event)
  if (!body?.paymentScheduleId) {
    throw createError({ statusCode: 400, statusMessage: 'paymentScheduleId is required' })
  }

  const { data: teamMember } = await supabase.from('team_members').select('id, account_id').maybeSingle()
  if (!teamMember) {
    throw createError({ statusCode: 403, statusMessage: 'Not signed in as a team member' })
  }

  const [{ data: account }, { data: schedule }] = await Promise.all([
    supabase.from('accounts').select('stripe_secret_key').eq('id', teamMember.account_id).maybeSingle(),
    supabase.from('payment_schedules').select('id, stripe_subscription_schedule_id').eq('id', body.paymentScheduleId).maybeSingle(),
  ])
  if (!account?.stripe_secret_key || !schedule) {
    throw createError({ statusCode: 400, statusMessage: 'Schedule not found or Stripe not configured' })
  }

  const stripe = stripeForAccount(account.stripe_secret_key)
  try {
    await stripe.subscriptionSchedules.cancel(schedule.stripe_subscription_schedule_id)
  } catch (err: any) {
    // Already canceled/completed on Stripe's side -- still reflect that locally.
    if (err?.code !== 'resource_missing') throw createError({ statusCode: 502, statusMessage: err?.message ?? 'Stripe cancel failed' })
  }

  await supabase.from('payment_schedules').update({ status: 'canceled' }).eq('id', schedule.id)
  return { success: true }
})

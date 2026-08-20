import { stripeClientFor } from '~/server/utils/stripe'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ paymentScheduleId: string }>(event)
  if (!body?.paymentScheduleId) {
    throw createError({ statusCode: 400, statusMessage: 'paymentScheduleId is required' })
  }

  const { supabase, teamMember } = await requirePermission(event, 'billing_config')

  const [{ data: account }, { data: schedule }] = await Promise.all([
    supabase.from('accounts').select('stripe_connect_account_id, stripe_secret_key').eq('id', teamMember.account_id).maybeSingle(),
    supabase.from('payment_schedules').select('id, stripe_subscription_schedule_id').eq('id', body.paymentScheduleId).maybeSingle(),
  ])
  if (!account || !schedule) {
    throw createError({ statusCode: 400, statusMessage: 'Schedule not found or Stripe not configured' })
  }

  const { stripe, options } = stripeClientFor(account)
  try {
    await stripe.subscriptionSchedules.cancel(schedule.stripe_subscription_schedule_id, {}, options)
  } catch (err: any) {
    // Already canceled/completed on Stripe's side -- still reflect that locally.
    if (err?.code !== 'resource_missing') throw createError({ statusCode: 502, statusMessage: err?.message ?? 'Stripe cancel failed' })
  }

  await supabase.from('payment_schedules').update({ status: 'canceled' }).eq('id', schedule.id)
  return { success: true }
})

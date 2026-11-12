import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Stops collecting a membership by direct debit. Cancels the SUBSCRIPTION
// only: the mandate stays, so the patient's membership can be collected
// again later without them signing anything.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requirePermission(event, 'billing_config')
  const body = await readBody<{ paymentScheduleId?: string }>(event)
  if (!body?.paymentScheduleId) throw createError({ statusCode: 400, statusMessage: 'paymentScheduleId is required' })

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: schedule } = await admin
    .from('payment_schedules')
    .select('id, provider, gocardless_subscription_id, status')
    .eq('id', body.paymentScheduleId)
    .eq('account_id', teamMember.account_id)
    .maybeSingle()
  if (!schedule || schedule.provider !== 'gocardless' || !schedule.gocardless_subscription_id) {
    throw createError({ statusCode: 404, statusMessage: 'Direct debit schedule not found' })
  }

  const request = await gocardlessForAccount(admin, teamMember.account_id)
  if (!request) throw createError({ statusCode: 409, statusMessage: 'GoCardless is not connected, so the subscription cannot be cancelled from here. Cancel it in GoCardless.' })
  try {
    await request('POST', `/subscriptions/${schedule.gocardless_subscription_id}/actions/cancel`)
  } catch (err) {
    // Already cancelled (by the clinic in GoCardless, or by a mandate going
    // away): the end state is the one asked for.
    const alreadyGone = err instanceof GoCardlessError && (err.status === 422 || err.reasons.includes('cancellation_failed'))
    if (!alreadyGone) throw createError({ statusCode: 502, statusMessage: (err as Error).message })
  }

  await admin.from('payment_schedules').update({ status: 'canceled' }).eq('id', schedule.id)
  return { ok: true }
})

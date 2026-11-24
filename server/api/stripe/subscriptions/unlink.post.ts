import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Undoes a pairing made by mistake (the wrong patient), so it can be made
// again. Only while nothing has been booked from it: once a period was
// collected, its invoice, payment and factura name this patient, and taking
// the pairing away would leave them pointing at a membership that is gone.
// Then the membership is cancelled by hand instead. Nothing changes in
// Stripe either way.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'billing_config')
  const body = await readBody<{ subscriptionId?: string }>(event)
  if (!body?.subscriptionId) throw createError({ statusCode: 400, statusMessage: 'subscriptionId is required' })
  const accountId = teamMember.account_id
  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: schedule } = await admin
    .from('payment_schedules')
    .select('id, origin, patient_membership_id, installments_paid, adopted_membership')
    .eq('account_id', accountId)
    .eq('stripe_subscription_id', body.subscriptionId)
    .maybeSingle()
  if (!schedule || schedule.origin !== 'imported') throw createError({ statusCode: 404, statusMessage: 'This subscription is not paired here' })

  const { data: booked } = await admin.from('stripe_payment_events').select('id').eq('account_id', accountId).eq('payment_schedule_id', schedule.id).eq('status', 'paid').limit(1)
  if (booked?.length || schedule.installments_paid > 0) {
    throw createError({ statusCode: 409, statusMessage: 'A payment has already been recorded from this subscription. Cancel the membership on the patient instead.' })
  }

  const { error } = await admin.from('payment_schedules').delete().eq('id', schedule.id).eq('account_id', accountId)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  // The membership the pairing created goes with it: nothing was booked
  // against it. One the desk had recorded before, which the pairing only
  // took over, stays as it was.
  if (schedule.patient_membership_id && !schedule.adopted_membership) {
    await admin.from('patient_memberships').delete().eq('id', schedule.patient_membership_id).eq('account_id', accountId)
  }
  return { ok: true }
})

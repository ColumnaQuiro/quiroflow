import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Undoes a sync made by mistake (the wrong plan), so it can be made again.
// Only while nothing has been booked from it: once a collection was booked,
// its invoice, payment and factura hang off this membership, and taking it
// away would leave them pointing at nothing. Then the membership is ended on
// the patient instead. Nothing changes in GoCardless either way: the
// subscription keeps collecting for the app that created it.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requirePermission(event, 'billing_config')
  const body = await readBody<{ subscriptionId?: string }>(event)
  if (!body?.subscriptionId) throw createError({ statusCode: 400, statusMessage: 'subscriptionId is required' })
  const accountId = teamMember.account_id
  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: schedule } = await admin
    .from('payment_schedules')
    .select('id, origin, patient_membership_id, installments_paid, adopted_membership')
    .eq('account_id', accountId)
    .eq('gocardless_subscription_id', body.subscriptionId)
    .maybeSingle()
  if (!schedule || schedule.origin !== 'imported') throw createError({ statusCode: 404, statusMessage: 'This subscription is not synced here' })

  const { data: booked } = await admin.from('gocardless_payment_events').select('id').eq('account_id', accountId).eq('payment_schedule_id', schedule.id).eq('action', 'confirmed').limit(1)
  if (booked?.length || schedule.installments_paid > 0) {
    throw createError({ statusCode: 409, statusMessage: 'A payment has already been recorded from this subscription. End the membership on the patient instead.' })
  }

  const { error } = await admin.from('payment_schedules').delete().eq('id', schedule.id).eq('account_id', accountId)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  // The membership the sync created goes with it: nothing was booked against
  // it. One the desk had recorded before, which the sync only took over,
  // stays as it was.
  if (schedule.patient_membership_id && !schedule.adopted_membership) {
    await admin.from('patient_memberships').delete().eq('id', schedule.patient_membership_id).eq('account_id', accountId)
  }
  return { ok: true }
})

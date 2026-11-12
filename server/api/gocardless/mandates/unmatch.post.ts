import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Undoes a match. Refused while a schedule QuiroFlow runs is collecting on
// the mandate: unmatching would leave money arriving for a patient the
// mandate no longer names. Cancel the membership's direct debit first.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requirePermission(event, 'billing_config')
  const body = await readBody<{ mandateId?: string }>(event)
  if (!body?.mandateId) throw createError({ statusCode: 400, statusMessage: 'mandateId is required' })

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: running } = await admin
    .from('payment_schedules')
    .select('id')
    .eq('account_id', teamMember.account_id)
    .eq('gocardless_mandate_id', body.mandateId)
    .in('status', ['active', 'past_due'])
    .limit(1)
  if (running?.length) {
    throw createError({ statusCode: 409, statusMessage: 'A membership is being collected on this mandate. Stop its direct debit first.' })
  }

  const { error } = await admin.from('patient_gocardless_mandates').delete().eq('account_id', teamMember.account_id).eq('gocardless_mandate_id', body.mandateId)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return { ok: true }
})

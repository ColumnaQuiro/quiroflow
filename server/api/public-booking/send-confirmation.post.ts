import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Anonymous-safe, same reasoning as create-payment-intent.post.ts: the public
// booking widget has no session. Guarded by re-deriving the appointment from
// the account slug and requiring it to have just been created (rather than
// trusting an arbitrary appointmentId), so this can't be used to spam a
// confirmation at an unrelated appointment.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ accountSlug: string; appointmentId: string }>(event)
  if (!body?.accountSlug || !body?.appointmentId) {
    throw createError({ statusCode: 400, statusMessage: 'accountSlug and appointmentId are required' })
  }

  const supabase = serverSupabaseServiceRole<Database>(event)

  const { data: account } = await supabase.from('accounts').select('id').eq('slug', body.accountSlug).maybeSingle()
  if (!account) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const { data: appt } = await supabase
    .from('appointments')
    .select('id, account_id, created_at, source')
    .eq('id', body.appointmentId)
    .maybeSingle()
  const createdRecently = appt ? Date.now() - new Date(appt.created_at).getTime() < 10 * 60 * 1000 : false
  if (!appt || appt.account_id !== account.id || appt.source !== 'online' || !createdRecently) {
    throw createError({ statusCode: 404, statusMessage: 'Appointment not found' })
  }

  await sendAppointmentConfirmation(supabase, account.id, body.appointmentId)

  return { success: true }
})

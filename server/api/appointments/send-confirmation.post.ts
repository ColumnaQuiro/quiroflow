import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
// Fires right after a staff-created appointment (calendar's AppointmentModal /
// NewAppointmentPanel), same fire-and-forget call style as
// fire('appointment.booked', ...) next to it -- a failed confirmation send
// should never undo or block the booking that already succeeded.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ appointmentId: string }>(event)
  if (!body?.appointmentId) {
    throw createError({ statusCode: 400, statusMessage: 'appointmentId is required' })
  }

  const { supabase, teamMember } = await requireTeamMember(event)

  const { data: appt } = await supabase.from('appointments').select('id').eq('id', body.appointmentId).eq('account_id', teamMember.account_id).maybeSingle()
  if (!appt) {
    throw createError({ statusCode: 404, statusMessage: 'Appointment not found' })
  }

  // Service role for the send itself, not the staff-scoped client that
  // authorised it above. Sending now includes push, and device_push_tokens
  // is owned by its user ("users manage own device_push_tokens") -- read
  // through a staff session it returns zero rows, so every push from this
  // path would have silently reached nobody. The cron and public-booking
  // paths already call it this way.
  const serviceSupabase = serverSupabaseServiceRole<Database>(event)
  await sendAppointmentConfirmation(serviceSupabase, teamMember.account_id, body.appointmentId)

  return { success: true }
})

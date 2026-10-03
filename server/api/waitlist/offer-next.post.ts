import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { offerNextWaitlistEntry } from '~/server/utils/waitlistOffer'

// Called right after a staff member cancels an appointment (AppointmentModal.vue),
// same fire-and-forget spirit as the appointment.cancelled automation trigger
// it fires alongside -- a failed waitlist offer shouldn't block or undo the
// cancellation that triggered it.
interface Body { appointmentId: string }

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  if (!body?.appointmentId) throw createError({ statusCode: 400, statusMessage: 'appointmentId is required' })

  const { supabase } = await requireTeamMember(event)

  const { data: appt } = await supabase
    .from('appointments')
    .select('account_id, clinic_id, room_id, practitioner_id, appointment_type_id, starts_at, ends_at, status')
    .eq('id', body.appointmentId)
    .maybeSingle()
  // Only a genuinely cancelled appointment frees a slot worth offering --
  // this endpoint being called at all implies that already happened, but a
  // stale/racing call shouldn't offer a slot that's actually still booked.
  if (!appt || appt.status !== 'cancelled') return { offered: false }

  // The offer itself runs on the service role, as the expiry sweep's does.
  // The slot goes to the oldest matching entry on the clinic's waitlist and
  // is checked free against every booking in the room -- neither of which is
  // the same as what the person who cancelled may read: a practitioner who
  // sees only their own patients and calendar cannot read other patients'
  // waitlist rows (or, before, read them but not the patient to notify), nor
  // a colleague's booking in the same room. Reading the appointment above
  // through their own client is what establishes they may free this slot.
  const service = serverSupabaseServiceRole<Database>(event)
  const origin = getRequestURL(event).origin
  const offered = await offerNextWaitlistEntry(service, origin, {
    accountId: appt.account_id,
    clinicId: appt.clinic_id,
    roomId: appt.room_id,
    practitionerId: appt.practitioner_id,
    appointmentTypeId: appt.appointment_type_id,
    startsAt: appt.starts_at,
    endsAt: appt.ends_at,
  })

  return { offered }
})

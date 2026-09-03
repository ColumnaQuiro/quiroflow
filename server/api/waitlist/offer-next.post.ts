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

  const origin = getRequestURL(event).origin
  const offered = await offerNextWaitlistEntry(supabase, origin, {
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

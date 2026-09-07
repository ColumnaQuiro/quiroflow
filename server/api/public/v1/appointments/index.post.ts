import { ApiError, badRequest, defineApiHandler } from '~/server/utils/publicApi'
import { definedOnly, enumValue, isoDateTime, readApiBody, rejectUnknownFields, str, uuid } from '~/server/utils/publicApiBody'
import { assertBelongsToAccount, loose } from '~/server/utils/publicApiHandlers'
import { APPOINTMENT_STATUSES, assertNoOverlap, resolveWindow } from '~/server/utils/publicApiAppointments'
import { appointmentsResource } from '~/server/utils/publicApiResources'

const FIELDS = [
  'patient_id', 'clinic_id', 'practitioner_id', 'appointment_type_id', 'room_id',
  'starts_at', 'ends_at', 'status', 'note', 'external_reference',
]

export default defineApiHandler({ scope: 'appointments:write' }, async ({ event, supabase, accountId }) => {
  const body = await readApiBody(event)
  rejectUnknownFields(body, FIELDS)

  const patientId = uuid(body, 'patient_id', { required: true })!
  const clinicId = uuid(body, 'clinic_id', { required: true })!
  const practitionerId = uuid(body, 'practitioner_id')
  const appointmentTypeId = uuid(body, 'appointment_type_id')
  const roomId = uuid(body, 'room_id')
  const startsAt = isoDateTime(body, 'starts_at', { required: true })!

  const patient = await assertBelongsToAccount(supabase, 'patients', patientId, accountId, 'patient_id')
  await assertBelongsToAccount(supabase, 'clinics', clinicId, accountId, 'clinic_id')
  if (roomId) await assertBelongsToAccount(supabase, 'calendar_resources', roomId, accountId, 'room_id')

  let practitionerName: string | undefined
  if (practitionerId) {
    const practitioner = await assertBelongsToAccount(supabase, 'team_members', practitionerId, accountId, 'practitioner_id', {
      deleted_at: null,
      is_practitioner: true,
    })
    // appointments.practitioner_name is a snapshot the calendar falls back
    // to, so the appointment still reads sensibly after a practitioner
    // leaves and their row is deactivated.
    practitionerName = practitioner.full_name as string
  }

  // The same guard the WhatsApp endpoint applies before contacting someone.
  // Booking is the point where a do-not-contact patient would start
  // receiving reminders and confirmations again, so it's enforced here too
  // rather than left for the notification to discover.
  if (patient.do_not_contact) {
    throw badRequest('This patient is marked "do not contact" and cannot be booked through the API. Book them in QuiroFlow if this is intended.', 'patient_id')
  }

  const window = await resolveWindow(supabase, accountId, {
    startsAt,
    endsAt: isoDateTime(body, 'ends_at'),
    appointmentTypeId,
    practitionerId,
  })
  await assertNoOverlap(supabase, accountId, practitionerId, window.startsAt, window.endsAt)

  const insert = definedOnly({
    account_id: accountId,
    patient_id: patientId,
    clinic_id: clinicId,
    practitioner_id: practitionerId,
    practitioner_name: practitionerName,
    appointment_type_id: appointmentTypeId,
    room_id: roomId,
    starts_at: window.startsAt,
    ends_at: window.endsAt,
    status: enumValue(body, 'status', APPOINTMENT_STATUSES),
    note: str(body, 'note', { max: 2000 }),
    external_reference: str(body, 'external_reference', { max: 255 }),
    // Not 'online' -- that value specifically means the clinic's own booking
    // page and is what the online-booking reports count. See migration 0149.
    source: 'api',
  })

  const { data: created, error } = await loose(supabase).from('appointments').insert(insert as never).select(appointmentsResource.select).single()
  if (error) throw new ApiError('server_error', error.message)

  setResponseStatus(event, 201)
  return { data: appointmentsResource.serialize(created) }
})

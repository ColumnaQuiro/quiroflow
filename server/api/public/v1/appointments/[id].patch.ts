import { ApiError, defineApiHandler, notFound } from '~/server/utils/publicApi'
import { assertUuid } from '~/server/utils/publicApiQuery'
import { definedOnly, enumValue, isoDateTime, readApiBody, rejectUnknownFields, str, uuid } from '~/server/utils/publicApiBody'
import { assertBelongsToAccount, loose } from '~/server/utils/publicApiHandlers'
import { APPOINTMENT_STATUSES, assertPractitionerWorksAt, assertTypeBookable, resolveWindow, saveAppointmentIfFree } from '~/server/utils/publicApiAppointments'
import { appointmentsResource } from '~/server/utils/publicApiResources'

const FIELDS = ['practitioner_id', 'appointment_type_id', 'room_id', 'starts_at', 'ends_at', 'status', 'note', 'external_reference']

// patient_id and clinic_id aren't patchable: moving an appointment to a
// different patient is almost always a mistake rather than an edit, and
// changing clinic silently invalidates the room. Cancel and rebook instead.
export default defineApiHandler({ scope: 'appointments:write' }, async ({ event, supabase, accountId }) => {
  const id = assertUuid(getRouterParam(event, 'id'), 'id')
  const body = await readApiBody(event)
  rejectUnknownFields(body, FIELDS)

  const { data: existing } = await loose(supabase)
    .from('appointments')
    .select('id, clinic_id, practitioner_id, appointment_type_id, starts_at, ends_at, status')
    .eq('account_id', accountId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!existing) throw notFound('appointment')

  const practitionerId = uuid(body, 'practitioner_id')
  const roomId = uuid(body, 'room_id')
  const appointmentTypeId = uuid(body, 'appointment_type_id')

  let practitionerName: string | undefined
  if (practitionerId) {
    const practitioner = await assertBelongsToAccount(supabase, 'team_members', practitionerId, accountId, 'practitioner_id', {
      deleted_at: null,
      is_practitioner: true,
    })
    practitionerName = practitioner.full_name as string
    // Only a practitioner being given now: one the visit already has keeps it.
    if (practitionerId !== existing.practitioner_id) await assertPractitionerWorksAt(supabase, practitionerId, existing.clinic_id)
  }
  if (roomId) await assertBelongsToAccount(supabase, 'calendar_resources', roomId, accountId, 'room_id')
  // Only a type being given now; keeping the one it has is always allowed.
  if (appointmentTypeId && appointmentTypeId !== existing.appointment_type_id) await assertTypeBookable(supabase, accountId, appointmentTypeId)

  const startsAt = isoDateTime(body, 'starts_at')
  const endsAt = isoDateTime(body, 'ends_at')

  // Only recompute the window if the caller actually touched the timing (or
  // changed the type/practitioner the length is derived from). A PATCH that
  // only sets a note must not quietly re-derive and move the appointment.
  let window: { startsAt: string; endsAt: string } | undefined
  if (startsAt || endsAt || appointmentTypeId) {
    window = await resolveWindow(supabase, accountId, {
      startsAt: startsAt ?? existing.starts_at,
      // Falling back to the stored ends_at only makes sense when the start
      // hasn't moved; otherwise the appointment would keep its old end time
      // and change length. A moved start re-derives from the type instead.
      endsAt: endsAt ?? (startsAt ? undefined : existing.ends_at),
      appointmentTypeId: appointmentTypeId ?? existing.appointment_type_id ?? undefined,
      practitionerId: practitionerId ?? existing.practitioner_id ?? undefined,
    })
  }
  const status = enumValue(body, 'status', APPOINTMENT_STATUSES)

  const patch = definedOnly({
    practitioner_id: practitionerId,
    practitioner_name: practitionerName,
    appointment_type_id: appointmentTypeId,
    room_id: roomId,
    starts_at: window?.startsAt,
    ends_at: window?.endsAt,
    status,
    note: str(body, 'note', { max: 2000 }),
    external_reference: str(body, 'external_reference', { max: 255 }),
    // Flags the appointment as moved, which the calendar's "Hide
    // rescheduled" filter reads -- same as a staff-side drag.
    rescheduled: startsAt ? true : undefined,
  })

  if (Object.keys(patch).length === 0) {
    throw new ApiError('invalid_request', `Nothing to update. Send at least one of: ${FIELDS.join(', ')}.`)
  }

  // Checked against the practitioner and the time the visit will have once
  // this is written. Not only when the time moves: handing a visit to someone
  // busy then, or un-cancelling it onto a slot taken since it was cancelled,
  // puts two appointments in one diary just the same, and both used to go
  // straight in. A visit that stays cancelled holds no time, so giving it a
  // new practitioner needs no check. A PATCH that only sets a note or a
  // reference needs none either.
  const finalStatus = status ?? existing.status
  const practitionerChanged = practitionerId !== undefined && practitionerId !== existing.practitioner_id
  const uncancelled = existing.status === 'cancelled' && finalStatus !== 'cancelled'
  const checkOverlap = window !== undefined || ((practitionerChanged || uncancelled) && finalStatus !== 'cancelled')

  // The check and the update as one step: see saveAppointmentIfFree.
  await saveAppointmentIfFree(supabase, accountId, id, patch, { checkOverlap })
  // An integration moving or cancelling a visit tells its practitioner, as a
  // colleague doing it in the calendar does (staffPush.ts).
  if (finalStatus === 'cancelled' && existing.status !== 'cancelled') await pushAppointmentEvent(supabase, id, 'cancelled')
  else if (window && window.startsAt !== existing.starts_at && finalStatus !== 'cancelled') await pushAppointmentEvent(supabase, id, 'rescheduled')
  const { data: updated, error } = await loose(supabase)
    .from('appointments')
    .select(appointmentsResource.select)
    .eq('account_id', accountId)
    .eq('id', id)
    .single()
  if (error) throw new ApiError('server_error', error.message)

  return { data: appointmentsResource.serialize(updated) }
})

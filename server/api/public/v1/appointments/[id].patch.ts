import { ApiError, defineApiHandler, notFound } from '~/server/utils/publicApi'
import { assertUuid } from '~/server/utils/publicApiQuery'
import { definedOnly, enumValue, isoDateTime, readApiBody, rejectUnknownFields, str, uuid } from '~/server/utils/publicApiBody'
import { assertBelongsToAccount, loose } from '~/server/utils/publicApiHandlers'
import { APPOINTMENT_STATUSES, assertNoOverlap, assertTypeBookable, resolveWindow } from '~/server/utils/publicApiAppointments'
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
    .select('id, practitioner_id, appointment_type_id, starts_at, ends_at')
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
    await assertNoOverlap(supabase, accountId, practitionerId ?? existing.practitioner_id ?? undefined, window.startsAt, window.endsAt, id)
  }

  const patch = definedOnly({
    practitioner_id: practitionerId,
    practitioner_name: practitionerName,
    appointment_type_id: appointmentTypeId,
    room_id: roomId,
    starts_at: window?.startsAt,
    ends_at: window?.endsAt,
    status: enumValue(body, 'status', APPOINTMENT_STATUSES),
    note: str(body, 'note', { max: 2000 }),
    external_reference: str(body, 'external_reference', { max: 255 }),
    // Flags the appointment as moved, which the calendar's "Hide
    // rescheduled" filter reads -- same as a staff-side drag.
    rescheduled: startsAt ? true : undefined,
  })

  if (Object.keys(patch).length === 0) {
    throw new ApiError('invalid_request', `Nothing to update. Send at least one of: ${FIELDS.join(', ')}.`)
  }

  const { data: updated, error } = await loose(supabase)
    .from('appointments')
    .update(patch as never)
    .eq('account_id', accountId)
    .eq('id', id)
    .select(appointmentsResource.select)
    .single()
  if (error) throw new ApiError('server_error', error.message)

  return { data: appointmentsResource.serialize(updated) }
})

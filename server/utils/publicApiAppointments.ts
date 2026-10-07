import { ApiError, badRequest, notFound } from '~/server/utils/publicApi'
import { assertBelongsToAccount } from '~/server/utils/publicApiHandlers'

// Booking rules shared by POST /appointments and PATCH /appointments/{id},
// so a reschedule is held to exactly the same checks as an original booking.
// Both were separate implementations at first and immediately disagreed:
// creating an overlapping appointment was refused, moving one onto a busy
// slot was not.

export const APPOINTMENT_STATUSES = ['booked', 'completed', 'cancelled', 'no_show'] as const

interface WindowInput {
  startsAt: string
  endsAt?: string
  appointmentTypeId?: string
  practitionerId?: string
}

/**
 * The practitioner has to work at the clinic the visit is at (Settings ->
 * Team -> Clinics). GET /availability offers only them, and the booking page
 * only them; the API booked anybody in the account, so an integration could
 * put a visit in a diary at a clinic the practitioner never sets foot in.
 */
export async function assertPractitionerWorksAt(supabase: unknown, practitionerId: string, clinicId: string) {
  const { data, error } = await (supabase as any)
    .from('team_member_clinics')
    .select('team_member_id')
    .eq('team_member_id', practitionerId)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (error) throw new ApiError('server_error', error.message)
  if (!data) throw badRequest(`Practitioner "${practitionerId}" does not work at this clinic. GET /availability lists those who do.`, 'practitioner_id')
}

// An appointment needs a length from somewhere. Callers can be explicit
// (ends_at) or let the appointment type decide -- and the type's length is
// per-practitioner where an override exists, which is the same rule the
// booking page applies, so an API booking lands on the same grid a patient
// would have seen.
/**
 * A type an appointment is being given now: it must be this account's, and
 * not archived. An archived type is hidden from the type list and from
 * /availability, so an integration only has its id from before it was
 * archived. Checked on its own because resolveWindow only reads the type
 * when it needs the length -- with ends_at given, a type from ANOTHER
 * account used to go straight into the insert.
 *
 * Not applied to an appointment keeping the type it already has: moving an
 * existing visit whose type was archived since must still work.
 */
export async function assertTypeBookable(supabase: unknown, accountId: string, appointmentTypeId: string) {
  const type = await assertBelongsToAccount(supabase, 'appointment_types', appointmentTypeId, accountId, 'appointment_type_id')
  if (type.archived_at) {
    throw badRequest(`Appointment type "${type.name}" is archived and can no longer be booked. Reactivate it in QuiroFlow, or use another type.`, 'appointment_type_id')
  }
  return type
}

export async function resolveWindow(
  supabase: unknown,
  accountId: string,
  input: WindowInput,
): Promise<{ startsAt: string; endsAt: string }> {
  const start = new Date(input.startsAt)

  if (input.endsAt) {
    const end = new Date(input.endsAt)
    if (end <= start) throw badRequest('"ends_at" must be after "starts_at".', 'ends_at')
    return { startsAt: start.toISOString(), endsAt: end.toISOString() }
  }

  if (!input.appointmentTypeId) {
    throw badRequest('Provide either "ends_at" or "appointment_type_id" so the appointment has a length.', 'ends_at')
  }

  const type = await assertBelongsToAccount(supabase, 'appointment_types', input.appointmentTypeId, accountId, 'appointment_type_id')
  let duration = type.duration_minutes as number

  if (input.practitionerId) {
    const { data: override } = await (supabase as any)
      .from('appointment_type_overrides')
      .select('duration_minutes')
      .eq('account_id', accountId)
      .eq('appointment_type_id', input.appointmentTypeId)
      .eq('team_member_id', input.practitionerId)
      .maybeSingle()
    if (override?.duration_minutes) duration = override.duration_minutes
  }

  return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + duration * 60000).toISOString() }
}

// Writes an appointment, refusing a double-booking for the same practitioner
// -- the check and the write in one database transaction
// (save_appointment_if_free, 20260930155957), under the per-practitioner lock
// the booking page and the patient app take too. It used to be a PostgREST
// select followed by a separate insert or update, and six parallel calls for
// one slot all passed the select and all booked it.
//
// Cancelled and soft-deleted appointments don't hold a slot -- the calendar
// treats them as free, and an API that disagreed would report a clash on a
// slot the clinic can plainly see is empty. Appointments with no practitioner
// are never checked: they're unassigned, so there's no calendar for them to
// clash on.
//
// `values` are the columns to write, exactly as the insert or update would
// have sent them; a column left out keeps its default (insert) or its value
// (update). `checkOverlap: false` writes without looking, for a PATCH that
// changes nothing about when or with whom the visit is. Returns the id.
export async function saveAppointmentIfFree(
  supabase: unknown,
  accountId: string,
  appointmentId: string | null,
  values: Record<string, unknown>,
  opts: { checkOverlap: boolean },
): Promise<string> {
  const { data, error } = await (supabase as any).rpc('save_appointment_if_free', {
    p_account_id: accountId,
    p_appointment_id: appointmentId,
    p_values: values,
    p_check_overlap: opts.checkOverlap,
  })
  if (error) {
    if (error.message === 'appointment_overlap') {
      let clash: { starts_at?: string; ends_at?: string } = {}
      try {
        clash = JSON.parse(error.details ?? '{}')
      } catch {
        // The refusal stands without the times.
      }
      throw new ApiError(
        'conflict',
        `This practitioner already has an appointment from ${clash.starts_at} to ${clash.ends_at}. Call GET /availability to find a free slot.`,
        'starts_at',
      )
    }
    if (error.message === 'appointment_not_found') throw notFound('appointment')
    throw new ApiError('server_error', error.message)
  }
  return data as string
}

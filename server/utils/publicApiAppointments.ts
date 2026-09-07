import { ApiError, badRequest } from '~/server/utils/publicApi'
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

// An appointment needs a length from somewhere. Callers can be explicit
// (ends_at) or let the appointment type decide -- and the type's length is
// per-practitioner where an override exists, which is the same rule the
// booking page applies, so an API booking lands on the same grid a patient
// would have seen.
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

// Refuses a double-booking for the same practitioner. Cancelled and
// soft-deleted appointments don't hold a slot -- the calendar treats them as
// free, and an API that disagreed would report a clash on a slot the clinic
// can plainly see is empty.
//
// Appointments with no practitioner are skipped entirely: they're
// unassigned, so there's no calendar for them to clash on.
export async function assertNoOverlap(
  supabase: unknown,
  accountId: string,
  practitionerId: string | undefined,
  startsAt: string,
  endsAt: string,
  excludeAppointmentId?: string,
) {
  if (!practitionerId) return

  let query = (supabase as any)
    .from('appointments')
    .select('id, starts_at, ends_at')
    .eq('account_id', accountId)
    .eq('practitioner_id', practitionerId)
    .is('deleted_at', null)
    .neq('status', 'cancelled')
    // Half-open intervals: an appointment ending exactly at 10:00 does not
    // clash with one starting at 10:00, which is how back-to-back bookings
    // are supposed to work.
    .lt('starts_at', endsAt)
    .gt('ends_at', startsAt)

  if (excludeAppointmentId) query = query.neq('id', excludeAppointmentId)

  const { data: clashes } = await query.limit(1)
  if (clashes?.length) {
    throw new ApiError(
      'conflict',
      `This practitioner already has an appointment from ${clashes[0].starts_at} to ${clashes[0].ends_at}. Call GET /availability to find a free slot.`,
      'starts_at',
    )
  }
}

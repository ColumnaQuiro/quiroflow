import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { waitlistSlotIsFree } from '~/server/utils/waitlistOffer'

const SLOT_TAKEN = 'This slot was just taken. Please contact the clinic.'

// Claims an offered waitlist slot -- turns it into a real appointments row.
// No session (same as the GET beside this file); the token is the only
// credential, and every check here is what stands between a stale/replayed
// link and an accidental double-booking.
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')
  if (!token) throw createError({ statusCode: 400, statusMessage: 'Missing token' })

  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data: row } = await supabase
    .from('waitlist_entries')
    .select('id, account_id, clinic_id, patient_id, status, offer_expires_at, offered_room_id, offered_practitioner_id, offered_appointment_type_id, offered_starts_at, offered_ends_at')
    .eq('claim_token', token)
    .maybeSingle()

  if (!row) throw createError({ statusCode: 404, statusMessage: 'This link is invalid.' })
  if (row.status === 'booked') throw createError({ statusCode: 410, statusMessage: 'This appointment has already been claimed.' })
  if (row.status !== 'offered') throw createError({ statusCode: 410, statusMessage: 'This offer is no longer available.' })
  if (row.offer_expires_at && new Date(row.offer_expires_at).getTime() < Date.now()) {
    throw createError({ statusCode: 410, statusMessage: 'This offer has expired.' })
  }

  // The freed slot could have been re-booked or blocked off by staff in the
  // meantime (a manual booking has no idea this offer exists) -- refuse
  // rather than double-book. The practitioner as well as the room: an offer
  // with no room had nothing checked at all, and one with a room missed the
  // practitioner being booked into it somewhere else.
  const startsAt = row.offered_starts_at
  const endsAt = row.offered_ends_at
  if (!startsAt || !endsAt) throw createError({ statusCode: 410, statusMessage: 'This offer is no longer available.' })
  const free = await waitlistSlotIsFree(supabase, {
    accountId: row.account_id,
    clinicId: row.clinic_id,
    roomId: row.offered_room_id,
    practitionerId: row.offered_practitioner_id,
    startsAt,
    endsAt,
  })
  if (!free) throw createError({ statusCode: 409, statusMessage: SLOT_TAKEN })

  // Wins the race against a second concurrent claim on the same link (e.g.
  // opened in two tabs) -- only the request whose update actually matches
  // status='offered' proceeds to create the appointment.
  const { data: claimed } = await supabase
    .from('waitlist_entries')
    .update({ status: 'booked' })
    .eq('id', row.id)
    .eq('status', 'offered')
    .select('id')
    .maybeSingle()
  if (!claimed) throw createError({ statusCode: 409, statusMessage: 'This offer was just claimed by someone else.' })

  // The same question again, asked by the database under the lock every
  // booking path takes for this practitioner, together with the insert -- so
  // a booking landing between the check above and this one is still caught.
  const { data: apptId, error: apptError } = await (supabase as any).rpc('save_appointment_if_free', {
    p_account_id: row.account_id,
    p_appointment_id: null,
    p_values: {
      clinic_id: row.clinic_id,
      patient_id: row.patient_id,
      room_id: row.offered_room_id,
      practitioner_id: row.offered_practitioner_id,
      appointment_type_id: row.offered_appointment_type_id,
      starts_at: startsAt,
      ends_at: endsAt,
      status: 'booked',
      source: 'waitlist',
    },
    p_check_overlap: true,
    p_check_room: true,
    p_check_blocks: true,
  })
  const appt = apptId ? { id: apptId as string } : null

  if (apptError || !appt) {
    // Roll back to 'offered' so a transient failure doesn't strand the
    // entry permanently -- the same link can be retried.
    await supabase.from('waitlist_entries').update({ status: 'offered' }).eq('id', row.id)
    if (['appointment_overlap', 'room_taken', 'slot_blocked'].includes(apptError?.message ?? '')) {
      throw createError({ statusCode: 409, statusMessage: SLOT_TAKEN })
    }
    throw createError({ statusCode: 500, statusMessage: apptError?.message ?? 'Could not book this appointment.' })
  }

  await supabase.from('waitlist_entries').update({ booked_appointment_id: appt.id }).eq('id', row.id)

  return { success: true }
})

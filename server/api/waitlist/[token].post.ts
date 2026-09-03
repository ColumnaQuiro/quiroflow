import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

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

  // The freed slot could have been re-booked by staff in the meantime (a
  // manual booking has no idea this offer exists) -- refuse rather than
  // double-book the room.
  if (row.offered_room_id && row.offered_starts_at && row.offered_ends_at) {
    const { count } = await supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', row.offered_room_id)
      .neq('status', 'cancelled')
      .lt('starts_at', row.offered_ends_at)
      .gt('ends_at', row.offered_starts_at)
    if ((count ?? 0) > 0) throw createError({ statusCode: 409, statusMessage: 'This slot was just taken. Please contact the clinic.' })
  }

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

  const { data: appt, error: apptError } = await supabase
    .from('appointments')
    .insert({
      account_id: row.account_id,
      clinic_id: row.clinic_id,
      patient_id: row.patient_id,
      room_id: row.offered_room_id,
      practitioner_id: row.offered_practitioner_id,
      appointment_type_id: row.offered_appointment_type_id,
      starts_at: row.offered_starts_at!,
      ends_at: row.offered_ends_at!,
      status: 'booked',
      source: 'waitlist',
    })
    .select('id')
    .single()

  if (apptError || !appt) {
    // Roll back to 'offered' so a transient failure doesn't strand the
    // entry permanently -- the same link can be retried.
    await supabase.from('waitlist_entries').update({ status: 'offered' }).eq('id', row.id)
    throw createError({ statusCode: 500, statusMessage: apptError?.message ?? 'Could not book this appointment.' })
  }

  await supabase.from('waitlist_entries').update({ booked_appointment_id: appt.id }).eq('id', row.id)

  return { success: true }
})

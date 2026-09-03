import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Called by the phone that opens the claim link -- no session at all, same
// reasoning as photo-upload/[token].get.ts: the token itself is what gates
// this, checked against the service-role client rather than RLS.
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')
  if (!token) throw createError({ statusCode: 400, statusMessage: 'Missing token' })

  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data: row } = await supabase
    .from('waitlist_entries')
    .select(
      'status, offer_expires_at, offered_starts_at, offered_ends_at, clinics(name), appointment_types:offered_appointment_type_id(name), team_members:offered_practitioner_id(full_name)',
    )
    .eq('claim_token', token)
    .maybeSingle()

  if (!row) throw createError({ statusCode: 404, statusMessage: 'This link is invalid.' })
  if (row.status === 'booked') throw createError({ statusCode: 410, statusMessage: 'This appointment has already been claimed.' })
  if (row.status !== 'offered') throw createError({ statusCode: 410, statusMessage: 'This offer is no longer available.' })
  if (row.offer_expires_at && new Date(row.offer_expires_at).getTime() < Date.now()) {
    throw createError({ statusCode: 410, statusMessage: 'This offer has expired.' })
  }

  return {
    clinicName: row.clinics?.name ?? '',
    appointmentTypeName: row.appointment_types?.name ?? null,
    practitionerName: row.team_members?.full_name ?? null,
    startsAt: row.offered_starts_at,
    endsAt: row.offered_ends_at,
  }
})

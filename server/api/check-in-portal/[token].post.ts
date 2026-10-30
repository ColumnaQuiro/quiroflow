import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { checkInCodeKey, checkInPortalClinic } from '~/server/utils/checkInPortal'
import { verifyCheckInCode } from '~/server/utils/checkInCode'
import { afterPatientArrival } from '~/server/utils/patientArrival'
import { throttlePublic } from '~/server/utils/publicRateLimit'
import { SELF_CHECK_IN_EARLY_MINUTES } from '~/utils/selfCheckIn'
import { birthDateMatches, maskedPortalName, parsePortalBirthDate, pickPortalVisit } from '~/utils/checkInPortal'

// A patient at the front-desk tablet typing their date of birth (DDMMAA), or
// showing it the QR code from their app (server/utils/checkInCode.ts).
// Body { birthDate, appointmentId? } -- the second only once the tablet has
// asked "which of these is you?" -- or { code }, which names one patient and
// so never asks.
//
// Matched against this location's visits that the app's own "Ya estoy aquí"
// would accept -- still booked, from 90 minutes before the start until the
// end -- so the tablet can do nothing a patient's phone could not. Answers:
//   { status: 'not_found' }
//   { status: 'choose', options: [{ appointmentId, name, startsAt }] }
//       names masked ("M••• G."): the waiting room can see the screen
//   { status: 'checked_in' | 'already', firstName, startsAt, practitioner }
//
// The arrival sets checked_in_at, the column the desk's "Mark as arrived" and
// the app set, so the calendar, My Day and the flow tracker show it as any
// other; then the practitioner's push and the clinic's automations
// (afterPatientArrival), only the first time.
export default defineEventHandler(async (event) => {
  // A clinic's busiest hour is a few dozen arrivals from one tablet. Far
  // more than that from one address is someone trying birthdays.
  await throttlePublic(event, { scope: 'check-in-portal', limit: 60, windowSeconds: 600 })

  const body = await readBody<{ birthDate?: string; code?: string; appointmentId?: string }>(event)
  // A code that does not verify is a patient nobody can find, not a bad
  // request: the tablet says "we could not find your appointment" either way.
  let codePatientId: string | null = null
  let typed: ReturnType<typeof parsePortalBirthDate> = null
  if (body?.code !== undefined) {
    const key = checkInCodeKey()
    codePatientId = key ? verifyCheckInCode(key, String(body.code)) : null
    if (!codePatientId) return { status: 'not_found' as const }
  } else {
    typed = parsePortalBirthDate(String(body?.birthDate ?? ''))
    if (!typed) throw createError({ statusCode: 400, statusMessage: 'Invalid date of birth' })
  }

  const service = serverSupabaseServiceRole<Database>(event)
  const clinic = await checkInPortalClinic(service, getRouterParam(event, 'token'))

  const now = Date.now()
  const { data: rows, error } = await service
    .from('appointments')
    .select('id, patient_id, starts_at, checked_in_at, patients!inner(first_name, last_name, date_of_birth, anonymized_at), team_members(full_name)')
    .eq('clinic_id', clinic.id)
    .eq('status', 'booked')
    .is('deleted_at', null)
    .not('patient_id', 'is', null)
    .lte('starts_at', new Date(now + SELF_CHECK_IN_EARLY_MINUTES * 60_000).toISOString())
    .gte('ends_at', new Date(now).toISOString())
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const visits = (rows ?? [])
    .filter((r) => !r.patients.anonymized_at && (codePatientId ? r.patient_id === codePatientId : birthDateMatches(r.patients.date_of_birth, typed!)))
    .map((r) => ({ ...r, patient_id: r.patient_id! }))
  const picked = pickPortalVisit(visits, body?.appointmentId)
  if (picked.kind === 'none') return { status: 'not_found' as const }
  if (picked.kind === 'choose') {
    return {
      status: 'choose' as const,
      options: picked.options.map((v) => ({ appointmentId: v.id, name: maskedPortalName(v.patients.first_name, v.patients.last_name), startsAt: v.starts_at })),
    }
  }

  const visit = picked.visit
  const answer = (status: 'checked_in' | 'already') => ({
    status,
    firstName: visit.patients.first_name ?? '',
    startsAt: visit.starts_at,
    practitioner: visit.team_members?.full_name?.split(' ')[0] ?? null,
  })
  if (visit.checked_in_at) return answer('already')

  // Only if nobody has marked it in the meantime (the desk, or a second tap),
  // so a first arrival is never moved and nobody is told twice.
  const { data: marked, error: markError } = await service
    .from('appointments')
    .update({ checked_in_at: new Date().toISOString() })
    .eq('id', visit.id)
    .eq('status', 'booked')
    .is('checked_in_at', null)
    .select('id')
  if (markError) throw createError({ statusCode: 500, statusMessage: markError.message })
  if (!marked?.length) return answer('already')

  await afterPatientArrival(service, visit.id, getRequestURL(event).origin, 'check-in-portal')
  return answer('checked_in')
})

import { logFamilyAccess } from '~/server/utils/familyAccess'
import { serverSecretKey } from '~/server/utils/serviceSupabase'
import { visitWasAttended } from '~/utils/attendanceCertificate'
import {
  ATTENDANCE_CERTIFICATE_LINK_TTL_MS,
  deriveAttendanceCertificateKey,
  signAttendanceCertificateLink,
} from '~/server/utils/attendanceCertificateLink'

// A patient asking for the justificante de asistencia of one of their own
// visits (Plan › Historial in the app, the portal's past visits), as a link
// they can open.
//
// The patient-side twin of server/api/appointments/[id]/attendance-certificate,
// which is the desk's. Same authorization shape as the patient's invoice and
// calendar links: the read below runs as the patient, so appointments' RLS
// (patients_i_can_act_for -- a visit, not clinical content) decides whether
// the visit exists at all; somebody else's 404s. Only a visit that took place
// has one, by the same rule the desk's button and route follow.
//
// What comes back is a signed link to attendance-certificate.get.ts, which
// builds the PDF when it is opened -- see server/utils/attendanceCertificateLink.ts
// for why that, and not a copy in Storage.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ appointmentId?: string }>(event)
  if (!body?.appointmentId) throw createError({ statusCode: 400, statusMessage: 'appointmentId is required' })

  const { supabase } = await requireAuthedUser(event)
  const { data: appt } = await supabase
    .from('appointments')
    .select('id, patient_id, status, checked_in_at, flow_with_practitioner_at, flow_checkout_at, deleted_at')
    .eq('id', body.appointmentId)
    .maybeSingle()
  if (!appt || !appt.patient_id || appt.deleted_at) throw createError({ statusCode: 404, statusMessage: 'Appointment not found' })
  if (!visitWasAttended(appt)) throw createError({ statusCode: 409, statusMessage: 'Only a visit that took place has a certificate of attendance.' })

  const secret = serverSecretKey()
  if (!secret) throw createError({ statusCode: 503, statusMessage: 'Could not prepare the certificate' })
  const key = deriveAttendanceCertificateKey(secret)
  const expires = Date.now() + ATTENDANCE_CERTIFICATE_LINK_TTL_MS
  const query = new URLSearchParams({ a: appt.id, e: String(expires), s: signAttendanceCertificateLink(key, appt.id, expires) })

  // A parent opening their child's: recorded as any other family read is.
  await logFamilyAccess(supabase as never, appt.patient_id, 'file_downloaded', { document: 'attendance_certificate', appointment_id: appt.id })

  // Absolute: the app's own pages are bundled, so only a full URL leaves it
  // for the system browser (utils/openWhenReady.ts).
  return { url: `${getRequestURL(event).origin}/api/portal/appointments/attendance-certificate?${query}` }
})

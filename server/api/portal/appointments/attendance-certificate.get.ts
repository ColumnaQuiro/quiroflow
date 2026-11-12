import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { serverSecretKey } from '~/server/utils/serviceSupabase'
import { deriveAttendanceCertificateKey, verifyAttendanceCertificateLink } from '~/server/utils/attendanceCertificateLink'

// The justificante behind a link from attendance-certificate-link.post.ts.
//
// Opened in the system browser, which has no session: the signature on the
// link is the authority, and the patient's own read that minted it is where
// access was decided. This only builds the document, with the service role,
// because it needs the clinic's name, address and logo, which a patient
// cannot read. The visit is checked again here -- a link minted a minute
// before the desk cancelled the visit must not still certify it.
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const secret = serverSecretKey()
  const appointmentId = secret ? verifyAttendanceCertificateLink(deriveAttendanceCertificateKey(secret), q.a, q.e, q.s) : null
  if (!appointmentId) throw createError({ statusCode: 403, statusMessage: 'This link has expired. Open the certificate again from the app.' })

  const service = serverSupabaseServiceRole<Database>(event)
  const { data: appt } = await service.from('appointments').select('account_id, starts_at').eq('id', appointmentId).maybeSingle()
  if (!appt) throw createError({ statusCode: 404, statusMessage: 'Appointment not found' })

  const result = await loadAttendanceCertificateData(service, appt.account_id, appointmentId, null)
  if (!result.ok && result.reason === 'not_found') throw createError({ statusCode: 404, statusMessage: 'Appointment not found' })
  if (!result.ok) throw createError({ statusCode: 409, statusMessage: 'Only a visit that took place has a certificate of attendance.' })

  const pdf = await generateAttendanceCertificatePdf(result.data)
  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `attachment; filename="justificante-${appt.starts_at.slice(0, 10)}.pdf"`)
  // The link is a bearer for its five minutes; nothing between should keep the document.
  setHeader(event, 'Cache-Control', 'private, no-store')
  return pdf
})

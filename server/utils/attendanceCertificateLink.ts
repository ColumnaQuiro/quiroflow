import { createHmac, timingSafeEqual } from 'node:crypto'

// The short-lived link a patient opens their justificante de asistencia with
// (server/api/portal/appointments/attendance-certificate-link.post.ts hands it
// out, attendance-certificate.get.ts serves it).
//
// A link rather than the bytes for the reason every patient PDF is one
// (patient-invoices/pdf-link.post.ts): the app is a WKWebView, where a
// download or a blob URL goes nowhere, and only a real URL handed to the
// system browser opens. That browser has no session, so the link carries its
// own authority: the appointment, when it stops working, and an HMAC over
// both. Change the id or push the expiry back and the signature no longer
// matches.
//
// Signed here rather than written to Storage and signed there, as invoices
// are, because the certificate carries the patient's DNI/NIE: a copy in a
// bucket would outlive the moment it was asked for, and anonymising the
// record would not reach it. Each open draws a fresh one from the record.
//
// Pure: the key is a parameter, derived from the deployment's secret key
// (attendanceCertificateLinkKey), so no new environment variable is needed
// and a copy of the database alone cannot mint links.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** How long a link opens the certificate: long enough for a slow phone, not a link worth forwarding. */
export const ATTENDANCE_CERTIFICATE_LINK_TTL_MS = 5 * 60_000

/** The signing key, derived from the deployment's secret so it is never the secret itself. */
export function deriveAttendanceCertificateKey(serverSecret: string): Buffer {
  return createHmac('sha256', serverSecret).update('quiroflow:attendance-certificate-link:v1').digest()
}

function signature(key: Buffer, appointmentId: string, expires: number): string {
  return createHmac('sha256', key).update(`${appointmentId.toLowerCase()}.${expires}`).digest('base64url')
}

export function signAttendanceCertificateLink(key: Buffer, appointmentId: string, expires: number): string {
  return signature(key, appointmentId, expires)
}

/** Whether a link is genuine and still in date; the appointment it names when it is. */
export function verifyAttendanceCertificateLink(
  key: Buffer,
  appointmentId: unknown,
  expires: unknown,
  sig: unknown,
  now = Date.now(),
): string | null {
  if (typeof appointmentId !== 'string' || !UUID.test(appointmentId)) return null
  if (typeof sig !== 'string' || sig.length > 100) return null
  const exp = typeof expires === 'string' ? Number(expires) : NaN
  if (!Number.isSafeInteger(exp) || exp < now) return null
  const want = Buffer.from(signature(key, appointmentId, exp))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  return appointmentId.toLowerCase()
}

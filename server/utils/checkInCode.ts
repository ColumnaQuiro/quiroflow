import { createHmac, timingSafeEqual } from 'node:crypto'

// The QR code a patient shows the front-desk check-in portal from the app or
// the web portal, instead of typing their date of birth.
//
// `qfci.<patient id>.<signature>`: the patient in the clear, and an HMAC over
// it, so a code can be neither made up nor edited to point at someone else --
// the unsubscribe token's design (unsubscribeToken.ts), under its own key.
// It never expires, which is what lets the app show it with no round trip
// once it has it. What it can do is narrow: check that patient in to a visit
// at the portal's own location, from 90 minutes before it until it ends --
// the same thing "Ya estoy aquí" in their own app does.
//
// Pure: the key is a parameter (checkInCodeKey in checkInPortal.ts derives it
// from the server's secret), so a copy of the database alone cannot mint one.

const PREFIX = 'qfci'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SIGNATURE_LENGTH = 32

/** The signing key, derived from the deployment's secret so it is never the secret itself. */
export function deriveCheckInCodeKey(serverSecret: string): Buffer {
  return createHmac('sha256', serverSecret).update('quiroflow:check-in-code:v1').digest()
}

function signature(key: Buffer, patientId: string): string {
  return createHmac('sha256', key).update(patientId).digest('base64url').slice(0, SIGNATURE_LENGTH)
}

export function signCheckInCode(key: Buffer, patientId: string): string {
  const id = patientId.toLowerCase()
  return `${PREFIX}.${id}.${signature(key, id)}`
}

/** The patient a code names, or null when it is malformed or its signature does not match. */
export function verifyCheckInCode(key: Buffer, code: string): string | null {
  if (typeof code !== 'string' || code.length > 100) return null
  const [prefix, id, sig, ...rest] = code.trim().split('.')
  if (rest.length > 0 || prefix !== PREFIX || !id || !sig || !UUID.test(id)) return null
  const expected = Buffer.from(signature(key, id))
  const given = Buffer.from(sig)
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null
}

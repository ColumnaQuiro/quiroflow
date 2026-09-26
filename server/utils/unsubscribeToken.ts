import { createHmac, timingSafeEqual } from 'node:crypto'

// The per-recipient token in a marketing email's unsubscribe link.
//
// `p.<patient id>.<signature>` or `l.<lead id>.<signature>`: the recipient is
// in the clear, and the signature is an HMAC over kind and id, so a token can
// neither be made up nor edited to point at someone else -- change one
// character of the id and the signature no longer matches. It never expires:
// an unsubscribe link in a two-year-old email still has to work (LSSI-CE art.
// 22 wants the opt-out to be simple and free, not time-limited).
//
// Pure: the key is a parameter. The server derives it from its own secret
// (unsubscribeSigningKey below), so no new environment variable is needed and
// a copy of the database alone cannot mint links.

export type UnsubscribeKind = 'patient' | 'lead'

const PREFIX: Record<UnsubscribeKind, string> = { patient: 'p', lead: 'l' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// 192 bits of the SHA-256: far past guessing, and it keeps the URL short.
const SIGNATURE_LENGTH = 32

/** The signing key, derived from the deployment's secret so it is never the secret itself. */
export function deriveUnsubscribeKey(serverSecret: string): Buffer {
  return createHmac('sha256', serverSecret).update('quiroflow:unsubscribe:v1').digest()
}

function signature(key: Buffer, kind: UnsubscribeKind, id: string): string {
  return createHmac('sha256', key).update(`${kind}:${id.toLowerCase()}`).digest('base64url').slice(0, SIGNATURE_LENGTH)
}

export function signUnsubscribeToken(key: Buffer, kind: UnsubscribeKind, id: string): string {
  return `${PREFIX[kind]}.${id.toLowerCase()}.${signature(key, kind, id)}`
}

/** Who a token unsubscribes, or null when it is malformed or its signature does not match. */
export function verifyUnsubscribeToken(key: Buffer, token: string): { kind: UnsubscribeKind; id: string } | null {
  if (typeof token !== 'string' || token.length > 100) return null
  const [prefix, id, sig, ...rest] = token.split('.')
  if (rest.length > 0 || !prefix || !id || !sig) return null
  const kind = (Object.keys(PREFIX) as UnsubscribeKind[]).find((k) => PREFIX[k] === prefix)
  if (!kind || !UUID.test(id)) return null
  const expected = Buffer.from(signature(key, kind, id))
  const given = Buffer.from(sig)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  return { kind, id: id.toLowerCase() }
}

import { createHmac, timingSafeEqual } from 'node:crypto'

// Proving an inbound Resend delivery event is genuine.
//
// The endpoint is unauthenticated by nature -- Resend has no account with us
// and cannot hold a token -- so the signature IS the authentication. Without
// it, anyone who learns the URL can post whatever they like and the campaign
// metrics become whatever they say: a competitor's bounce rate, or an open
// count that flatters a campaign nobody read. Metrics are not money, but a
// number nobody can trust is worse than no number, because it gets acted on.
//
// Resend signs with Svix. The scheme is HMAC-SHA256 over
// `${id}.${timestamp}.${body}`, keyed by the webhook secret with its `whsec_`
// prefix stripped and the remainder base64-decoded. Implemented here rather
// than pulling in the svix package: it is twenty lines, and the package brings
// a dependency tree for one digest.
//
// Two details that are easy to get wrong and silent when wrong:
//
//   - The digest is over the RAW BYTES. Reading the body as JSON and
//     re-stringifying changes whitespace and unicode escaping, and one byte is
//     enough. readRawBody, never readBody.
//   - `svix-signature` can carry SEVERAL space-separated signatures, each
//     prefixed with a version -- that is how Svix rotates a secret without
//     dropping events mid-rotation. Matching only the first would reject
//     everything signed with the new key during the overlap.

const TOLERANCE_SECONDS = 5 * 60

export interface SvixHeaders {
  id: string | undefined
  timestamp: string | undefined
  signature: string | undefined
}

export type VerifyResult = { ok: true } | { ok: false; reason: string }

export function verifyResendSignature(rawBody: Buffer, headers: SvixHeaders, secret: string): VerifyResult {
  if (!secret) return { ok: false, reason: 'no webhook secret configured' }
  const { id, timestamp, signature } = headers
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing svix headers' }

  // Replay window. Without it a captured request stays valid forever, and a
  // recording of one genuine bounce can be posted back a thousand times.
  const sentAt = Number(timestamp)
  if (!Number.isFinite(sentAt)) return { ok: false, reason: 'unparseable timestamp' }
  const driftSeconds = Math.abs(Date.now() / 1000 - sentAt)
  if (driftSeconds > TOLERANCE_SECONDS) return { ok: false, reason: 'timestamp outside tolerance' }

  let key: Buffer
  try {
    key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  } catch {
    return { ok: false, reason: 'webhook secret is not base64' }
  }

  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.`).update(rawBody).digest()

  // "v1,<base64> v1,<base64>" -- every one is a candidate.
  for (const candidate of signature.split(' ')) {
    const [version, value] = candidate.split(',')
    if (version !== 'v1' || !value) continue
    let provided: Buffer
    try {
      provided = Buffer.from(value, 'base64')
    } catch {
      continue
    }
    // Length is checked first because timingSafeEqual THROWS on a mismatch
    // rather than returning false, which would turn a malformed header into a
    // 500 and, worse, into a retry storm.
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) return { ok: true }
  }

  return { ok: false, reason: 'no matching signature' }
}

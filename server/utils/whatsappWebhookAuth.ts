import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { H3Event } from 'h3'
import type { Database } from '~/types/database.types'

// Proving that an inbound WhatsApp webhook is genuine, which it previously did
// not do at all. Two paths, because the clinics run two different setups and a
// single mechanism cannot cover both:
//
//  1. Meta posts straight to us. Meta signs the request, so we verify the
//     signature against that clinic's Meta App Secret.
//
//  2. Meta posts to n8n (or Zapier, or a clinic's own backend), which forwards
//     the payload on to us. Meta's signature CANNOT be relied on here: it is an
//     HMAC over the exact request bytes, and a forwarding hop re-serialises the
//     JSON -- n8n's Webhook node parses it to an object and the HTTP Request
//     node writes it back out. Whitespace, whether an accented character is
//     sent literally or as a backslash-u escape, and number formatting are all
//     free to change, and one byte is enough to break the digest. Even the
//     header itself is usually dropped, since HTTP
//     Request nodes do not pass incoming headers through by default. So the
//     forwarder authenticates as itself, with a QuiroFlow API token carrying
//     the whatsapp:webhook scope.
//
// The token path is the stronger of the two: the account comes from the token,
// so a forwarder cannot act for a clinic other than its own. On the signature
// path the account still has to be located from the body's phone_number_id
// before there is any secret to verify against -- but locating is not
// trusting, and nothing is acted on until the signature checks out.

export const WHATSAPP_WEBHOOK_SCOPE = 'whatsapp:webhook'

const SIGNATURE_HEADER = 'x-hub-signature-256'
const SIGNATURE_PREFIX = 'sha256='

/**
 * True when `signatureHeader` is Meta's HMAC-SHA256 of exactly these bytes
 * under `appSecret`. Takes the raw Buffer, never a re-encoded string: the
 * digest is over bytes, so a parse-and-stringify round trip invalidates it.
 */
export function signatureMatches(rawBody: Buffer, signatureHeader: string | undefined, appSecret: string): boolean {
  if (!signatureHeader || !appSecret) return false
  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) return false

  const provided = signatureHeader.slice(SIGNATURE_PREFIX.length).trim().toLowerCase()
  // Checked before decoding so timingSafeEqual is always given two buffers of
  // the same length -- it throws rather than returning false when they differ,
  // which would turn a malformed header into a 500.
  if (!/^[0-9a-f]{64}$/.test(provided)) return false

  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex')
  return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'))
}

export type WebhookAuth =
  /** A forwarder authenticated with its own token; only this account may be touched. */
  | { kind: 'token'; accountId: string }
  /** Signed by Meta, but which clinic it is for can only be told per-change. */
  | { kind: 'signature'; signatureHeader: string }

/**
 * Establishes how this request is claiming to be genuine, before any of its
 * content is believed. Returns null when it presents no proof at all, which
 * the caller should answer with a 401 -- the request is anonymous and there is
 * nothing to check it against.
 *
 * A token that is missing the scope, revoked or unknown throws (401/403) via
 * requireApiToken: presenting a broken credential is a different thing from
 * presenting none, and worth a distinct answer.
 */
export async function resolveWebhookAuth(event: H3Event): Promise<WebhookAuth | null> {
  const authorization = getHeader(event, 'authorization') ?? ''
  if (authorization.startsWith('Bearer ')) {
    const { accountId, scopes } = await requireApiToken(event)
    requireScope(scopes, WHATSAPP_WEBHOOK_SCOPE)
    return { kind: 'token', accountId }
  }

  const signatureHeader = getHeader(event, SIGNATURE_HEADER)
  if (signatureHeader) return { kind: 'signature', signatureHeader }

  return null
}

/**
 * Whether this request is allowed to act on `accountId`.
 *
 * On the signature path this is where the actual verification happens, once
 * the account -- and therefore the secret -- is known. A clinic with no app
 * secret stored can never pass: that is the fail-closed half of this change,
 * and the reason Settings > WhatsApp shows whether one is configured.
 */
export async function webhookMayActOnAccount(
  auth: WebhookAuth,
  accountId: string,
  rawBody: Buffer,
  supabase: SupabaseClient<Database>,
): Promise<boolean> {
  if (auth.kind === 'token') return auth.accountId === accountId

  const { data } = await supabase.from('whatsapp_app_secrets').select('app_secret').eq('account_id', accountId).maybeSingle()
  if (!data?.app_secret) return false

  return signatureMatches(rawBody, auth.signatureHeader, data.app_secret)
}

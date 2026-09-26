import { deriveUnsubscribeKey, signUnsubscribeToken, verifyUnsubscribeToken, type UnsubscribeKind } from '~/server/utils/unsubscribeToken'
import { serverSecretKey } from '~/server/utils/serviceSupabase'

// Unsubscribing from a clinic's marketing email: the link in the footer of
// every email an is_marketing rule sends, the List-Unsubscribe header beside
// it, and what following either one does. See server/utils/unsubscribeToken.ts
// for the token and server/api/unsubscribe/ for the endpoints.

/** The key tokens are signed with, or null on a deployment with no secret key. */
export function unsubscribeSigningKey(): Buffer | null {
  const secret = serverSecretKey()
  return secret ? deriveUnsubscribeKey(secret) : null
}

/**
 * The two addresses for one recipient: the page a person opens from the
 * footer, and the endpoint a mail client POSTs to for one-click unsubscribe
 * (RFC 8058). Null when no key is configured -- a link that could not be
 * verified would be worse than none.
 */
export function unsubscribeLinks(origin: string, kind: UnsubscribeKind, id: string): { page: string; oneClick: string } | null {
  const key = unsubscribeSigningKey()
  if (!key) return null
  const token = signUnsubscribeToken(key, kind, id)
  const base = origin.replace(/\/+$/, '')
  return { page: `${base}/unsubscribe/${token}`, oneClick: `${base}/api/unsubscribe/${token}` }
}

export function readUnsubscribeToken(token: string) {
  const key = unsubscribeSigningKey()
  return key ? verifyUnsubscribeToken(key, token) : null
}

interface Recipient {
  kind: UnsubscribeKind
  id: string
  accountId: string
  /** Whether marketing email currently reaches them. */
  subscribed: boolean
}

/** Who a verified token names, as the database has them now; null when they no longer exist. */
export async function unsubscribeRecipient(service: any, kind: UnsubscribeKind, id: string): Promise<Recipient | null> {
  if (kind === 'patient') {
    const { data } = await service.from('patients').select('id, account_id, marketing_channels').eq('id', id).maybeSingle()
    if (!data) return null
    return { kind, id, accountId: data.account_id, subscribed: (data.marketing_channels ?? []).includes('email') }
  }
  const { data } = await service.from('leads').select('id, account_id, marketing_consent_at').eq('id', id).maybeSingle()
  if (!data) return null
  return { kind, id, accountId: data.account_id, subscribed: Boolean(data.marketing_consent_at) }
}

/**
 * Takes them off marketing email. Idempotent: a second call finds nothing to
 * change and says so.
 *
 * A patient loses 'email' from marketing_channels and keeps any other channel
 * they opted in to -- the link is in an email, so it answers for email. A lead
 * has one consent for every channel (marketing_consent_at), so theirs is
 * cleared; the drip's consent gate then stops marketing on WhatsApp too,
 * which is the safe reading of "stop sending me this".
 */
export async function unsubscribe(service: any, recipient: Recipient): Promise<{ changed: boolean }> {
  if (!recipient.subscribed) return { changed: false }
  if (recipient.kind === 'patient') {
    const { data } = await service.from('patients').select('marketing_channels').eq('id', recipient.id).maybeSingle()
    const channels: string[] = data?.marketing_channels ?? []
    const { error } = await service
      .from('patients')
      .update({ marketing_channels: channels.filter((c) => c !== 'email') })
      .eq('id', recipient.id)
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    return { changed: true }
  }
  const { error } = await service.from('leads').update({ marketing_consent_at: null, marketing_consent_source: null }).eq('id', recipient.id)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  await service.from('lead_events').insert({
    account_id: recipient.accountId,
    lead_id: recipient.id,
    kind: 'note',
    title: 'Unsubscribed from marketing',
    detail: 'Followed the unsubscribe link in a marketing email.',
  })
  return { changed: true }
}

/** The clinic's name for the page: the account's first active clinic. */
export async function unsubscribeClinicName(service: any, accountId: string): Promise<string | null> {
  const { data } = await service.from('clinics').select('name').eq('account_id', accountId).is('archived_at', null).order('created_at').limit(1).maybeSingle()
  return data?.name ?? null
}

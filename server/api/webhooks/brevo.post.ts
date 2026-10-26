import { timingSafeEqual } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { automationEvent } from '~/server/utils/automationEngine'
import { brevoMessageKey } from '~/server/utils/resend'

// Delivery events for the emails that went out through Brevo, the fallback
// provider in server/utils/resend.ts. The Resend webhook beside this one
// cannot see them: different provider, different id. Each Brevo event is
// translated to the Resend event name it corresponds to and recorded through
// the same record_email_event RPC, so email_messages and the campaign metrics
// read the same whichever provider carried the email.
//
// Register it in Brevo under Transactional -> Settings -> Webhook, with the
// events delivered, opened, click, hard_bounce, spam, blocked, invalid_email
// and error, pointing at
//   https://app.quiroflow.com/api/webhooks/brevo
// and Bearer authentication set to NUXT_BREVO_WEBHOOK_SECRET. (Basic auth or
// "?token=<secret>" on the URL work too, for setups that cannot send a header.)
//
// Brevo does not sign its webhooks, so that shared secret is the only
// authentication. Unset, everything is refused -- the same stance as the
// Resend endpoint: unverified metrics are worse than none.
//
// Otherwise the contract matches the Resend endpoint: anything Brevo cannot
// fix by retrying (an event we ignore, an id we never sent) answers 200, and
// only a database failure asks for a retry.

// unique_opened is deliberately absent: Brevo sends it alongside the first
// "opened", and counting both would double every first open. soft_bounce is
// absent too: Brevo keeps retrying a soft bounce and it often delivers in the
// end, so stamping bounced_at on it would mark a good address as dead.
const EVENT_MAP: Record<string, string> = {
  delivered: 'email.delivered',
  opened: 'email.opened',
  click: 'email.clicked',
  hard_bounce: 'email.bounced',
  spam: 'email.complained',
  blocked: 'email.failed',
  invalid_email: 'email.failed',
  error: 'email.failed',
}

function secretMatches(given: string | undefined | null, expected: string): boolean {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function presentedSecret(authorization: string | undefined, token: unknown): string | null {
  if (typeof token === 'string' && token) return token
  if (!authorization) return null
  const [scheme, value] = authorization.split(' ', 2)
  if (!value) return null
  if (scheme.toLowerCase() === 'bearer') return value.trim()
  if (scheme.toLowerCase() === 'basic') {
    // Brevo's basic auth: the secret is accepted as the password, any user.
    const decoded = Buffer.from(value.trim(), 'base64').toString('utf8')
    const colon = decoded.indexOf(':')
    return colon >= 0 ? decoded.slice(colon + 1) : decoded
  }
  return null
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const expected = (config.brevoWebhookSecret as string | undefined) ?? ''
  const given = presentedSecret(getHeader(event, 'authorization'), getQuery(event).token)
  if (!expected || !secretMatches(given, expected)) {
    // The reason is not returned to an unauthenticated caller.
    console.warn(`[brevo-webhook] rejected: ${expected ? 'bad or missing secret' : 'NUXT_BREVO_WEBHOOK_SECRET is not set'}`)
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  let payload: Record<string, any>
  try {
    payload = (await readBody(event)) ?? {}
  } catch {
    return { ignored: 'unparseable' }
  }

  const brevoEvent = typeof payload.event === 'string' ? payload.event : ''
  const type = EVENT_MAP[brevoEvent]
  if (!type) return { ignored: brevoEvent || 'no event' }

  const rawId: unknown = payload['message-id']
  if (typeof rawId !== 'string' || !rawId) return { ignored: 'no message id' }
  const messageId = brevoMessageKey(rawId)

  const tsSeconds = Number(payload.ts_event ?? payload.ts)
  const occurredAt = Number.isFinite(tsSeconds) && tsSeconds > 0 ? new Date(tsSeconds * 1000).toISOString() : new Date().toISOString()

  // Same vocabulary the Resend endpoint stores, so the screen reading
  // bounce_kind and failure_reason needs no idea which provider it was.
  const detail: string | null =
    type === 'email.bounced' ? 'Permanent' : type === 'email.failed' ? (payload.reason ?? brevoEvent) : null

  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data: matched, error } = await supabase.rpc('record_email_event', {
    p_provider_message_id: messageId,
    p_event: type,
    p_occurred_at: occurredAt,
    p_detail: detail,
  })

  if (error) {
    console.error(`[brevo-webhook] ${brevoEvent} for ${messageId}: ${error.message}`)
    throw createError({ statusCode: 500, statusMessage: 'Could not record the event' })
  }

  // An open or a click is what "wait until the email is opened / clicked"
  // waits for, exactly as with Resend.
  if (matched === true && (type === 'email.opened' || type === 'email.clicked')) {
    const { data: email } = await supabase
      .from('email_messages')
      .select('account_id, patient_id, lead_id')
      .eq('provider_message_id', messageId)
      .maybeSingle()
    if (email && (email.patient_id || email.lead_id)) {
      await automationEvent(supabase, email.account_id, { patientId: email.patient_id, leadId: email.lead_id }, type, getRequestURL(event).origin)
    }
  }

  return { recorded: matched === true, type }
})

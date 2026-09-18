import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { verifyResendSignature } from '~/server/utils/resendWebhookAuth'

// Delivery events from Resend: delivered, opened, clicked, bounced,
// complained, failed. Register this URL once in the Resend dashboard under
// Webhooks, and put the signing secret it gives you in NUXT_RESEND_WEBHOOK_SECRET.
//
// Two things shape everything below.
//
// The signature is the only authentication. Resend has no account here and
// cannot hold a token, so an unverified request is anonymous by definition --
// see server/utils/resendWebhookAuth.ts. The raw bytes go to the verifier
// before anything is parsed, because the digest covers the bytes and
// re-serialising JSON invalidates it.
//
// And almost everything answers 200. A webhook endpoint that returns an error
// gets retried, then retried harder, and eventually disabled by the provider
// -- at which point the metrics quietly stop updating and nobody finds out for
// weeks. So a bad signature is a 401 (that one must be refused and is worth a
// retry never succeeding), and everything else -- an event type we do not
// handle, an id we have never seen, a payload missing a field -- is accepted
// and ignored. Those are not conditions Resend can fix by trying again.
const HANDLED = new Set([
  'email.delivered',
  'email.opened',
  'email.clicked',
  'email.bounced',
  'email.complained',
  'email.failed',
])

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const rawBody = await readRawBody(event, false)
  if (!rawBody) throw createError({ statusCode: 400, statusMessage: 'Missing body' })

  const verified = verifyResendSignature(
    rawBody,
    {
      id: getHeader(event, 'svix-id'),
      timestamp: getHeader(event, 'svix-timestamp'),
      signature: getHeader(event, 'svix-signature'),
    },
    config.resendWebhookSecret as string,
  )
  if (!verified.ok) {
    // The reason is logged, never returned: telling an unauthenticated caller
    // whether it was the timestamp or the digest that let them down is free
    // help for the next attempt.
    console.warn(`[resend-webhook] rejected: ${verified.reason}`)
    throw createError({ statusCode: 401, statusMessage: 'Invalid signature' })
  }

  let payload: { type?: string; created_at?: string; data?: Record<string, any> }
  try {
    payload = JSON.parse(rawBody.toString('utf8'))
  } catch {
    return { ignored: 'unparseable' }
  }

  const type = payload.type ?? ''
  if (!HANDLED.has(type)) return { ignored: type || 'no type' }

  const messageId: string | undefined = payload.data?.email_id ?? payload.data?.id
  if (!messageId) return { ignored: 'no email id' }

  // A bounce says whether the address is dead (hard) or the mailbox was
  // temporarily unhappy (soft); a failure says why Resend gave up. Both end up
  // in front of a human deciding whether to chase the patient for a new email
  // address, so the distinction is worth carrying.
  const detail: string | null =
    type === 'email.bounced'
      ? (payload.data?.bounce?.type ?? payload.data?.type ?? null)
      : type === 'email.failed'
        ? (payload.data?.failed?.reason ?? payload.data?.reason ?? null)
        : null

  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data: matched, error } = await supabase.rpc('record_email_event', {
    p_provider_message_id: messageId,
    p_event: type,
    p_occurred_at: payload.created_at ?? new Date().toISOString(),
    p_detail: detail,
  })

  if (error) {
    // A real database failure IS worth a retry, so this one is not swallowed.
    console.error(`[resend-webhook] ${type} for ${messageId}: ${error.message}`)
    throw createError({ statusCode: 500, statusMessage: 'Could not record the event' })
  }

  // matched === false means no row with that id: an email sent before this
  // table existed, or from another environment sharing the Resend account.
  // Accepted and counted as handled -- retrying will never find it.
  return { recorded: matched === true, type }
})

// Every email QuiroFlow sends goes through deliverEmail(). Resend is the
// primary provider. Brevo is the fallback for when Resend refuses with 429:
// the free plan stops at 100 emails a day, and a Monday with a weekly recall
// campaign plus the day's appointment reminders reached it on 26 Oct 2026,
// after which nothing went out -- confirmations and reminders included --
// until the next day. Brevo's free plan allows 300 a day, so the two together
// give ~400 without paying for either.
//
// The fallback is inert until NUXT_BREVO_API_KEY is set. It must be a Brevo
// account of QuiroFlow's own (hola@quiroflow.com) with quiroflow.com
// authenticated there, or Brevo refuses the sender.
//
// Delivery events (opens, clicks, bounces) only arrive for Resend sends: the
// webhook in server/api/webhooks/resend.post.ts matches on Resend's id. A
// Brevo send is recorded with a "brevo:" id so it is counted as sent and is
// never mistaken for a Resend message.
import { alertOps, writePlatformStatus } from './opsAlert'

export interface ResendAttachment {
  filename: string
  content: string // base64
}

export interface OutgoingEmail {
  to: string
  subject: string
  html: string
  attachments?: ResendAttachment[]
  headers?: Record<string, string>
}

export class EmailSendError extends Error {
  constructor(message: string, readonly provider: 'resend' | 'brevo', options?: { cause?: unknown }) {
    super(message, options)
  }
}

const FROM_NAME = 'QuiroFlow'
const FROM_EMAIL = 'notifications@quiroflow.com'

async function sendViaResend(apiKey: string, email: OutgoingEmail): Promise<{ ok: true; id: string | null } | { ok: false; status: number; detail: string }> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: email.to,
      subject: email.subject,
      html: email.html,
      ...(email.attachments ? { attachments: email.attachments } : {}),
      ...(email.headers ? { headers: email.headers } : {}),
    }),
  })
  await recordResendQuota(response)
  if (!response.ok) {
    const text = await response.text()
    // Resend answers a refusal with {name, message}; the status alone says
    // nothing a person can act on.
    let detail = text
    try {
      const body = JSON.parse(text) as { message?: string; name?: string }
      detail = body.message || body.name || text
    } catch {
      // Not JSON: the raw text is the most useful thing to show.
    }
    return { ok: false, status: response.status, detail }
  }
  // The mail has already gone by here, so a body that will not parse must not
  // turn a successful send into a failure.
  try {
    const body = (await response.json()) as { id?: string }
    return { ok: true, id: body?.id ?? null }
  } catch {
    return { ok: true, id: null }
  }
}

// Resend reports what has been used, not what is left, and only on its own
// responses: x-resend-daily-quota (sent to free-plan accounts only, whose cap
// is 100 a day) and x-resend-monthly-quota. Recorded from every send so the
// admin panel can show where the month stands without an API of its own.
// Neither header carries the limit, so it is inferred: a daily header means
// the free plan, 100 a day and 3,000 a month.
const RESEND_FREE_DAILY = 100
const RESEND_FREE_MONTHLY = 3000

async function recordResendQuota(response: Response) {
  try {
    const daily = Number.parseInt(response.headers.get('x-resend-daily-quota') ?? '', 10)
    const monthly = Number.parseInt(response.headers.get('x-resend-monthly-quota') ?? '', 10)
    if (!Number.isFinite(daily) && !Number.isFinite(monthly)) return
    const freePlan = Number.isFinite(daily)
    await writePlatformStatus('resend.quota', {
      observed_at: new Date().toISOString(),
      daily_used: Number.isFinite(daily) ? daily : null,
      monthly_used: Number.isFinite(monthly) ? monthly : null,
      daily_limit: freePlan ? RESEND_FREE_DAILY : null,
      monthly_limit: freePlan ? RESEND_FREE_MONTHLY : null,
    })
    if (freePlan && Number.isFinite(monthly) && monthly >= RESEND_FREE_MONTHLY * 0.8) {
      await alertOps(
        'resend-monthly-80',
        `Resend: ${monthly} of ${RESEND_FREE_MONTHLY} emails used this month`,
        [
          `QuiroFlow has sent ${monthly} of the ${RESEND_FREE_MONTHLY} emails Resend's free plan allows this month.`,
          'Past the limit Resend refuses everything until the month turns over, and only the Brevo fallback (if configured) keeps email going.',
        ],
        72,
      )
    }
  } catch (e: any) {
    console.error('[email] could not record the Resend quota', e?.message ?? e)
  }
}

/**
 * How a Brevo message is keyed in email_messages.provider_message_id. The send
 * API returns the id wrapped in angle brackets ("<…@smtp-relay.mailin.fr>")
 * and the webhook may or may not, so both sides strip them here and the
 * "brevo:" prefix keeps it from ever colliding with a Resend id.
 */
export function brevoMessageKey(messageId: string): string {
  return `brevo:${messageId.trim().replace(/^</, '').replace(/>$/, '')}`
}

async function sendViaBrevo(apiKey: string, senderEmail: string, email: OutgoingEmail): Promise<{ id: string | null }> {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: FROM_NAME, email: senderEmail },
      to: [{ email: email.to }],
      subject: email.subject,
      htmlContent: email.html,
      ...(email.attachments ? { attachment: email.attachments.map((a) => ({ name: a.filename, content: a.content })) } : {}),
      ...(email.headers ? { headers: email.headers } : {}),
    }),
  })
  if (!response.ok) {
    const text = await response.text()
    let detail = text
    try {
      detail = (JSON.parse(text) as { message?: string }).message || text
    } catch {
      // Not JSON: the raw text is the most useful thing to show.
    }
    throw new EmailSendError(`Brevo rejected the email: ${detail}`, 'brevo')
  }
  try {
    const body = (await response.json()) as { messageId?: string }
    return { id: body?.messageId ? brevoMessageKey(body.messageId) : null }
  } catch {
    return { id: null }
  }
}

/**
 * Sends one email, falling back to Brevo when Resend answers 429 (daily or
 * monthly quota, or its per-second rate limit) and a Brevo key is configured.
 * Any other Resend refusal is NOT retried elsewhere: an unverified domain or a
 * suppressed address would fail the same way on Brevo, and hiding it behind a
 * second provider only makes it harder to see. Throws EmailSendError.
 */
export async function deliverEmail(email: OutgoingEmail): Promise<{ id: string | null; provider: 'resend' | 'brevo' }> {
  const config = useRuntimeConfig()
  const brevoKey = config.brevoApiKey as string | undefined
  const brevoSender = (config.brevoSenderEmail as string | undefined) || FROM_EMAIL

  if (!config.resendApiKey) {
    if (brevoKey) return { ...(await sendViaBrevo(brevoKey, brevoSender, email)), provider: 'brevo' }
    throw new EmailSendError('Email sending is not configured (missing RESEND_API_KEY)', 'resend')
  }

  const first = await sendViaResend(config.resendApiKey, email)
  if (first.ok) return { id: first.id, provider: 'resend' }

  if (first.status === 429) {
    await alertOps(
      'resend-quota',
      brevoKey ? 'Resend refused an email on quota: Brevo is sending instead' : 'Resend refused an email on quota and there is no fallback',
      [
        `Resend answered 429: ${first.detail}`,
        brevoKey
          ? 'Emails are going out through Brevo (300 a day on its free plan) until Resend\'s quota resets.'
          : 'Nothing is going out by email -- confirmations and reminders included -- until the quota resets. Set NUXT_BREVO_API_KEY for a fallback, or move Resend to a paid plan.',
        'The admin panel\'s Platform page shows what is left.',
      ],
      12,
    )
  }
  if (first.status === 429 && brevoKey) {
    console.warn(`[email] Resend refused with 429 (${first.detail}); sending through Brevo instead`)
    return { ...(await sendViaBrevo(brevoKey, brevoSender, email)), provider: 'brevo' }
  }
  throw new EmailSendError(`Resend rejected the email: ${first.detail}`, 'resend')
}

/**
 * Returns the provider's id for the message, so a caller can record it in
 * email_messages and have the delivery webhook find the row again. Callers
 * that only care whether it threw can keep ignoring the return.
 */
export async function sendResendEmail(options: { to: string; subject: string; html: string; attachments?: ResendAttachment[] }): Promise<{ id: string | null }> {
  try {
    const { id } = await deliverEmail(options)
    return { id }
  } catch (e: any) {
    const missingConfig = /not configured/.test(e?.message ?? '')
    throw createError({ statusCode: missingConfig ? 500 : 502, statusMessage: e?.message ?? 'Email error' })
  }
}

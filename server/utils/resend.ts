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
    return { id: body?.messageId ? `brevo:${body.messageId}` : null }
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

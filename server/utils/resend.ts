// Shared by every endpoint that emails a patient a document (invoice,
// statement, appointment history) -- previously each one duplicated this
// fetch call inline. runAutomationActions.ts's marketing/automation emails
// are deliberately left on their own inline call: that pipeline treats a
// failed send as a soft no-op (fire-and-forget, never blocks the rest of an
// automation run), which is a different contract than this helper's
// throw-on-failure behavior that the direct "send this document now" actions
// below all want.
export interface ResendAttachment {
  filename: string
  content: string // base64
}

export async function sendResendEmail(options: { to: string; subject: string; html: string; attachments?: ResendAttachment[] }): Promise<void> {
  const config = useRuntimeConfig()
  if (!config.resendApiKey) {
    throw createError({ statusCode: 500, statusMessage: 'Email sending is not configured (missing RESEND_API_KEY)' })
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'QuiroFlow <notifications@quiroflow.com>',
      to: options.to,
      subject: options.subject,
      html: options.html,
      ...(options.attachments ? { attachments: options.attachments } : {}),
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw createError({ statusCode: 502, statusMessage: `Resend error: ${body}` })
  }
}

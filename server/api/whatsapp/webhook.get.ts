// Meta's one-time verification handshake when you register this URL as the
// webhook callback in the Meta App dashboard (WhatsApp > Configuration).
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN

  if (verifyToken && query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === verifyToken) {
    return query['hub.challenge']
  }

  throw createError({ statusCode: 403, statusMessage: 'Verification failed' })
})

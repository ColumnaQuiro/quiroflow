// What registering a push token answers when the database refuses the write.
//
// A password-only (aal1) session whose person owes a second factor is refused
// by the restrictive "two factor when required" policy on every table
// (20260923174910_two_factor_login.sql). That is the policy doing its job, so
// it answers 403 like any other refusal -- not the 500 that made Sentry count
// it as a server fault (JAVASCRIPT-NUXT-7). Anything else stays a 500.
export function pushTokenFailure(message: string): { statusCode: number; statusMessage: string } {
  if (message.includes('two factor when required')) {
    return { statusCode: 403, statusMessage: 'Two-factor verification is required before registering this device' }
  }
  return { statusCode: 500, statusMessage: message }
}

// Whether an FCM v1 send failure says the token is gone for good: the app was
// uninstalled, or the user turned notifications off on iOS (APNs 410). FCM's
// answer is 404 with errorCode UNREGISTERED, and Google's guidance is to
// delete the token -- it will never work again, and the app registers a fresh
// one (register-push-token.post.ts) the next time it is opened.
//
// Until this was checked, a dead token was kept and retried on every push, so
// each inbound WhatsApp message to a clinic with one logged "[push] send
// failed" to Sentry for ever (JAVASCRIPT-NUXT-1A, 39 events in a day).
export function isUnregisteredPushToken(error: unknown): boolean {
  const body = (error as { error?: { status?: unknown; details?: unknown } } | null)?.error
  if (!body || typeof body !== 'object') return false
  const details = Array.isArray(body.details) ? body.details : []
  return details.some((d) => (d as { errorCode?: unknown } | null)?.errorCode === 'UNREGISTERED')
}

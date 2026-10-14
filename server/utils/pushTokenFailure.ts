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

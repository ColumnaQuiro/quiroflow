import { randomBytes } from 'node:crypto'

// Kicks off GoCardless partner OAuth, the same shape as Stripe's
// (stripe/connect/start.get.ts): a single-use state cookie guards against
// someone else's authorisation code being linked to this clinic, then the
// clinic is sent to GoCardless's own screen to sign in to -- or create -- the
// GoCardless account its patients' mandates live in.
export default defineEventHandler(async (event) => {
  await requireSettingsPermission(event, 'billing_config')
  setHeader(event, 'Cache-Control', 'no-store')

  if (!gocardlessConfigured()) {
    throw createError({ statusCode: 500, statusMessage: 'GoCardless is not configured on this deployment' })
  }

  const state = randomBytes(24).toString('hex')
  // A first-time GoCardless signup (business and bank details) can run long;
  // still single-use, and deleted on the callback whatever the outcome.
  setCookie(event, 'gocardless_connect_state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 3600, path: '/' })

  const query = getQuery(event)
  const authorize = new URL(`${gocardlessHosts().connect}/oauth/authorize`)
  authorize.searchParams.set('response_type', 'code')
  authorize.searchParams.set('client_id', useRuntimeConfig().gocardlessClientId as string)
  authorize.searchParams.set('scope', 'read_write')
  authorize.searchParams.set('redirect_uri', `${getRequestURL(event).origin}/api/gocardless/connect/callback`)
  authorize.searchParams.set('state', state)
  // A clinic coming from PracticeHub already has an account: show sign-in,
  // not sign-up, unless the page asked for the other.
  authorize.searchParams.set('initial_view', query.signup === '1' ? 'signup' : 'login')
  authorize.searchParams.set('language', 'es')

  return sendRedirect(event, authorize.toString())
})

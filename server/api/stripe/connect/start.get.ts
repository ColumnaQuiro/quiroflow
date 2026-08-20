import { randomBytes } from 'node:crypto'

// Kicks off Standard Connect OAuth: a signed, single-use state cookie guards
// against CSRF (someone else's authorization code being linked to this
// clinic), then redirects to Stripe's own authorize screen.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'billing_config')

  setHeader(event, 'Cache-Control', 'no-store')

  const config = useRuntimeConfig()
  if (!config.public.stripeConnectClientId) {
    throw createError({ statusCode: 500, statusMessage: 'Stripe Connect is not configured on this deployment' })
  }

  const state = randomBytes(24).toString('hex')
  // A first-time Standard onboarding (business details, etc.) can easily run
  // past 10 minutes, so this needs real headroom -- it's still single-use
  // and deleted on the callback regardless of outcome.
  setCookie(event, 'stripe_connect_state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 3600, path: '/' })

  const redirectUri = `${getRequestURL(event).origin}/api/stripe/oauth/callback`
  const authorizeUrl = new URL('https://connect.stripe.com/oauth/authorize')
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('client_id', config.public.stripeConnectClientId)
  authorizeUrl.searchParams.set('scope', 'read_write')
  authorizeUrl.searchParams.set('redirect_uri', redirectUri)
  authorizeUrl.searchParams.set('state', state)

  return sendRedirect(event, authorizeUrl.toString())
})

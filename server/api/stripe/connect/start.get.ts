import { randomBytes } from 'node:crypto'
import { serverSupabaseClient } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Kicks off Standard Connect OAuth: a signed, single-use state cookie guards
// against CSRF (someone else's authorization code being linked to this
// clinic), then redirects to Stripe's own authorize screen.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient<Database>(event)
  const { data: teamMember } = await supabase.from('team_members').select('id').maybeSingle()
  if (!teamMember) {
    throw createError({ statusCode: 403, statusMessage: 'Not signed in as a team member' })
  }

  const config = useRuntimeConfig()
  if (!config.public.stripeConnectClientId) {
    throw createError({ statusCode: 500, statusMessage: 'Stripe Connect is not configured on this deployment' })
  }

  const state = randomBytes(24).toString('hex')
  setCookie(event, 'stripe_connect_state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' })

  const redirectUri = `${getRequestURL(event).origin}/api/stripe/oauth/callback`
  const authorizeUrl = new URL('https://connect.stripe.com/oauth/authorize')
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('client_id', config.public.stripeConnectClientId)
  authorizeUrl.searchParams.set('scope', 'read_write')
  authorizeUrl.searchParams.set('redirect_uri', redirectUri)
  authorizeUrl.searchParams.set('state', state)

  return sendRedirect(event, authorizeUrl.toString())
})

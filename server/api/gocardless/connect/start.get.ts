import { randomBytes } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Kicks off GoCardless partner OAuth, the same shape as Stripe's
// (stripe/connect/start.get.ts): a single-use state cookie guards against
// someone else's authorisation code being linked to this clinic, then the
// clinic is sent to GoCardless's own screen to sign in to -- or create -- the
// GoCardless account its patients' mandates live in.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireSettingsPermission(event, 'billing_config')
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

  // What GoCardless's sign-up form would otherwise ask again: the person
  // connecting and their clinic. Only filled where we know it; GoCardless
  // ignores the prefill on its sign-in screen. Every clinic here is Spanish.
  const admin = serverSupabaseServiceRole<Database>(event)
  const [{ data: member }, { data: account }, { data: auth }] = await Promise.all([
    admin.from('team_members').select('full_name').eq('id', teamMember.id).maybeSingle(),
    admin.from('accounts').select('name').eq('id', teamMember.account_id).maybeSingle(),
    supabase.auth.getUser(),
  ])
  const [givenName, ...familyName] = (member?.full_name ?? '').trim().split(/\s+/)
  const prefill: Record<string, string | undefined> = {
    email: auth?.user?.email ?? undefined,
    given_name: givenName || undefined,
    family_name: familyName.join(' ') || undefined,
    organisation_name: account?.name?.trim() || undefined,
    country_code: 'ES',
  }
  for (const [key, value] of Object.entries(prefill)) if (value) authorize.searchParams.set(`prefill[${key}]`, value)

  return sendRedirect(event, authorize.toString())
})

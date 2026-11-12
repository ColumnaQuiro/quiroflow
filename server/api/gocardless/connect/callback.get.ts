import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// GoCardless sends the clinic back here after it authorises (or declines).
// The account to link comes from the signed-in session, never from `state`,
// which is only the CSRF nonce set in start.get.ts.
//
// One GoCardless organisation belongs to one clinic here: the webhook finds
// the clinic by organisation id, so two clinics sharing one would book each
// other's money. accounts.gocardless_organisation_id is unique, and a second
// clinic connecting the same organisation is refused by name.
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const expectedState = getCookie(event, 'gocardless_connect_state')
  deleteCookie(event, 'gocardless_connect_state', { path: '/' })
  const back = (params: Record<string, string>) => sendRedirect(event, `/settings/payments?${new URLSearchParams(params)}`)

  if (query.error) return back({ gocardless_error: String(query.error_description ?? query.error) })
  if (!query.state || !expectedState || query.state !== expectedState) {
    return back({ gocardless_error: 'Could not verify this request. Please try connecting again.' })
  }
  if (typeof query.code !== 'string') return back({ gocardless_error: 'GoCardless did not return an authorisation code.' })

  let teamMember: { account_id: string }
  try {
    ;({ teamMember } = await requireSettingsPermission(event, 'billing_config'))
  } catch {
    return back({ gocardless_error: 'You were signed out during the connection. Please log in and try again.' })
  }

  const config = useRuntimeConfig()
  const { connect, environment } = gocardlessHosts()
  let token: { access_token: string; organisation_id: string }
  try {
    const response = await fetch(`${connect}/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: query.code,
        redirect_uri: `${getRequestURL(event).origin}/api/gocardless/connect/callback`,
        client_id: config.gocardlessClientId as string,
        client_secret: config.gocardlessClientSecret as string,
      }),
    })
    const json = await response.json().catch(() => ({}))
    if (!response.ok || !json?.access_token || !json?.organisation_id) {
      return back({ gocardless_error: json?.error_description ?? json?.error ?? 'GoCardless refused the connection.' })
    }
    token = json
  } catch (err: any) {
    return back({ gocardless_error: err?.message ?? 'Could not complete the GoCardless connection.' })
  }

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: other } = await admin
    .from('accounts')
    .select('id')
    .eq('gocardless_organisation_id', token.organisation_id)
    .neq('id', teamMember.account_id)
    .maybeSingle()
  if (other) {
    return back({ gocardless_error: 'This GoCardless account is already connected to another clinic in QuiroFlow.' })
  }

  // Unverified accounts cannot collect. Read now so the page can say so;
  // a failure here is not a failed connection.
  let verification: string | null = null
  try {
    const creditors = await gocardlessRequester(token.access_token)('GET', '/creditors', { query: { limit: 1 } })
    verification = creditors?.creditors?.[0]?.verification_status ?? null
  } catch (err) {
    console.error('[gocardless connect] could not read verification status', (err as Error).message)
  }

  await setAccountSecret(admin, teamMember.account_id, 'gocardless_access_token', token.access_token)
  // Read back: a page that says "connected" when the write was refused is
  // the bug Stripe's callback once had.
  const { data: saved, error } = await admin
    .from('accounts')
    .update({
      gocardless_organisation_id: token.organisation_id,
      gocardless_environment: environment,
      gocardless_verification_status: verification,
      gocardless_connected_at: new Date().toISOString(),
    })
    .eq('id', teamMember.account_id)
    .select('id')
  if (error || !saved?.length) {
    return back({ gocardless_error: error?.message ?? 'GoCardless connected, but QuiroFlow could not save it. Please try again.' })
  }

  // The method payments collected this way are recorded under.
  await admin.from('payment_methods').update({ is_active: true }).eq('account_id', teamMember.account_id).eq('key', 'direct_debit')

  return back({ gocardless: 'connected' })
})

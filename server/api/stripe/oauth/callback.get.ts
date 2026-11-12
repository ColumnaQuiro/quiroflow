import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeForPlatform } from '~/server/utils/stripe'

// Stripe redirects here after the clinic authorizes (or declines) on their
// own Connect screen. The account to link is resolved from the logged-in
// session, not from `state` -- `state` is only the CSRF nonce set in
// connect/start.get.ts.
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const expectedState = getCookie(event, 'stripe_connect_state')
  deleteCookie(event, 'stripe_connect_state', { path: '/' })

  const redirectTo = (params: Record<string, string>) => sendRedirect(event, `/settings/payments?${new URLSearchParams(params)}`)

  if (query.error) {
    return redirectTo({ stripe_error: String(query.error_description ?? query.error) })
  }
  if (!query.state || !expectedState || query.state !== expectedState) {
    return redirectTo({ stripe_error: 'Could not verify this request. Please try connecting again.' })
  }
  if (typeof query.code !== 'string') {
    return redirectTo({ stripe_error: 'Stripe did not return an authorization code.' })
  }

  // The same gate connect/start.get.ts applied before sending them to Stripe.
  // Checked again here because this is where the write happens, and the write
  // is the service role's: stripe_connect_account_id is refused to every
  // signed-in user (accounts_guard_server_written), since the only proof of
  // which Stripe account a clinic owns is the code Stripe just returned.
  let accountId: string
  try {
    const { teamMember } = await requireSettingsPermission(event, 'billing_config')
    accountId = teamMember.account_id
  } catch (err: any) {
    const signedOut = err?.statusCode === 403 && /Not signed in/.test(err?.statusMessage ?? '')
    return redirectTo({
      stripe_error: signedOut
        ? 'You were signed out during the connection. Please log in and try again.'
        : (err?.statusMessage ?? 'You do not have permission to connect Stripe.'),
    })
  }

  try {
    const platform = await stripeForPlatform()
    const response = await platform.oauth.token({ grant_type: 'authorization_code', code: query.code })

    // Read back: the page said "connected" even when this was refused.
    const admin = serverSupabaseServiceRole<Database>(event)
    const { data: saved, error: saveError } = await admin
      .from('accounts')
      .update({
        stripe_connect_account_id: response.stripe_user_id,
        stripe_publishable_key: response.stripe_publishable_key ?? null,
      })
      .eq('id', accountId)
      .select('id')
    if (saveError?.code === '23505') {
      return redirectTo({ stripe_error: 'That Stripe account is already connected to another QuiroFlow account. Disconnect it there first.' })
    }
    if (saveError || !saved?.length) {
      return redirectTo({ stripe_error: saveError?.message ?? 'Stripe connected, but QuiroFlow could not save it. Please try again.' })
    }
  } catch (err: any) {
    return redirectTo({ stripe_error: err?.message ?? 'Could not complete the Stripe connection.' })
  }

  return redirectTo({ stripe_connected: '1' })
})

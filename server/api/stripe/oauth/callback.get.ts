import { serverSupabaseClient } from '#supabase/server'
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

  const supabase = await serverSupabaseClient<Database>(event)
  const { data: teamMember } = await supabase.from('team_members').select('id, account_id').maybeSingle()
  if (!teamMember) {
    return redirectTo({ stripe_error: 'You were signed out during the connection. Please log in and try again.' })
  }

  try {
    const platform = stripeForPlatform()
    const response = await platform.oauth.token({ grant_type: 'authorization_code', code: query.code })

    await supabase
      .from('accounts')
      .update({
        stripe_connect_account_id: response.stripe_user_id,
        stripe_publishable_key: response.stripe_publishable_key ?? null,
      })
      .eq('id', teamMember.account_id)
  } catch (err: any) {
    return redirectTo({ stripe_error: err?.message ?? 'Could not complete the Stripe connection.' })
  }

  return redirectTo({ stripe_connected: '1' })
})

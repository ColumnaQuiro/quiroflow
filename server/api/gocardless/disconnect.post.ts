import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Disconnecting GoCardless on Settings > Payments: the authorisation is
// revoked at GoCardless first, then our record cleared -- the lesson of
// Stripe's disconnect, which once only forgot the account and stayed
// authorised on it.
//
// This revokes QuiroFlow's ACCESS. It cancels no mandate and no
// subscription: those are the clinic's, in its own GoCardless account, and a
// cancelled mandate is the one thing that would make patients sign again.
// Subscriptions QuiroFlow created keep collecting in GoCardless; the page
// says so before the clinic confirms.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'billing_config')
  const admin = serverSupabaseServiceRole<Database>(event)
  const token = await getAccountSecret(admin, teamMember.account_id, 'gocardless_access_token')

  if (token && gocardlessConfigured()) {
    const config = useRuntimeConfig()
    // GoCardless answers 200 with no body whether or not the token was live,
    // so there is nothing to tell apart: a token already revoked from the
    // clinic's dashboard is as gone as one revoked here.
    const response = await fetch(`${gocardlessHosts().connect}/oauth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.gocardlessClientId as string, client_secret: config.gocardlessClientSecret as string, token }),
    }).catch((err: Error) => ({ ok: false, status: 0, statusText: err.message }) as Response)
    if (!response.ok) {
      throw createError({ statusCode: 502, statusMessage: `GoCardless did not confirm the disconnection (${response.status || response.statusText})` })
    }
  }

  await forgetGoCardlessConnection(admin, teamMember.account_id)
  return { ok: true }
})

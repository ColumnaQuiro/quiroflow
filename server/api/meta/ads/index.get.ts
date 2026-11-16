import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { getAccountSecret } from '~/server/utils/accountSecrets'
import { metaErrorMessage } from '~/server/utils/metaLeadAds'

// The Meta Ads connection as the Leads settings card shows it: which ad
// account, whether the stored token can still read it, and when Meta will
// stop accepting it. Never the token.
//
// The name and currency come from Meta, live, rather than from a column:
// they are only shown here, and asking is also the cheapest way to find out
// that a token has stopped working before the Growth dashboard does.
//
// The expiry comes from debug_token. The connection is a user token (see
// metaAdsConfigId in nuxt.config.ts), good for 60 days, and Meta offers no
// way to renew one without the person signing in again -- so the card says
// by when, rather than letting spend quietly stop being read.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')
  const admin = serverSupabaseServiceRole<Database>(event)

  const [{ data: account }, token] = await Promise.all([
    admin.from('accounts').select('meta_ads_account_id').eq('id', teamMember.account_id).maybeSingle(),
    getAccountSecret(admin, teamMember.account_id, 'meta_ads_access_token'),
  ])
  const adAccountId = account?.meta_ads_account_id?.trim() || null
  const empty = { adAccountId, hasToken: Boolean(token), name: null, currency: null, expiresAt: null as string | null, error: null }
  if (!adAccountId || !token) return empty

  const config = useRuntimeConfig()
  const GRAPH = config.metaGraphBaseUrl
  const actId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`
  const [info, expiresAt] = await Promise.all([
    $fetch<{ name?: string; currency?: string }>(`${GRAPH}/${actId}`, { query: { fields: 'name,currency', access_token: token } }).then(
      (r) => ({ ok: true as const, r }),
      (err) => ({ ok: false as const, err }),
    ),
    tokenExpiry(GRAPH, token, config.public.metaPlatformAppId, config.metaPlatformAppSecret),
  ])
  if (!info.ok) return { ...empty, expiresAt, error: metaErrorMessage(info.err) }
  return { ...empty, name: info.r.name ?? null, currency: info.r.currency ?? null, expiresAt }
})

/** When Meta stops accepting the token, as ISO; null when it never expires or Meta does not say. */
async function tokenExpiry(graph: string, token: string, appId: string, appSecret: string): Promise<string | null> {
  if (!appId || !appSecret) return null
  try {
    const debug = await $fetch<{ data?: { expires_at?: number; data_access_expires_at?: number } }>(`${graph}/debug_token`, {
      query: { input_token: token, access_token: `${appId}|${appSecret}` },
    })
    // Whichever comes first: the token itself, or Meta's 90-day data-access
    // window, after which the token still exists but reads nothing.
    const stamps = [debug.data?.expires_at, debug.data?.data_access_expires_at].filter((s): s is number => typeof s === 'number' && s > 0)
    return stamps.length ? new Date(Math.min(...stamps) * 1000).toISOString() : null
  } catch {
    return null
  }
}

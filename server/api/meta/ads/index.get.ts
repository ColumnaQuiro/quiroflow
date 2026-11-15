import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { getAccountSecret } from '~/server/utils/accountSecrets'
import { metaErrorMessage } from '~/server/utils/metaLeadAds'

// The Meta Ads connection as the Leads settings card shows it: which ad
// account, and whether the stored token can still read it. Never the token.
//
// The name and currency come from Meta, live, rather than from a column:
// they are only shown here, and asking is also the cheapest way to find out
// that a token has stopped working before the Growth dashboard does.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')
  const admin = serverSupabaseServiceRole<Database>(event)

  const [{ data: account }, token] = await Promise.all([
    admin.from('accounts').select('meta_ads_account_id').eq('id', teamMember.account_id).maybeSingle(),
    getAccountSecret(admin, teamMember.account_id, 'meta_ads_access_token'),
  ])
  const adAccountId = account?.meta_ads_account_id?.trim() || null
  if (!adAccountId || !token) return { adAccountId, hasToken: Boolean(token), name: null, currency: null, error: null }

  const actId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`
  try {
    const info = await $fetch<{ name?: string; currency?: string }>(`${useRuntimeConfig().metaGraphBaseUrl}/${actId}`, {
      query: { fields: 'name,currency', access_token: token },
    })
    return { adAccountId, hasToken: true, name: info.name ?? null, currency: info.currency ?? null, error: null }
  } catch (err) {
    return { adAccountId, hasToken: true, name: null, currency: null, error: metaErrorMessage(err) }
  }
})

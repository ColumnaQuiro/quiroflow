import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { getAccountSecret } from '~/server/utils/accountSecrets'

// Which messaging tokens are stored, for Settings > WhatsApp. Never the values:
// they live in account_secrets and are only used server-side.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')
  const admin = serverSupabaseServiceRole<Database>(event)
  const [whatsapp, instagram, metaAds] = await Promise.all([
    getAccountSecret(admin, teamMember.account_id, 'whatsapp_access_token'),
    getAccountSecret(admin, teamMember.account_id, 'instagram_access_token'),
    getAccountSecret(admin, teamMember.account_id, 'meta_ads_access_token'),
  ])
  return { whatsapp: Boolean(whatsapp), instagram: Boolean(instagram), metaAds: Boolean(metaAds) }
})

import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { setAccountSecret } from '~/server/utils/accountSecrets'

// Saves the WhatsApp, Instagram and Meta Ads access tokens typed into Settings
// > WhatsApp. Write-only: a field left empty keeps the token already stored.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')
  const body = await readBody<{ whatsapp?: string; instagram?: string; metaAds?: string }>(event)
  const admin = serverSupabaseServiceRole<Database>(event)
  const pairs = [
    ['whatsapp_access_token', body?.whatsapp],
    ['instagram_access_token', body?.instagram],
    ['meta_ads_access_token', body?.metaAds],
  ] as const
  for (const [name, value] of pairs) {
    const token = (value ?? '').trim()
    if (token) await setAccountSecret(admin, teamMember.account_id, name, token)
  }
  return { ok: true }
})

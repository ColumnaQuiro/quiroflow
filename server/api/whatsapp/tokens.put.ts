import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { setAccountSecret } from '~/server/utils/accountSecrets'

// Saves a token typed in by hand: WhatsApp's (Settings > WhatsApp, for a
// clinic on its own Meta app) and Meta Ads' (Settings > Leads, the
// use-your-own-token fallback). Write-only: a field left empty keeps the
// token already stored.
//
// Not Instagram's any more. Its token is the Page token the Connect button
// stores; a pasted one from a clinic's own app could not reply to the public
// anyway, because that needs the app itself to pass Meta's review.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')
  const body = await readBody<{ whatsapp?: string; metaAds?: string }>(event)
  const admin = serverSupabaseServiceRole<Database>(event)
  const pairs = [
    ['whatsapp_access_token', body?.whatsapp],
    ['meta_ads_access_token', body?.metaAds],
  ] as const
  for (const [name, value] of pairs) {
    const token = (value ?? '').trim()
    if (token) await setAccountSecret(admin, teamMember.account_id, name, token)
  }
  return { ok: true }
})

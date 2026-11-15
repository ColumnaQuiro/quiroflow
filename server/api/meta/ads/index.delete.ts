import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { deleteAccountSecret } from '~/server/utils/accountSecrets'

// Disconnects Meta Ads: forgets the ad account and its token. Spend already
// read stays in channel_spend -- it was true when it was read, and the
// dashboard's history should not change because a token was removed.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')
  const admin = serverSupabaseServiceRole<Database>(event)
  await deleteAccountSecret(admin, teamMember.account_id, 'meta_ads_access_token')
  const { error } = await admin.from('accounts').update({ meta_ads_account_id: null }).eq('id', teamMember.account_id)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return { ok: true }
})

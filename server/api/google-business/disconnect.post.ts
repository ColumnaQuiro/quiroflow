import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Forgets the Google connection. Reviews already imported stay: they are the
// clinic's record of what was said and answered.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')
  const service = serverSupabaseServiceRole<Database>(event)
  await service.from('account_secrets').delete().eq('account_id', teamMember.account_id).eq('name', 'google_business_refresh_token')
  await service
    .from('accounts')
    .update({ google_business_account: null, google_business_location: null, google_business_location_title: null, google_reviews_synced_at: null })
    .eq('id', teamMember.account_id)
  return { ok: true }
})

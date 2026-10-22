import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { getAccountSecret } from '~/server/utils/accountSecrets'

// The saved PracticeHub connection, minus its key. The key lives in
// account_secrets and never comes back to the browser: the importers reach
// PracticeHub through practicehub-proxy, which adds it server-side.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')
  const admin = serverSupabaseServiceRole<Database>(event)
  const { data } = await admin.from('accounts').select('practicehub_base_url, practicehub_contact_email').eq('id', teamMember.account_id).maybeSingle()
  const [key, v3Key] = await Promise.all([
    getAccountSecret(admin, teamMember.account_id, 'practicehub_api_key'),
    getAccountSecret(admin, teamMember.account_id, 'practicehub_v3_api_key'),
  ])
  return { baseUrl: data?.practicehub_base_url ?? null, contactEmail: data?.practicehub_contact_email ?? null, hasKey: Boolean(key), hasV3Key: Boolean(v3Key) }
})

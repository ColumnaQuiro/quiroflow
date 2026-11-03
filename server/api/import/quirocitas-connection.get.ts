import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { getAccountSecret } from '~/server/utils/accountSecrets'

// The saved Quirocitas connection, minus its password, which never comes back
// to the browser: the importer reaches Quirocitas through /api/import/quirocitas.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')
  const admin = serverSupabaseServiceRole<Database>(event)
  const [baseUrl, username, password] = await Promise.all([
    getAccountSecret(admin, teamMember.account_id, 'quirocitas_base_url'),
    getAccountSecret(admin, teamMember.account_id, 'quirocitas_username'),
    getAccountSecret(admin, teamMember.account_id, 'quirocitas_password'),
  ])
  return { baseUrl, username, hasPassword: Boolean(password) }
})

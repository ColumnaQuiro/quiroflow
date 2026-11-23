import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { getAccountSecret } from '~/server/utils/accountSecrets'

// The saved QuiroHiro connection, minus its token, which never comes back to
// the browser: only the import job reads it, on the server.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')
  const admin = serverSupabaseServiceRole<Database>(event)
  const [token, locationId, locationName] = await Promise.all([
    getAccountSecret(admin, teamMember.account_id, 'quirohiro_token'),
    getAccountSecret(admin, teamMember.account_id, 'quirohiro_location_id'),
    getAccountSecret(admin, teamMember.account_id, 'quirohiro_location_name'),
  ])
  return { locationId, locationName, hasToken: Boolean(token) }
})

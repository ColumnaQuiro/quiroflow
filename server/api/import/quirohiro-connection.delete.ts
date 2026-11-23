import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { dropQuirohiroSnapshot } from '~/server/utils/quirohiroImportJob'

// Forgets the saved QuiroHiro connection and the copy read with it. What was
// already imported stays. The token itself is revoked in QuiroHiro, by deleting
// the Private Integration there.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')
  const admin = serverSupabaseServiceRole<Database>(event)
  const { error } = await admin
    .from('account_secrets')
    .delete()
    .eq('account_id', teamMember.account_id)
    .in('name', ['quirohiro_token', 'quirohiro_location_id', 'quirohiro_location_name'])
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  await dropQuirohiroSnapshot(admin, teamMember.account_id)
  return { ok: true }
})

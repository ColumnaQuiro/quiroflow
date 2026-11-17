import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { forgetQuirocitasCopy } from '~/server/utils/quirocitasSnapshotStore'

// "Delete the copy" on the Read step: the records read from Quirocitas, kept
// on the server for the import steps. Nothing already imported changes.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')
  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: running } = await admin.from('import_jobs').select('id').eq('account_id', teamMember.account_id).in('status', ['queued', 'running']).limit(1)
  if (running?.length) throw createError({ statusCode: 409, statusMessage: 'An import is running: stop it first.' })
  await forgetQuirocitasCopy(admin, teamMember.account_id)
  return { ok: true }
})

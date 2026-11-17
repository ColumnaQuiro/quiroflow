import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { startImportSlice } from '~/server/utils/importJobs'

// Asks a running import to stop. The slice working on it finishes what it is
// writing first (at most about half a minute), then the job ends as
// cancelled; what was imported until then stays.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')
  const id = getRouterParam(event, 'id') ?? ''
  const admin = serverSupabaseServiceRole<Database>(event)
  const { data, error } = await admin
    .from('import_jobs')
    .update({ cancel_requested: true })
    .eq('id', id)
    .eq('account_id', teamMember.account_id)
    .in('status', ['queued', 'running'])
    .select('id')
    .maybeSingle()
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!data) throw createError({ statusCode: 404, statusMessage: 'No running import' })
  await startImportSlice(getRequestURL(event).origin, id)
  return { ok: true }
})

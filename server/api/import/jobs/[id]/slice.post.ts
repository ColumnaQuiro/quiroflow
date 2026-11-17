import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { runImportSlice, startImportSlice } from '~/server/utils/importJobs'

// One slice of an import job, then the hand-off to the next. Called only by
// the server itself -- a previous slice, the start route, import-jobs-cron --
// with the cron secret, never by a browser.
export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  if (!runtimeConfig.cronSecret || getHeader(event, 'x-cron-secret') !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  const id = getRouterParam(event, 'id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw createError({ statusCode: 400, statusMessage: 'id' })

  // The writes are the person's who started the job, in the audit trail as
  // everywhere else (server/utils/auditActor.ts), not "QuiroFlow (automatic)".
  const plain = serverSupabaseServiceRole<Database>(event)
  const { data: job } = await plain.from('import_jobs').select('started_by').eq('id', id).maybeSingle()
  if (!job) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (job.started_by) {
    delete event.context._supabaseServiceRole
    attachAuditActor(event, job.started_by)
  }
  const admin = serverSupabaseServiceRole<Database>(event)

  const outcome = await runImportSlice(admin, id)
  if (outcome.more) await startImportSlice(getRequestURL(event).origin, id)
  return outcome
})

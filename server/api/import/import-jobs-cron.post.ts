import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { notifyImportJobFinished, startImportSlice } from '~/server/utils/importJobs'

// Keeps server-side imports moving (server/utils/importJobs.ts). Every minute.
//
// Each slice of a job starts the next one itself, so this normally finds
// nothing to do. It is here for the hand-off that never arrived: a function
// frozen before its request went out, a deploy in between. Any job nobody
// holds gets its next slice started, so a lost hand-off costs a minute, not
// the import.
//
// It also deletes copies read from Quirocitas that nobody has read again for
// 30 days (import_snapshots holds patient data, and once a clinic has moved
// over there is no reason to keep it), and sends any finished-job email a
// slice died before sending.
const MAX_JOBS_PER_TICK = 20
const STALE_COPY_DAYS = 30
/** About 20 hours of slices: far past any real clinic, and a stop to a job going round in circles. */
const MAX_SLICES = 2000

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  if (!runtimeConfig.cronSecret || getHeader(event, 'x-cron-secret') !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  const admin = serverSupabaseServiceRole<Database>(event)
  const now = new Date().toISOString()

  const { data: jobs, error } = await admin
    .from('import_jobs')
    .select('id, slices')
    .in('status', ['queued', 'running'])
    .or(`locked_until.is.null,locked_until.lt.${now}`)
    .order('created_at')
    .limit(MAX_JOBS_PER_TICK)
  // Surfaced, never swallowed: a failed read must not look like a quiet tick.
  if (error) throw createError({ statusCode: 500, statusMessage: `import-jobs-cron: ${error.message}` })

  const origin = getRequestURL(event).origin
  const started: string[] = []
  const given_up: string[] = []
  for (const job of jobs ?? []) {
    if (job.slices >= MAX_SLICES) {
      await admin.from('import_jobs').update({ status: 'failed', error: 'Stopped after too many slices.', finished_at: now }).eq('id', job.id)
      await notifyImportJobFinished(admin, job.id).catch((e) => console.error(`[import-jobs-cron] ${job.id} finished email:`, e))
      given_up.push(job.id)
      continue
    }
    await startImportSlice(origin, job.id)
    started.push(job.id)
  }

  const { data: unsent } = await admin.from('import_jobs').select('id').in('status', ['done', 'failed']).is('notified_at', null).limit(10)
  for (const j of unsent ?? []) await notifyImportJobFinished(admin, j.id).catch((e) => console.error(`[import-jobs-cron] ${j.id} finished email:`, e))

  const cutoff = new Date(Date.now() - STALE_COPY_DAYS * 86_400_000).toISOString()
  const { data: stale } = await admin.from('import_snapshots').select('account_id, source').eq('key', 'meta').lt('updated_at', cutoff).limit(50)
  for (const s of stale ?? []) {
    await admin.from('import_snapshots').delete().eq('account_id', s.account_id).eq('source', s.source)
  }

  return { started: started.length, givenUp: given_up.length, unsentEmails: unsent?.length ?? 0, staleCopiesDeleted: stale?.length ?? 0 }
})

import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { kickFormsJob, runFormsJobSlice } from '~/server/utils/practicehubFormPdfs'

// One run of the signed-forms job for one account, then the call that starts
// the next (server/utils/practicehubFormPdfs.ts).
//
// It is called by itself, by Settings > Import when a clinic presses start,
// and by practicehub-web-cron every minute for a chain that stopped -- which
// is every ~nine runs, because Netlify drops a function's calls to its own
// site as a loop after that many hops (server/utils/practicehubWebChain.ts).
// Not named *-cron on purpose: nothing schedules it directly.
export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  const body = await readBody<{ accountId?: string }>(event)
  if (!body?.accountId || !/^[0-9a-f-]{36}$/i.test(body.accountId)) throw createError({ statusCode: 400, statusMessage: 'accountId is required' })

  const admin = serverSupabaseServiceRole<Database>(event)
  const job = await runFormsJobSlice(admin, body.accountId)
  if (job.status === 'running' && job.leaseUntil === 0) await kickFormsJob(getRequestURL(event).origin, body.accountId, runtimeConfig.cronSecret)
  return { status: job.status, cursor: job.cursor, patients: job.patients, stored: job.stored }
})

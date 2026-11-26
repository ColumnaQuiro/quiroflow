import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { kickInvoicesJob, runInvoicesJobSlice } from '~/server/utils/practicehubInvoicePdfs'

// One run of the invoice-originals job for one account, then the call that
// starts the next (server/utils/practicehubInvoicePdfs.ts). The same shape as
// practicehub-forms-run.post.ts, for the same reasons: called by itself, by
// Settings > Import when a clinic presses start, and by lead-sequence-cron for
// a chain that broke, so it needs no pg_cron job of its own.
export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  const body = await readBody<{ accountId?: string }>(event)
  if (!body?.accountId || !/^[0-9a-f-]{36}$/i.test(body.accountId)) throw createError({ statusCode: 400, statusMessage: 'accountId is required' })

  const admin = serverSupabaseServiceRole<Database>(event)
  const job = await runInvoicesJobSlice(admin, body.accountId)
  if (job.status === 'running' && job.leaseUntil === 0) await kickInvoicesJob(getRequestURL(event).origin, body.accountId, runtimeConfig.cronSecret)
  return { status: job.status, cursor: job.cursor, total: job.total, stored: job.stored }
})

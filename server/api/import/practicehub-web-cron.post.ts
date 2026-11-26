import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { kickFormsJob, stalledFormsJobs } from '~/server/utils/practicehubFormPdfs'
import { kickInvoicesJob, stalledInvoicesJobs } from '~/server/utils/practicehubInvoicePdfs'

// Every minute (pg_cron job 'practicehub-web-1min'): starts again any
// signed-forms or invoice-originals job whose chain of runs has stopped.
//
// Each run calls the next itself, and Netlify drops that call after about nine
// hops as a loop (server/utils/practicehubWebChain.ts), so every job stops
// roughly every 45 seconds however healthy it is. A chain this starts is new
// as far as Netlify is concerned. It used to ride on lead-sequence-cron, which
// ticks every fifteen minutes: enough for "a deploy cut it off", far too slow
// for something that happens every minute -- 7,241 invoices would have taken
// about nine hours.
//
// Cheap when there is nothing to do: two small reads of account_secrets.
export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const admin = serverSupabaseServiceRole<Database>(event)
  const origin = getRequestURL(event).origin
  const [forms, invoices] = await Promise.all([stalledFormsJobs(admin), stalledInvoicesJobs(admin)])
  await Promise.all([
    ...forms.map((accountId) => kickFormsJob(origin, accountId, runtimeConfig.cronSecret)),
    ...invoices.map((accountId) => kickInvoicesJob(origin, accountId, runtimeConfig.cronSecret)),
  ])
  return { forms: forms.length, invoices: invoices.length }
})

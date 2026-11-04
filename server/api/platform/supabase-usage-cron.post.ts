// Samples what the Supabase project has left -- CPU, memory, database disk,
// file storage, connections -- and emails ops when one is close to its limit
// (server/utils/supabaseUsage.ts). Every 15 minutes, because CPU is measured
// as the share of time busy between two runs: the interval is the window.
//
// Same X-Cron-Secret pattern as every other scheduled job; the pg_cron job is
// created by hand against production (see CLAUDE.md, "Scheduling a cron").
export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const result = await recordSupabaseUsage()
  if (!result) return { sampled: false }
  return { sampled: true, alerts: result.alerts }
})

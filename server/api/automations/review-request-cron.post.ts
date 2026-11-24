import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { enrolAppointmentMoments } from '~/server/utils/automationAtomRules'

// Every 15 minutes: the automations timed from an appointment's END -- "2 days
// after it ends" with only completed visits is the Google review request,
// "2 hours after it ends" on the first visit and every tenth, not asked in
// 30 days, is the satisfaction question. Both used to be triggers of their
// own (appointment.review_request, appointment.satisfaction); they are an
// appointment's end with a timing and filters now, read here with the same
// window and the same automation_rule_sends claim
// (server/utils/automationAtomRules.ts).
export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  const supabase = serverSupabaseServiceRole<Database>(event)
  return { sent: await enrolAppointmentMoments(supabase, getRequestURL(event).origin, 'end') }
})

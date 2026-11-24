import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { enrolAppointmentMoments } from '~/server/utils/automationAtomRules'

// Every 15 minutes (pg_cron job appointment-hours-before-15min): the
// automations timed from an appointment's start in minutes, hours or days --
// "24 hours before it starts", "30 minutes after it starts" -- each once per
// appointment (server/utils/automationAtomRules.ts). The reminders that used
// to be the appointment.hours_before trigger are these now, with the same
// window and the same automation_rule_sends claim.
//
// The same-day-cron runs the ones at a time of day, and the review-request-cron
// the ones timed from the end: three endpoints, as before, so nothing in
// production's schedule changes.
export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  const supabase = serverSupabaseServiceRole<Database>(event)
  return { sent: await enrolAppointmentMoments(supabase, getRequestURL(event).origin, 'start') }
})

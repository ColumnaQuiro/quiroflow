import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { checkInPortalClinic } from '~/server/utils/checkInPortal'

// The front-desk tablet loading its portal (/check-in/<token>): which
// location it is for, its time zone for the times it shows, the language it
// speaks and the clinic's own messages in it. No session -- the token is the
// key. 404 once the portal is turned off or the location archived, which the
// tablet shows as "this portal is switched off".
export default defineEventHandler(async (event) => {
  const clinic = await checkInPortalClinic(serverSupabaseServiceRole<Database>(event), getRouterParam(event, 'token'))
  return { clinicName: clinic.name, timeZone: clinic.timezone, language: clinic.language, messages: clinic.messages }
})

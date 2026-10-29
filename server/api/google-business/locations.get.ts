import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { googleAccessToken, googleError, listLocations } from '~/server/utils/googleBusiness'

// The Google listings the connected user manages, to choose the clinic's from.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')
  const service = serverSupabaseServiceRole<Database>(event)
  try {
    const token = await googleAccessToken(service, teamMember.account_id)
    if (!token) throw createError({ statusCode: 400, statusMessage: 'Connect your Google profile first.' })
    return { locations: await listLocations(token) }
  } catch (err: any) {
    if (err?.statusCode === 400) throw err
    throw createError({ statusCode: 502, statusMessage: googleError(err) })
  }
})

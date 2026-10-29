import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { googleAccessToken, googleError, listLocations, syncGoogleReviews } from '~/server/utils/googleBusiness'

// Chooses which Google listing is the clinic's, then imports its reviews.
// Checked against Google's own list rather than taken on trust: a listing
// the connected user does not manage would only fail later, on every sync.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')
  const body = await readBody<{ location?: string }>(event)
  const wanted = body?.location?.trim()
  if (!wanted) throw createError({ statusCode: 400, statusMessage: 'location is required' })

  const service = serverSupabaseServiceRole<Database>(event)
  let chosen
  try {
    const token = await googleAccessToken(service, teamMember.account_id)
    if (!token) throw createError({ statusCode: 400, statusMessage: 'Connect your Google profile first.' })
    chosen = (await listLocations(token)).find((l) => l.location === wanted)
  } catch (err: any) {
    if (err?.statusCode === 400) throw err
    throw createError({ statusCode: 502, statusMessage: googleError(err) })
  }
  if (!chosen) throw createError({ statusCode: 404, statusMessage: 'That listing is not one this Google account manages.' })

  const { error } = await service
    .from('accounts')
    .update({ google_business_account: chosen.account, google_business_location: chosen.location, google_business_location_title: chosen.title })
    .eq('id', teamMember.account_id)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  try {
    return { title: chosen.title, ...(await syncGoogleReviews(service, teamMember.account_id)) }
  } catch (err: any) {
    // The listing is chosen either way; the import is retried on the next visit.
    return { title: chosen.title, imported: 0, updated: 0, syncError: googleError(err) }
  }
})

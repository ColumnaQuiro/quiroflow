import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { requireGrowth } from '~/server/utils/requireGrowth'
import { googleError, syncGoogleReviews } from '~/server/utils/googleBusiness'

// Brings the clinic's Google reviews up to date. Called by Reputation when it
// opens and its copy is older than a few minutes, and by its "Refresh" button
// -- not by a cron: a schedule would read every connected clinic's reviews
// every few minutes for screens nobody is looking at, and each cron endpoint
// has to be scheduled by hand in production before a deploy can pass.
const FRESH_MS = 10 * 60 * 1000

export default defineEventHandler(async (event) => {
  const { teamMember } = await requireGrowth(event)
  const body = (await readBody<{ force?: boolean }>(event).catch(() => null)) ?? {}
  const service = serverSupabaseServiceRole<Database>(event)

  const { data: account } = await service.from('accounts').select('google_business_location, google_reviews_synced_at').eq('id', teamMember.account_id).maybeSingle()
  if (!account?.google_business_location) return { synced: false, imported: 0, updated: 0 }
  if (!body.force && account.google_reviews_synced_at && Date.now() - new Date(account.google_reviews_synced_at).getTime() < FRESH_MS) {
    return { synced: false, imported: 0, updated: 0 }
  }

  try {
    return { synced: true, ...(await syncGoogleReviews(service, teamMember.account_id)) }
  } catch (err: any) {
    throw createError({ statusCode: 502, statusMessage: `Could not read your Google reviews: ${googleError(err)}` })
  }
})

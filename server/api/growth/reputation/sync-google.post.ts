import { requireGrowth } from '~/server/utils/requireGrowth'
import { fetchGoogleReviews } from '~/server/utils/googleReviews'

// Pulls the clinic's Google rating and recent reviews in.
//
// Upserts on (account_id, platform, external_id) -- the unique index the
// reviews table has carried since it was built, for exactly this. So syncing
// twice imports nothing twice, and a review whose text Google has since
// changed is corrected rather than duplicated.
//
// What it deliberately does NOT touch on an existing row: replied_at,
// reply_body, draft_body. Those are the clinic's work on top of the review,
// and a sync is not a reason to lose a draft somebody was part-way through.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireGrowth(event)

  const apiKey = useRuntimeConfig().googlePlacesApiKey
  // Not configured is a normal state on a deployment that has not set it up,
  // and is reported as such rather than as a failure -- same handling as the
  // model key on the receptionist screens.
  if (!apiKey) return { available: false as const, imported: 0, updated: 0 }

  const { data: account } = await supabase
    .from('accounts')
    .select('google_place_id')
    .eq('id', teamMember.account_id)
    .maybeSingle()

  const placeId = account?.google_place_id?.trim()
  if (!placeId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No Google listing is connected. Add the clinic\'s Google Place ID under Settings > Communication > General.',
    })
  }

  let place
  try {
    place = await fetchGoogleReviews(placeId, apiKey)
  } catch (err: any) {
    // Google's message names the actual problem -- a key without Places
    // enabled, or an id that is not a place -- and both are fixable by
    // whoever set it up. Passed through rather than replaced with "failed".
    const detail = err?.data?.error?.message ?? err?.message ?? 'Unknown error'
    console.error('[reputation/sync-google] Places API failed:', detail)
    throw createError({ statusCode: 502, statusMessage: `Google could not be read: ${detail}` })
  }

  if (place.reviews.length === 0) {
    return { available: true as const, imported: 0, updated: 0, rating: place.rating, totalRatings: place.totalRatings }
  }

  // Which of these are already here, so the response can say what actually
  // changed. "Synced" with no numbers is indistinguishable from "did nothing".
  const { data: existing } = await supabase
    .from('reviews')
    .select('external_id')
    .eq('account_id', teamMember.account_id)
    .eq('platform', 'google')
    .in('external_id', place.reviews.map((r) => r.externalId))

  const known = new Set((existing ?? []).map((r) => r.external_id))

  const { error } = await supabase.from('reviews').upsert(
    place.reviews.map((review) => ({
      account_id: teamMember.account_id,
      platform: 'google',
      external_id: review.externalId,
      author_name: review.authorName,
      rating: review.rating,
      body: review.body || null,
      posted_at: review.postedAt,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'account_id,platform,external_id' },
  )
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return {
    available: true as const,
    imported: place.reviews.filter((r) => !known.has(r.externalId)).length,
    updated: place.reviews.filter((r) => known.has(r.externalId)).length,
    rating: place.rating,
    totalRatings: place.totalRatings,
  }
})

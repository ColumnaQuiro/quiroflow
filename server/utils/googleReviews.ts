// Reading a clinic's Google rating and recent reviews.
//
// Places API (New), not the Business Profile API. Places needs one platform
// key and answers today; Business Profile needs per-clinic OAuth and an
// access request Google processes by hand over days. What that costs is real
// and stated everywhere it shows: Places returns at most five reviews and
// cannot post a reply. So this imports a rating and recent reviews, and
// replying stays what it already is -- drafted in QuiroFlow, posted by a
// person on Google.
//
// Nothing here writes to the database; the caller decides what to do with
// what came back.

const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places'

/**
 * Only the fields that are used. Places bills by field mask, so asking for
 * the whole place costs more per call for data that would be discarded.
 */
const FIELD_MASK = 'id,displayName,rating,userRatingCount,reviews'

export interface GoogleReview {
  /** Google's own resource name for the review -- stable, so it dedupes. */
  externalId: string
  authorName: string
  rating: number
  body: string
  /**
   * Required, not optional: reviews.posted_at is NOT NULL, and the screen
   * orders by it. A review with no date stamped "now" would sort above every
   * real one, so one without a date is dropped instead.
   */
  postedAt: string
}

export interface GooglePlaceReviews {
  rating: number | null
  totalRatings: number | null
  reviews: GoogleReview[]
}

interface PlacesResponse {
  id?: string
  rating?: number
  userRatingCount?: number
  reviews?: {
    name?: string
    rating?: number
    publishTime?: string
    text?: { text?: string }
    originalText?: { text?: string }
    authorAttribution?: { displayName?: string }
  }[]
}

/**
 * Fetches the place, or throws with something a person can act on.
 *
 * Google's errors here are almost always one of two things -- a key without
 * the Places API enabled, or a place id that is not this clinic -- and both
 * are fixable by whoever set it up. Passing the raw body through beats
 * "request failed".
 */
export async function fetchGoogleReviews(placeId: string, apiKey: string): Promise<GooglePlaceReviews> {
  const url = `${PLACES_ENDPOINT}/${encodeURIComponent(placeId)}`

  const response = await $fetch<PlacesResponse>(url, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    timeout: 10_000,
  })

  const reviews: GoogleReview[] = (response.reviews ?? [])
    .map((review) => {
      // originalText is what the reviewer actually wrote; `text` may be
      // Google's translation into the caller's language. A clinic answering a
      // review should see their patient's words, not a round trip through
      // another language.
      const body = (review.originalText?.text ?? review.text?.text ?? '').trim()
      return {
        externalId: review.name ?? '',
        authorName: (review.authorAttribution?.displayName ?? '').trim() || 'Google user',
        rating: review.rating ?? 0,
        body,
        postedAt: review.publishTime ?? '',
      }
    })
    // A review with no id cannot be deduped, one with no rating is not a
    // review, and one with no date cannot be placed on a screen ordered by
    // date. Dropped rather than stored as rows that would duplicate on every
    // sync, show as zero-star, or sort above everything real.
    .filter((review) => review.externalId && review.postedAt && review.rating >= 1 && review.rating <= 5)

  return {
    rating: typeof response.rating === 'number' ? response.rating : null,
    totalRatings: typeof response.userRatingCount === 'number' ? response.userRatingCount : null,
    reviews,
  }
}

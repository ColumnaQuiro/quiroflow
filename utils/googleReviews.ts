// Reading a Google Business Profile review into the shape of a `reviews` row.
//
// Pure, with no `~` imports, so the import (server/utils/googleBusiness.ts)
// and its unit tests read it the same way.

/** A review as the Business Profile API (v4 accounts.locations.reviews) returns it. */
export interface GoogleReview {
  reviewId?: string
  name?: string
  reviewer?: { displayName?: string; isAnonymous?: boolean }
  starRating?: string
  comment?: string
  createTime?: string
  updateTime?: string
  reviewReply?: { comment?: string; updateTime?: string }
}

export interface ImportedReview {
  externalId: string
  authorName: string
  rating: number
  body: string | null
  postedAt: string
  reply: { body: string; at: string } | null
}

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }

/**
 * The words the person wrote, without Google's machine translation.
 *
 * A review in another language than the viewer's arrives with both, in one
 * of two layouts: the original first and the translation after
 * "(Translated by Google)", or the translation first and the original after
 * "(Original)". The clinic answers what was written, not Google's rendering
 * of it.
 */
export function originalReviewText(comment: string | null | undefined): string | null {
  const text = (comment ?? '').trim()
  if (!text) return null
  const original = text.match(/\(Original\)\s*\n([\s\S]*)$/)
  if (original) return original[1]!.trim() || null
  const translated = text.indexOf('(Translated by Google)')
  if (translated > 0) return text.slice(0, translated).trim() || null
  return text
}

/**
 * The row to store, or null for a review that cannot be one: no id to
 * deduplicate on, or no star rating (the table requires 1-5, and a review
 * Google will not rate is not one to average).
 */
export function importedReview(review: GoogleReview): ImportedReview | null {
  const externalId = review.reviewId ?? review.name?.split('/').pop()
  const rating = STARS[review.starRating ?? '']
  if (!externalId || !rating || !review.createTime) return null
  const replyText = review.reviewReply?.comment?.trim()
  return {
    externalId,
    authorName: review.reviewer?.isAnonymous || !review.reviewer?.displayName?.trim() ? 'Usuario de Google' : review.reviewer.displayName.trim(),
    rating,
    body: originalReviewText(review.comment),
    postedAt: review.createTime,
    reply: replyText ? { body: replyText, at: review.reviewReply?.updateTime ?? review.updateTime ?? review.createTime } : null,
  }
}

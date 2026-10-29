import { describe, expect, it } from 'vitest'
import { importedReview, originalReviewText } from '../../utils/googleReviews'

describe('Google reviews', () => {
  it('maps a review onto a reviews row', () => {
    expect(
      importedReview({
        reviewId: 'AbFvOq1',
        reviewer: { displayName: 'Laura G.' },
        starRating: 'FOUR',
        comment: 'Muy buena atención',
        createTime: '2026-10-20T10:00:00Z',
      }),
    ).toEqual({ externalId: 'AbFvOq1', authorName: 'Laura G.', rating: 4, body: 'Muy buena atención', postedAt: '2026-10-20T10:00:00Z', reply: null })
  })

  it('carries a reply already written on Google, so it is not answered twice', () => {
    const review = importedReview({
      reviewId: 'r2',
      starRating: 'FIVE',
      createTime: '2026-10-01T10:00:00Z',
      reviewReply: { comment: '¡Gracias!', updateTime: '2026-10-02T09:00:00Z' },
    })
    expect(review?.reply).toEqual({ body: '¡Gracias!', at: '2026-10-02T09:00:00Z' })
    // A rating with no words is still a review.
    expect(review?.body).toBeNull()
  })

  it('names an anonymous reviewer rather than leaving a blank', () => {
    expect(importedReview({ reviewId: 'r3', starRating: 'TWO', createTime: '2026-10-01T10:00:00Z', reviewer: { isAnonymous: true } })?.authorName).toBe('Usuario de Google')
  })

  it('skips what cannot be a row: no id, no stars', () => {
    expect(importedReview({ starRating: 'FIVE', createTime: '2026-10-01T10:00:00Z' })).toBeNull()
    expect(importedReview({ reviewId: 'r4', starRating: 'STAR_RATING_UNSPECIFIED', createTime: '2026-10-01T10:00:00Z' })).toBeNull()
  })

  it('takes the id from the resource name when reviewId is missing', () => {
    expect(importedReview({ name: 'accounts/1/locations/2/reviews/xyz', starRating: 'ONE', createTime: '2026-10-01T10:00:00Z' })?.externalId).toBe('xyz')
  })

  it('keeps what was written and drops Google\'s translation, in either layout', () => {
    expect(originalReviewText('Great treatment\n\n(Translated by Google) Gran tratamiento')).toBe('Great treatment')
    expect(originalReviewText('(Translated by Google) Gran tratamiento\n\n(Original)\nGreat treatment')).toBe('Great treatment')
    expect(originalReviewText('  ')).toBeNull()
  })
})

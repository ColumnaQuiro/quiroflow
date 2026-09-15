import { requireGrowth } from '~/server/utils/requireGrowth'

// The reputation screen, computed from whatever the clinic actually has.
//
// Two halves with very different footing, and the response says which is
// which rather than blending them:
//
//   reviews    -- only what has been imported or entered by hand. There is no
//                 way to derive a Google rating from anything this app holds,
//                 so an account with none gets `hasReviews: false` and an
//                 empty state, not a zero.
//   requests   -- ours end to end. We sent it, so `sent` is exact; the link
//                 goes through our own redirect, so `opened` is exact.
//                 `converted` counts only requests explicitly tied to a
//                 review, because nobody can watch someone type on Google.

export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireGrowth(event)

  const yearAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString()

  const [{ data: reviews, error }, { data: requests }] = await Promise.all([
    supabase
      .from('reviews')
      .select('id, platform, author_name, rating, body, posted_at, replied_at, reply_body, reply_was_ai_drafted, draft_body, clinics:clinic_id(name)')
      .eq('account_id', teamMember.account_id)
      .gte('posted_at', yearAgo)
      .order('posted_at', { ascending: false })
      .limit(200),
    supabase
      .from('review_requests')
      .select('id, sent_at, opened_at, review_id')
      .eq('account_id', teamMember.account_id)
      .gte('sent_at', yearAgo),
  ])

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const all = reviews ?? []
  const rated = all.filter((review) => review.rating > 0)

  const distribution = [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: rated.filter((review) => review.rating === stars).length,
  }))

  const average = rated.length === 0 ? null : rated.reduce((sum, review) => sum + review.rating, 0) / rated.length

  // Monthly averages over the year, oldest first. Only months that actually
  // had a review appear -- interpolating a flat line through a quiet month
  // would invent a rating nobody gave.
  const byMonth = new Map<string, number[]>()
  for (const review of rated) {
    const key = review.posted_at.slice(0, 7)
    byMonth.set(key, [...(byMonth.get(key) ?? []), review.rating])
  }
  const trend = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, ratings]) => ({
      label: new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
      value: Number((ratings.reduce((sum, r) => sum + r, 0) / ratings.length).toFixed(2)),
    }))

  const sent = (requests ?? []).length
  const opened = (requests ?? []).filter((r) => r.opened_at).length
  const converted = (requests ?? []).filter((r) => r.review_id).length

  return {
    hasReviews: all.length > 0,
    rating: average === null ? null : Number(average.toFixed(1)),
    reviewCount: rated.length,
    distribution,
    trend,
    // One decimal, matching the headline rating. `4 → 4` next to `4.3`
    // reads like a different quantity.
    trendLabel: trend.length >= 2 ? `${trend[0]!.value.toFixed(1)} → ${trend[trend.length - 1]!.value.toFixed(1)}` : null,
    pendingCount: all.filter((review) => review.draft_body && !review.replied_at).length,
    reviews: all.map((review) => ({
      id: review.id,
      platform: review.platform,
      location: review.clinics?.name ?? null,
      author: review.author_name,
      rating: review.rating,
      body: review.body ?? '',
      postedAt: review.posted_at,
      repliedAt: review.replied_at,
      replyBody: review.reply_body,
      replyWasAiDrafted: review.reply_was_ai_drafted,
      draftBody: review.draft_body,
    })),
    funnel: {
      sent,
      opened,
      openedShare: sent === 0 ? null : Math.round((opened / sent) * 100),
      converted,
      // Null rather than 0 when nothing has been attributed: "0% left a
      // review" is a claim, and we genuinely cannot see the platform side.
      convertedShare: converted === 0 ? null : Math.round((converted / sent) * 100),
    },
  }
})

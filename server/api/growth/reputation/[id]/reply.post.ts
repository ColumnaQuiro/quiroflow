import { requireGrowth } from '~/server/utils/requireGrowth'

interface Body {
  /** Approve the stored draft, or send different text entirely. */
  body?: unknown
  discard?: unknown
}

/**
 * Approves (or discards) a reply to a review.
 *
 * Nothing is posted to Google, Doctoralia or Facebook here -- that needs the
 * platform OAuth this change does not include. What this records is the
 * clinic's decision, so when posting does exist it has an approved body to
 * send rather than a draft nobody read.
 *
 * There is no auto-post and no timer. The design has the draft posting itself
 * after 22 hours if nobody acts; that means an AI-written sentence appearing
 * under the clinic's name on a public review with no person having read it,
 * on exactly the mixed and negative reviews where a wrong reply costs most.
 * That is a decision for the clinic to make deliberately, not a default to
 * inherit from a mockup, so approval is required here and the timer is not
 * implemented.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing review id' })

  const { supabase, teamMember } = await requireGrowth(event)
  const body = (await readBody<Body>(event).catch(() => null)) ?? ({} as Body)

  const { data: review } = await supabase
    .from('reviews')
    .select('id, draft_body, replied_at')
    .eq('id', id)
    .eq('account_id', teamMember.account_id)
    .maybeSingle()

  if (!review) throw createError({ statusCode: 404, statusMessage: 'Review not found' })
  if (review.replied_at) throw createError({ statusCode: 400, statusMessage: 'That review has already been answered' })

  if (body.discard === true) {
    await supabase
      .from('reviews')
      .update({ draft_body: null, draft_created_at: null })
      .eq('id', id)
      .eq('account_id', teamMember.account_id)
    return { discarded: true, replied: false }
  }

  // Edited text wins over the stored draft, which is what makes "Edit" mean
  // something rather than being a second way to press Approve.
  const edited = typeof body.body === 'string' ? body.body.trim() : ''
  const text = edited || review.draft_body?.trim() || ''
  if (!text) throw createError({ statusCode: 400, statusMessage: 'There is nothing to reply with' })

  const { error } = await supabase
    .from('reviews')
    .update({
      reply_body: text,
      replied_at: new Date().toISOString(),
      reply_by_team_member_id: teamMember.id,
      // True only when the approved text is the model's own, untouched.
      reply_was_ai_drafted: !edited && Boolean(review.draft_body),
      draft_body: null,
      draft_created_at: null,
    })
    .eq('id', id)
    .eq('account_id', teamMember.account_id)

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { discarded: false, replied: true, postedToPlatform: false }
})

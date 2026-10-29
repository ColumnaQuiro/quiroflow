import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { requireGrowth } from '~/server/utils/requireGrowth'
import { postGoogleReply } from '~/server/utils/googleBusiness'

interface Body {
  /** Approve the stored draft, or send different text entirely. */
  body?: unknown
  discard?: unknown
}

/**
 * Approves (or discards) a reply to a review.
 *
 * A Google review imported from the clinic's connected profile is answered on
 * Google too, under the clinic's name, before anything is recorded here: a
 * reply marked as sent that Google refused would be the one lie this screen
 * must not tell. Doctoralia and Facebook have no posting yet, so for them
 * this records the clinic's decision, with an approved body ready for when
 * they do.
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
    .select('id, draft_body, replied_at, platform, external_id')
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

  let postedToPlatform = false
  if (review.platform === 'google' && review.external_id) {
    const service = serverSupabaseServiceRole<Database>(event)
    const { data: account } = await service.from('accounts').select('google_business_location').eq('id', teamMember.account_id).maybeSingle()
    if (account?.google_business_location) {
      await postGoogleReply(service, teamMember.account_id, review.external_id, text)
      postedToPlatform = true
    }
  }

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

  return { discarded: false, replied: true, postedToPlatform }
})

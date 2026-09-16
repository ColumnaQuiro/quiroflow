import { requireGrowth } from '~/server/utils/requireGrowth'
import { draftLeadReply } from '~/server/utils/receptionistDraft'

// "Draft a reply", from the Inbox.
//
// The writing itself lives in server/utils/receptionistDraft.ts, shared with
// the tick that drafts without being asked. Both must produce the same
// sentence for the same conversation: an owner who presses this button and
// gets something different from what the tick would have written has no
// reason to trust either.
//
// So all this route does is decide who may ask, and turn the outcome into a
// status code. It sends nothing -- approving is a separate request to
// /api/whatsapp/inbox-send, made by a person who has read the words.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing lead id' })

  const { teamMember, supabase } = await requireGrowth(event)

  let outcome
  try {
    outcome = await draftLeadReply(supabase, teamMember.account_id, id)
  } catch (err: any) {
    console.error('[growth/draft-reply] model call failed:', err?.message ?? err)
    throw createError({ statusCode: 502, statusMessage: 'Could not draft a reply just now. Try again.' })
  }

  switch (outcome.status) {
    case 'drafted':
      return { available: true as const, draft: outcome.draft }
    // Not configured is a normal state, not a failure -- same handling as the
    // test chat and the review drafter.
    case 'unavailable':
      return { available: false as const, draft: '' }
    case 'refused':
      return { available: true as const, draft: '', refused: true as const }
    case 'not_found':
      throw createError({ statusCode: 404, statusMessage: 'Lead not found' })
    case 'blocked':
      throw createError({ statusCode: 400, statusMessage: 'The receptionist is blocked for this lead' })
    case 'disabled':
      throw createError({
        statusCode: 400,
        statusMessage: 'The receptionist is switched off. Turn it on under Growth > Receptionist.',
      })
    case 'nothing_to_answer':
      throw createError({ statusCode: 400, statusMessage: 'There is nothing new from this lead to reply to' })
  }
})

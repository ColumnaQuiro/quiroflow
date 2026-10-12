import { serverSupabaseServiceRole } from '#supabase/server'
import { hasGrowth } from '~/server/utils/requireGrowth'
import { draftPatientReply } from '~/server/utils/patientReplyDraft'
import { modelFailureMessage } from '~/utils/modelFailure'

// "Draft a reply" in a PATIENT's Inbox conversation (web and the staff app):
// the receptionist writes one from the conversation and what the clinic knows
// about them. Returns the words; stores and sends nothing -- the person who
// asked reads it and sends it through the Inbox like anything they type.
//
// Behind the Inbox's own permission, not Growth's settings permission: the
// front desk answering patients is who this is for. Growth is still what
// pays for it, so the subscription must include it.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing patient id' })

  const { supabase, teamMember, subscription } = await requirePermission(event, 'inbox_access')
  if (!hasGrowth(subscription)) {
    throw createError({ statusCode: 402, statusMessage: 'Reply drafts are part of Growth. Add it under Billing.' })
  }

  let outcome
  try {
    outcome = await draftPatientReply(supabase, serverSupabaseServiceRole(event), teamMember.account_id, id)
  } catch (err: any) {
    console.error('[inbox/draft-reply] model call failed:', err?.message ?? err)
    throw createError({ statusCode: 502, statusMessage: modelFailureMessage(err) })
  }

  switch (outcome.status) {
    case 'drafted':
      return { available: true as const, draft: outcome.draft }
    // Only the tick sends; the button never asks it to.
    case 'sent':
      return { available: true as const, draft: outcome.text }
    case 'unavailable':
      return { available: false as const, draft: '' }
    case 'refused':
      return { available: true as const, draft: '', refused: true as const }
    case 'not_found':
      throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
    case 'nothing_to_answer':
      throw createError({ statusCode: 400, statusMessage: 'There is nothing new from this patient to reply to' })
  }
})

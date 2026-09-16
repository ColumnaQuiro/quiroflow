import { requireGrowth } from '~/server/utils/requireGrowth'

// Throws the drafted reply away.
//
// Used by both buttons, deliberately: "Discard" means the clinic did not want
// those words, and approving calls this after /api/whatsapp/inbox-send has
// accepted the message. A draft that survives being sent is a draft somebody
// sends twice.
//
// Clearing after the send rather than inside it keeps the send route free of
// any knowledge of drafts -- it is the same route the composer uses to type a
// reply by hand, and it should stay that.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing lead id' })

  const { supabase, teamMember } = await requireGrowth(event)

  const { data: lead } = await supabase
    .from('leads')
    .select('id')
    .eq('id', id)
    .eq('account_id', teamMember.account_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!lead) throw createError({ statusCode: 404, statusMessage: 'Lead not found' })

  await supabase
    .from('leads')
    .update({ ai_draft_body: null, ai_draft_created_at: null })
    .eq('id', id)
    .eq('account_id', teamMember.account_id)

  return { ok: true }
})

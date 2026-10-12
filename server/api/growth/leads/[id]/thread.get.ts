import { requireGrowth } from '~/server/utils/requireGrowth'
import { readLeadThread } from '~/utils/leadThread'

// One lead's conversation: the messages, and the context a person needs
// beside them to answer well. The Inbox reads it from the browser now
// (useGrowthLeadThread); this keeps the same answer, behind the Growth check,
// for anything that still asks the server.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing lead id' })

  const { supabase, teamMember } = await requireGrowth(event)
  const thread = await readLeadThread(supabase, id, teamMember.account_id)
  if (!thread) throw createError({ statusCode: 404, statusMessage: 'Lead not found' })
  return thread
})

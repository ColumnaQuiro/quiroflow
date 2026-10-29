import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { isVisitorId, webchatAccountBySlug, webchatConversation, webchatLeadId } from '~/server/utils/webchat'

// The visitor's conversation, which the widget reads every few seconds while
// it is open. Readable only with the visitor id, which only their browser has.
export default defineEventHandler(async (event) => {
  const slug = String(getRouterParam(event, 'slug') ?? '')
  const visitorId = getQuery(event).visitorId
  if (!isVisitorId(visitorId)) throw createError({ statusCode: 400, statusMessage: 'visitorId is required' })

  const supabase = serverSupabaseServiceRole<Database>(event)
  const account = await webchatAccountBySlug(supabase, slug)
  if (!account) throw createError({ statusCode: 404, statusMessage: 'Chat not available' })

  const leadId = await webchatLeadId(supabase, account.id, visitorId)
  return { messages: leadId ? await webchatConversation(supabase, account.id, leadId) : [] }
})

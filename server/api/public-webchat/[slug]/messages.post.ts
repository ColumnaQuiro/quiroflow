import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { throttlePublic } from '~/server/utils/publicRateLimit'
import { notifyInboxTeamMembers } from '~/server/utils/pushNotifications'
import { isVisitorId, leadForWebchatVisitor, webchatAccountBySlug, webchatConversation } from '~/server/utils/webchat'

// A visitor writing in the chat on the clinic's website.
//
// Stored exactly as an Instagram DM is: a lead for the person, an inbound
// row on the lead, a push to the team. The receptionist's tick picks it up
// from there like any other lead message, so nothing here calls a model --
// which is also what keeps a public endpoint from spending the clinic's
// replies on whoever finds it.
const MAX_TEXT = 2000

export default defineEventHandler(async (event) => {
  // Generous for a person typing, tight for a script: a visitor sending
  // thirty messages in ten minutes is already unusual.
  await throttlePublic(event, { scope: 'webchat-message', limit: 30, windowSeconds: 600 })

  const slug = String(getRouterParam(event, 'slug') ?? '')
  const body = await readBody<{ visitorId?: unknown; text?: unknown }>(event)
  const visitorId = body?.visitorId
  if (!isVisitorId(visitorId)) throw createError({ statusCode: 400, statusMessage: 'visitorId is required' })
  const text = typeof body?.text === 'string' ? body.text.replace(/\p{Cc}/gu, (c) => (c === '\n' ? c : '')).trim() : ''
  if (!text) throw createError({ statusCode: 400, statusMessage: 'text is required' })
  if (text.length > MAX_TEXT) throw createError({ statusCode: 400, statusMessage: `Messages are limited to ${MAX_TEXT} characters` })

  const supabase = serverSupabaseServiceRole<Database>(event)
  const account = await webchatAccountBySlug(supabase, slug)
  if (!account) throw createError({ statusCode: 404, statusMessage: 'Chat not available' })

  const leadId = await leadForWebchatVisitor(supabase, account.id, visitorId)
  // Without a lead the message would belong to nobody in the Inbox, and the
  // visitor could never read an answer back. Better to say it did not go.
  if (!leadId) throw createError({ statusCode: 500, statusMessage: 'Could not start the conversation' })

  const { error } = await supabase.from('whatsapp_messages').insert({
    account_id: account.id,
    lead_id: leadId,
    channel: 'webchat',
    direction: 'inbound',
    status: 'received',
    external_contact_id: visitorId,
    body_preview: text,
  })
  if (error) throw createError({ statusCode: 500, statusMessage: 'Could not send the message' })

  await notifyInboxTeamMembers(supabase, account.id, 'Chat de la web', text.slice(0, 120), {
    channel: 'webchat',
    key: `lead:${leadId}`,
  })

  return { messages: await webchatConversation(supabase, account.id, leadId) }
})

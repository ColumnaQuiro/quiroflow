import { clearLeadHandover } from '~/server/utils/inboxSend'
import { sendWebchatText } from '~/server/utils/webchat'

// Replying to a website chat from the Inbox.
//
// There is no platform to hand it to: the visitor's widget reads the
// conversation back from whatsapp_messages, so writing the row IS sending
// it. Nor is there a 24-hour window. A visitor who has closed the tab sees
// the answer the next time they open the chat on that browser.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ leadId?: string; recipientId?: string; text?: string }>(event)
  let leadId = body?.leadId?.trim()
  const recipientId = body?.recipientId?.trim()
  const text = body?.text?.trim()
  if (!leadId && !recipientId) throw createError({ statusCode: 400, statusMessage: 'leadId or recipientId is required' })
  if (!text) throw createError({ statusCode: 400, statusMessage: 'text is required' })

  const { supabase, teamMember } = await requirePermission(event, 'inbox_access')

  // A converted patient's thread knows the person by the id they wrote from,
  // not by the lead that id made: found again through the lead.
  if (!leadId) {
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('account_id', teamMember.account_id)
      .eq('external_source', 'webchat')
      .eq('external_id', recipientId!)
      .is('deleted_at', null)
      .maybeSingle()
    if (!lead) throw createError({ statusCode: 404, statusMessage: 'No conversation found for that person.' })
    leadId = lead.id
  }

  await sendWebchatText(supabase, teamMember.account_id, leadId, text)
  // A person answered: a handover on this lead is resolved (inboxSend.ts).
  await clearLeadHandover(supabase, teamMember.account_id, leadId)
  return { ok: true }
})

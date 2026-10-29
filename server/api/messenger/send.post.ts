import { clearLeadHandover } from '~/server/utils/inboxSend'
import { sendMessengerToLead } from '~/server/utils/messengerSend'

// Replying to a Facebook Messenger conversation from the Inbox. Every
// Messenger sender becomes a lead (messengerWebhook.ts), so a reply is always
// addressed by lead; the lead carries the PSID.
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
      .eq('external_source', 'messenger')
      .eq('external_id', recipientId!)
      .is('deleted_at', null)
      .maybeSingle()
    if (!lead) throw createError({ statusCode: 404, statusMessage: 'No conversation found for that person.' })
    leadId = lead.id
  }

  const messageId = await sendMessengerToLead(supabase, teamMember.account_id, leadId, text)
  await clearLeadHandover(supabase, teamMember.account_id, leadId)
  return { ok: true, messageId }
})

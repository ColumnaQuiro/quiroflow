import type { MediaKind } from '~/server/utils/whatsappSend'
import { sendInboxMessage } from '~/server/utils/inboxSend'

// The Inbox composer's send: free-form text or media, only ever within
// WhatsApp's 24h customer-service window (business-initiated messages
// outside that window still have to go through /api/whatsapp/send with a
// pre-approved template -- see that file's comment for why).
export default defineEventHandler(async (event) => {
  const body = await readBody<{
    patientId?: string
    phoneNumber?: string
    /** Stamps the message onto a lead's thread as well as the phone's. */
    leadId?: string
    text?: string
    mediaBase64?: string
    mediaMimeType?: string
    mediaFilename?: string
    mediaKind?: MediaKind
    caption?: string
  }>(event)

  if (!body?.patientId && !body?.phoneNumber && !body?.leadId) {
    throw createError({ statusCode: 400, statusMessage: 'patientId, leadId or phoneNumber is required' })
  }
  if (!body.text && !body.mediaBase64) {
    throw createError({ statusCode: 400, statusMessage: 'text or media is required' })
  }

  const { supabase, teamMember } = await requirePermission(event, body?.leadId ? 'communication_config' : 'inbox_access')

  await sendInboxMessage(event, { supabase, teamMember }, {
    patientId: body.patientId,
    phoneNumber: body.phoneNumber,
    leadId: body.leadId,
    text: body.text,
    mediaBuffer: body.mediaBase64 ? Buffer.from(body.mediaBase64, 'base64') : undefined,
    mediaMimeType: body.mediaMimeType,
    mediaFilename: body.mediaFilename,
    mediaKind: body.mediaKind,
    caption: body.caption,
  })

  return { success: true }
})

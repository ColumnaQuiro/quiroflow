import { toE164 } from '~/utils/phone'
import { isWithin24hWindow, sendWhatsAppText, sendWhatsAppMedia, uploadMediaToMeta, type MediaKind } from '~/server/utils/whatsappSend'

// The Inbox composer's send: free-form text or media, only ever within
// WhatsApp's 24h customer-service window (business-initiated messages
// outside that window still have to go through /api/whatsapp/send with a
// pre-approved template -- see that file's comment for why).
export default defineEventHandler(async (event) => {
  const body = await readBody<{
    patientId?: string
    phoneNumber?: string
    text?: string
    mediaBase64?: string
    mediaMimeType?: string
    mediaFilename?: string
    mediaKind?: MediaKind
    caption?: string
  }>(event)

  if (!body?.patientId && !body?.phoneNumber) {
    throw createError({ statusCode: 400, statusMessage: 'patientId or phoneNumber is required' })
  }
  if (!body.text && !body.mediaBase64) {
    throw createError({ statusCode: 400, statusMessage: 'text or media is required' })
  }

  const { supabase, teamMember } = await requirePermission(event, 'inbox_access')

  const { data: account } = await supabase
    .from('accounts')
    .select('id, whatsapp_phone_number_id, whatsapp_access_token')
    .eq('id', teamMember.account_id)
    .maybeSingle()
  if (!account?.whatsapp_phone_number_id || !account?.whatsapp_access_token) {
    throw createError({ statusCode: 400, statusMessage: 'WhatsApp is not configured. Set it up in Settings > WhatsApp.' })
  }
  const waAccount = { whatsapp_phone_number_id: account.whatsapp_phone_number_id, whatsapp_access_token: account.whatsapp_access_token }

  let to = body.phoneNumber ?? ''
  if (body.patientId) {
    const { data: patient } = await supabase.from('patients').select('id, is_minor, do_not_contact').eq('id', body.patientId).maybeSingle()
    if (!patient) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
    if (patient.is_minor || patient.do_not_contact) {
      throw createError({ statusCode: 400, statusMessage: 'This patient cannot be contacted (under age or marked do not contact).' })
    }
    const { data: numbers } = await supabase.from('patient_contact_numbers').select('number, country_code, is_whatsapp').eq('patient_id', body.patientId)
    const target = numbers?.find((n) => n.is_whatsapp) ?? numbers?.[0]
    if (!target) throw createError({ statusCode: 400, statusMessage: 'This patient has no phone number on file' })
    const e164 = toE164(target.number, target.country_code)
    if (!e164) throw createError({ statusCode: 400, statusMessage: "This patient's phone number could not be formatted for WhatsApp" })
    to = e164
  }

  const { data: lastInbound } = await supabase
    .from('whatsapp_messages')
    .select('created_at')
    .eq('account_id', account.id)
    .eq('phone_number', to)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!isWithin24hWindow(lastInbound?.created_at ?? null)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'More than 24h since this patient last messaged you -- send a template instead (WhatsApp blocks free-form replies outside that window).',
    })
  }

  let wamid: string | null = null
  const insert: Record<string, unknown> = {
    account_id: account.id,
    patient_id: body.patientId ?? null,
    phone_number: to,
    direction: 'outbound',
    status: 'sent',
    purpose: 'other',
  }

  try {
    if (body.mediaBase64 && body.mediaMimeType && body.mediaKind) {
      const buffer = Buffer.from(body.mediaBase64, 'base64')
      const filename = body.mediaFilename ?? 'file'
      const mediaId = await uploadMediaToMeta(waAccount, buffer, body.mediaMimeType, filename)
      wamid = await sendWhatsAppMedia(waAccount, to, body.mediaKind, mediaId, { caption: body.caption, filename })

      const path = `${account.id}/out-${Date.now()}-${filename}`
      await supabase.storage.from('whatsapp-media').upload(path, buffer, { contentType: body.mediaMimeType, upsert: true })
      insert.media_type = body.mediaKind
      insert.media_storage_path = path
      insert.media_mime_type = body.mediaMimeType
      insert.media_filename = body.mediaFilename ?? null
      insert.body_preview = body.caption?.slice(0, 2000) ?? null
    } else if (body.text) {
      wamid = await sendWhatsAppText(waAccount, to, body.text)
      insert.body_preview = body.text.slice(0, 2000)
    }
  } catch (err: any) {
    const metaMessage = err?.data?.error?.message
    throw createError({ statusCode: 502, statusMessage: metaMessage ?? 'WhatsApp send failed' })
  }

  insert.wamid = wamid
  await supabase.from('whatsapp_messages').insert(insert as never)

  return { success: true }
})

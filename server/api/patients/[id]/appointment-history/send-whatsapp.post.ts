import { toE164 } from '~/utils/phone'
import { isWithin24hWindow, sendWhatsAppMedia, uploadMediaToMeta } from '~/server/utils/whatsappSend'

// Freeform document send, same capability/window as the Inbox composer
// (server/api/whatsapp/inbox-send.post.ts) -- gated by the same permission
// and the same 24h customer-service-window rule, since this is the same
// kind of send just triggered from the patient profile instead of the Inbox.
export default defineEventHandler(async (event) => {
  const patientId = getRouterParam(event, 'id')
  const { supabase, teamMember } = await requirePermission(event, 'inbox_access')

  const data = await loadAppointmentHistoryData(supabase, patientId!)
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  }

  const { data: patient } = await supabase.from('patients').select('is_minor, do_not_contact').eq('id', patientId!).maybeSingle()
  if (!patient) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  if (patient.is_minor || patient.do_not_contact) {
    throw createError({ statusCode: 400, statusMessage: 'This patient cannot be contacted (under age or marked do not contact).' })
  }

  const { data: account } = await supabase
    .from('accounts')
    .select('id, whatsapp_phone_number_id, whatsapp_access_token')
    .eq('id', teamMember.account_id)
    .maybeSingle()
  if (!account?.whatsapp_phone_number_id || !account?.whatsapp_access_token) {
    throw createError({ statusCode: 400, statusMessage: 'WhatsApp is not configured. Set it up in Settings > WhatsApp.' })
  }
  const waAccount = { whatsapp_phone_number_id: account.whatsapp_phone_number_id, whatsapp_access_token: account.whatsapp_access_token }

  const { data: numbers } = await supabase.from('patient_contact_numbers').select('number, country_code, is_whatsapp').eq('patient_id', patientId!)
  const target = numbers?.find((n) => n.is_whatsapp) ?? numbers?.[0]
  if (!target) throw createError({ statusCode: 400, statusMessage: 'This patient has no phone number on file' })
  const to = toE164(target.number, target.country_code)
  if (!to) throw createError({ statusCode: 400, statusMessage: "This patient's phone number could not be formatted for WhatsApp" })

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
      statusMessage: 'More than 24h since this patient last messaged you -- send the history by email instead (WhatsApp blocks free-form messages outside that window).',
    })
  }

  const pdf = await generateAppointmentHistoryPdf(data)
  const filename = 'appointment-history.pdf'

  let wamid: string | null = null
  try {
    const mediaId = await uploadMediaToMeta(waAccount, pdf, 'application/pdf', filename)
    wamid = await sendWhatsAppMedia(waAccount, to, 'document', mediaId, { filename })
  } catch (err: any) {
    const metaError = err?.data?.error
    const metaMessage = metaError ? [metaError.message, metaError.error_data?.details].filter(Boolean).join(' -- ') : null
    throw createError({ statusCode: 502, statusMessage: metaMessage ?? 'WhatsApp send failed' })
  }

  const path = `${account.id}/out-${Date.now()}-${filename}`
  await supabase.storage.from('whatsapp-media').upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  await supabase.from('whatsapp_messages').insert({
    account_id: account.id,
    patient_id: patientId!,
    phone_number: to,
    direction: 'outbound',
    status: 'sent',
    purpose: 'other',
    wamid,
    media_type: 'document',
    media_storage_path: path,
    media_mime_type: 'application/pdf',
    media_filename: filename,
    body_preview: 'Appointment history',
  } as never)

  return { sent: true }
})

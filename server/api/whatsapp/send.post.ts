import { toE164 } from '~/utils/phone'

// Sends via Meta's WhatsApp Business Cloud API directly. Business-initiated
// messages like recalls and confirmations require a pre-approved template
// (Meta blocks free-form text outside a 24h customer-service window), so
// this fills in a template's {{n}} variable slots rather than sending
// arbitrary text.
export default defineEventHandler(async (event) => {
  const body = await readBody<{
    patientId: string
    templateName: string
    templateLanguage: string
    variables: string[]
    headerFormat?: 'IMAGE' | 'DOCUMENT' | 'VIDEO' | 'LOCATION'
    attachmentFileId?: string
    location?: { latitude: number; longitude: number; name: string; address: string }
    appointmentId?: string
  }>(event)

  if (!body?.patientId || !body?.templateName || !body?.templateLanguage) {
    throw createError({ statusCode: 400, statusMessage: 'patientId, templateName and templateLanguage are required' })
  }

  const { supabase, teamMember } = await requirePermission(event, 'recalls_access')

  const { data: account } = await supabase
    .from('accounts')
    .select(
      'whatsapp_phone_number_id, whatsapp_access_token, whatsapp_confirmation_template_name, whatsapp_reminder_template_name, whatsapp_recall_template_name',
    )
    .eq('id', teamMember.account_id)
    .maybeSingle()
  if (!account?.whatsapp_phone_number_id || !account?.whatsapp_access_token) {
    throw createError({ statusCode: 400, statusMessage: 'WhatsApp is not configured. Set it up in Settings > WhatsApp.' })
  }

  const { data: patient } = await supabase.from('patients').select('id, is_minor, do_not_contact').eq('id', body.patientId).maybeSingle()
  if (!patient) {
    throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  }
  if (patient.is_minor || patient.do_not_contact) {
    throw createError({ statusCode: 400, statusMessage: 'This patient cannot be contacted (under age or marked do not contact).' })
  }

  const { data: numbers } = await supabase
    .from('patient_contact_numbers')
    .select('number, country_code, is_whatsapp')
    .eq('patient_id', body.patientId)
  const target = numbers?.find((n) => n.is_whatsapp) ?? numbers?.[0]
  if (!target) {
    throw createError({ statusCode: 400, statusMessage: 'This patient has no phone number on file' })
  }
  const to = toE164(target.number, target.country_code)
  if (!to) {
    throw createError({ statusCode: 400, statusMessage: 'This patient\'s phone number could not be formatted for WhatsApp' })
  }

  const components: Record<string, unknown>[] = []

  if (body.headerFormat === 'LOCATION' && body.location) {
    components.push({
      type: 'header',
      parameters: [
        {
          type: 'location',
          location: {
            latitude: body.location.latitude,
            longitude: body.location.longitude,
            name: body.location.name,
            address: body.location.address,
          },
        },
      ],
    })
  } else if (body.headerFormat && body.attachmentFileId) {
    const { data: file } = await supabase
      .from('patient_files')
      .select('storage_path')
      .eq('id', body.attachmentFileId)
      .maybeSingle()
    if (file?.storage_path) {
      const { data: signed } = await supabase.storage
        .from('patient-files')
        .createSignedUrl(file.storage_path, 60 * 60 * 24)
      if (signed?.signedUrl) {
        const key = body.headerFormat.toLowerCase()
        components.push({ type: 'header', parameters: [{ type: key, [key]: { link: signed.signedUrl } }] })
      }
    }
  }

  if (body.variables?.length) {
    components.push({ type: 'body', parameters: body.variables.map((v) => ({ type: 'text', text: v })) })
  }

  const url: string = `https://graph.facebook.com/v21.0/${account.whatsapp_phone_number_id}/messages`
  let wamid: string | null = null
  try {
    const response = await $fetch<{ messages?: { id: string }[] }>(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${account.whatsapp_access_token}` },
      body: {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name: body.templateName, language: { code: body.templateLanguage }, components },
      },
    })
    // Meta's own message ID -- the only way to later correlate a delivery
    // status or a reply (via the webhook) back to this specific send.
    wamid = response?.messages?.[0]?.id ?? null
  } catch (err: any) {
    const metaMessage = err?.data?.error?.message
    throw createError({ statusCode: 502, statusMessage: metaMessage ?? 'WhatsApp send failed' })
  }

  const purpose =
    body.templateName === account.whatsapp_confirmation_template_name
      ? 'confirmation'
      : body.templateName === account.whatsapp_reminder_template_name
        ? 'reminder'
        : body.templateName === account.whatsapp_recall_template_name
          ? 'recall'
          : 'other'

  await Promise.all([
    supabase.from('contact_log').insert({
      account_id: teamMember.account_id,
      patient_id: body.patientId,
      appointment_id: body.appointmentId ?? null,
      action: 'sent_whatsapp',
      note: `Template: ${body.templateName}${body.variables?.length ? ` (${body.variables.join(', ')})` : ''}`,
      created_by: teamMember.id,
    }),
    supabase.from('whatsapp_messages').insert({
      account_id: teamMember.account_id,
      patient_id: body.patientId,
      appointment_id: body.appointmentId ?? null,
      phone_number: to,
      wamid,
      purpose,
      template_name: body.templateName,
      status: 'sent',
    }),
  ])

  // Reminder counts the same as confirmation here: both templates carry the
  // Confirmar/Cambiar/Cancelar buttons, so a hand-sent reminder has to mark
  // the appointment too, or it shows as neither confirmed nor awaiting a
  // reply. Skip if already confirmed so a nudge doesn't undo that.
  if ((purpose === 'confirmation' || purpose === 'reminder') && body.appointmentId) {
    const { data: current } = await supabase.from('appointments').select('confirmation_status').eq('id', body.appointmentId).maybeSingle()
    if (current?.confirmation_status !== 'confirmed') {
      await supabase.from('appointments').update({ confirmation_status: 'pending' }).eq('id', body.appointmentId)
    }
  }

  return { success: true }
})

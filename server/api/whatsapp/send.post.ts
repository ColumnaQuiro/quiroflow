import { serverSupabaseClient } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { toE164 } from '~/utils/phone'

// Sends via Meta's WhatsApp Business Cloud API directly. Business-initiated
// messages like recalls and confirmations require a pre-approved template
// (Meta blocks free-form text outside a 24h customer-service window), so
// this fills in a template's {{n}} variable slots rather than sending
// arbitrary text.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient<Database>(event)
  const body = await readBody<{
    patientId: string
    templateName: string
    templateLanguage: string
    variables: string[]
    headerFormat?: 'IMAGE' | 'DOCUMENT' | 'VIDEO'
    attachmentFileId?: string
    appointmentId?: string
  }>(event)

  if (!body?.patientId || !body?.templateName || !body?.templateLanguage) {
    throw createError({ statusCode: 400, statusMessage: 'patientId, templateName and templateLanguage are required' })
  }

  const { data: teamMember } = await supabase.from('team_members').select('id, account_id').maybeSingle()
  if (!teamMember) {
    throw createError({ statusCode: 403, statusMessage: 'Not signed in as a team member' })
  }

  const { data: account } = await supabase
    .from('accounts')
    .select('whatsapp_phone_number_id, whatsapp_access_token')
    .eq('id', teamMember.account_id)
    .maybeSingle()
  if (!account?.whatsapp_phone_number_id || !account?.whatsapp_access_token) {
    throw createError({ statusCode: 400, statusMessage: 'WhatsApp is not configured. Set it up in Settings > WhatsApp.' })
  }

  const { data: patient } = await supabase.from('patients').select('id').eq('id', body.patientId).maybeSingle()
  if (!patient) {
    throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
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

  if (body.headerFormat && body.attachmentFileId) {
    const { data: file } = await supabase
      .from('patient_files')
      .select('storage_path')
      .eq('id', body.attachmentFileId)
      .maybeSingle()
    if (file) {
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
  try {
    await $fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${account.whatsapp_access_token}` },
      body: {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name: body.templateName, language: { code: body.templateLanguage }, components },
      },
    })
  } catch (err: any) {
    const metaMessage = err?.data?.error?.message
    throw createError({ statusCode: 502, statusMessage: metaMessage ?? 'WhatsApp send failed' })
  }

  await supabase.from('contact_log').insert({
    account_id: teamMember.account_id,
    patient_id: body.patientId,
    appointment_id: body.appointmentId ?? null,
    action: 'sent_whatsapp',
    note: `Template: ${body.templateName}${body.variables?.length ? ` (${body.variables.join(', ')})` : ''}`,
    created_by: teamMember.id,
  })

  return { success: true }
})

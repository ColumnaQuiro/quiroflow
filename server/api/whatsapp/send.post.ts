import { serverSupabaseClient } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Sends via whatever automation the account has wired up to its webhook
// (n8n today for the account this was built against; a direct WhatsApp
// Cloud API integration could be a second provider later) rather than
// QuiroFlow talking to WhatsApp itself -- lets each clinic keep whatever
// WhatsApp Business setup they already have.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient<Database>(event)
  const body = await readBody<{
    patientId: string
    message: string
    attachmentFileId?: string
    appointmentId?: string
  }>(event)

  if (!body?.patientId || !body?.message?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'patientId and message are required' })
  }

  // RLS-scoped: only ever returns the caller's own team_members row.
  const { data: teamMember } = await supabase.from('team_members').select('id, account_id').maybeSingle()
  if (!teamMember) {
    throw createError({ statusCode: 403, statusMessage: 'Not signed in as a team member' })
  }

  const { data: account } = await supabase
    .from('accounts')
    .select('name, whatsapp_webhook_url')
    .eq('id', teamMember.account_id)
    .maybeSingle()
  if (!account?.whatsapp_webhook_url) {
    throw createError({ statusCode: 400, statusMessage: 'WhatsApp is not configured. Set a webhook URL in Settings > WhatsApp.' })
  }

  const { data: patient } = await supabase
    .from('patients')
    .select('id, first_name, last_name')
    .eq('id', body.patientId)
    .maybeSingle()
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

  let attachmentUrl: string | null = null
  if (body.attachmentFileId) {
    const { data: file } = await supabase
      .from('patient_files')
      .select('storage_path')
      .eq('id', body.attachmentFileId)
      .maybeSingle()
    if (file) {
      const { data: signed } = await supabase.storage
        .from('patient-files')
        .createSignedUrl(file.storage_path, 60 * 60 * 24)
      attachmentUrl = signed?.signedUrl ?? null
    }
  }

  try {
    await $fetch(account.whatsapp_webhook_url, {
      method: 'POST',
      body: {
        patient: { id: patient.id, first_name: patient.first_name, last_name: patient.last_name },
        phone_number: target.number,
        phone_country_code: target.country_code,
        message: body.message,
        attachment_url: attachmentUrl,
      },
      timeout: 10000,
    })
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'Could not reach the WhatsApp webhook' })
  }

  await supabase.from('contact_log').insert({
    account_id: teamMember.account_id,
    patient_id: body.patientId,
    appointment_id: body.appointmentId ?? null,
    action: 'sent_whatsapp',
    note: body.message,
    created_by: teamMember.id,
  })

  return { success: true }
})

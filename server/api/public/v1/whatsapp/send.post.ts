import { toE164 } from '~/utils/phone'
import { requireApiToken, requireScope } from '~/server/utils/apiTokens'
import { isWithin24hWindow, sendWhatsAppTemplate, sendWhatsAppText } from '~/server/utils/whatsappSend'

// Public, token-authenticated send endpoint -- documented in Settings >
// Developers so an external tool (n8n etc.) can send a WhatsApp message as
// the clinic without a Supabase session. Supports the same two message
// kinds the app itself uses: a pre-approved template (works any time) or
// free-form text (only within 24h of the recipient's last inbound
// message -- a WhatsApp platform rule, not a QuiroFlow one).
export default defineEventHandler(async (event) => {
  const { supabase, accountId, scopes } = await requireApiToken(event)
  requireScope(scopes, 'whatsapp:send')

  const body = await readBody<{
    to?: string
    patientId?: string
    templateName?: string
    templateLanguage?: string
    variables?: string[]
    text?: string
  }>(event)

  if (!body?.to && !body?.patientId) {
    throw createError({ statusCode: 400, statusMessage: '"to" (E.164 phone number) or "patientId" is required' })
  }
  if (!body.templateName && !body.text) {
    throw createError({ statusCode: 400, statusMessage: 'Provide either "templateName" (+ "templateLanguage") or "text"' })
  }

  const { data: account } = await supabase
    .from('accounts')
    .select('whatsapp_phone_number_id, whatsapp_access_token')
    .eq('id', accountId)
    .maybeSingle()
  if (!account?.whatsapp_phone_number_id || !account?.whatsapp_access_token) {
    throw createError({ statusCode: 400, statusMessage: 'WhatsApp is not configured for this account yet.' })
  }
  const waAccount = { whatsapp_phone_number_id: account.whatsapp_phone_number_id, whatsapp_access_token: account.whatsapp_access_token }

  let patientId: string | null = body.patientId ?? null
  let to = body.to ?? ''
  if (!to && body.patientId) {
    const { data: numbers } = await supabase.from('patient_contact_numbers').select('number, country_code, is_whatsapp').eq('patient_id', body.patientId)
    const target = numbers?.find((n) => n.is_whatsapp) ?? numbers?.[0]
    if (!target) throw createError({ statusCode: 400, statusMessage: 'This patient has no phone number on file' })
    const e164 = toE164(target.number, target.country_code)
    if (!e164) throw createError({ statusCode: 400, statusMessage: "This patient's phone number could not be formatted for WhatsApp" })
    to = e164
  }
  if (!patientId) {
    const { data: numbers } = await supabase.from('patient_contact_numbers').select('patient_id, number, country_code')
    patientId = numbers?.find((n) => toE164(n.number, n.country_code) === to)?.patient_id ?? null
  }
  if (patientId) {
    const { data: patient } = await supabase.from('patients').select('is_minor, do_not_contact').eq('id', patientId).maybeSingle()
    if (patient?.is_minor || patient?.do_not_contact) {
      throw createError({ statusCode: 400, statusMessage: 'This patient cannot be contacted (under age or marked do not contact).' })
    }
  }

  let wamid: string | null = null
  const insert: Record<string, unknown> = {
    account_id: accountId,
    patient_id: patientId,
    phone_number: to,
    direction: 'outbound',
    status: 'sent',
    purpose: 'other',
  }

  try {
    if (body.templateName) {
      const language = body.templateLanguage || 'es'
      wamid = await sendWhatsAppTemplate(waAccount, to, body.templateName, language, body.variables ?? [])
      insert.template_name = body.templateName
      insert.body_preview = body.variables?.length ? `Template ${body.templateName} (${body.variables.join(', ')})` : `Template ${body.templateName}`
    } else if (body.text) {
      const { data: lastInbound } = await supabase
        .from('whatsapp_messages')
        .select('created_at')
        .eq('account_id', accountId)
        .eq('phone_number', to)
        .eq('direction', 'inbound')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!isWithin24hWindow(lastInbound?.created_at ?? null)) {
        throw createError({
          statusCode: 400,
          statusMessage: 'More than 24h since this recipient last messaged the clinic -- use "templateName" instead of "text" (a WhatsApp platform rule).',
        })
      }
      wamid = await sendWhatsAppText(waAccount, to, body.text)
      insert.body_preview = body.text.slice(0, 2000)
    }
  } catch (err: any) {
    if (err?.statusCode) throw err
    const metaMessage = err?.data?.error?.message
    throw createError({ statusCode: 502, statusMessage: metaMessage ?? 'WhatsApp send failed' })
  }

  insert.wamid = wamid
  await supabase.from('whatsapp_messages').insert(insert as never)

  return { success: true, wamid }
})

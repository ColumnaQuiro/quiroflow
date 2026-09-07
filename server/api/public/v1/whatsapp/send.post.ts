import { toE164 } from '~/utils/phone'
import { ApiError, badRequest, defineApiHandler } from '~/server/utils/publicApi'
import { isWithin24hWindow, sendWhatsAppTemplate, sendWhatsAppText } from '~/server/utils/whatsappSend'

// Send a WhatsApp message as the clinic. Supports the same two message kinds
// the app itself uses: a pre-approved template (works any time) or free-form
// text (only within 24h of the recipient's last inbound message -- a
// WhatsApp platform rule, not a QuiroFlow one).
//
// This endpoint predates the rest of the public API and shipped with
// camelCase fields (patientId, templateName). The rest of v1 is snake_case,
// so snake_case is what's documented -- but the camelCase spellings still
// work and always will: they're live in clinics' n8n flows, and silently
// breaking those to tidy up our own naming isn't a trade worth making.
export default defineApiHandler({ scope: 'whatsapp:send' }, async ({ event, supabase, accountId }) => {
  const raw = await readBody<Record<string, unknown>>(event)
  if (!raw || typeof raw !== 'object') throw badRequest('Request body must be a JSON object.')

  const body = {
    to: pick<string>(raw, 'to'),
    patientId: pick<string>(raw, 'patient_id', 'patientId'),
    templateName: pick<string>(raw, 'template_name', 'templateName'),
    templateLanguage: pick<string>(raw, 'template_language', 'templateLanguage'),
    variables: pick<string[]>(raw, 'variables'),
    text: pick<string>(raw, 'text'),
  }

  if (!body.to && !body.patientId) {
    throw badRequest('Provide "to" (an E.164 phone number) or "patient_id".', 'to')
  }
  if (!body.templateName && !body.text) {
    throw badRequest('Provide either "template_name" (with optional "template_language") or "text".', 'template_name')
  }

  const { data: account } = await supabase
    .from('accounts')
    .select('whatsapp_phone_number_id, whatsapp_access_token')
    .eq('id', accountId)
    .maybeSingle()
  if (!account?.whatsapp_phone_number_id || !account?.whatsapp_access_token) {
    throw badRequest('WhatsApp is not configured for this account yet. Connect it in Settings → WhatsApp.')
  }
  const waAccount = { whatsapp_phone_number_id: account.whatsapp_phone_number_id, whatsapp_access_token: account.whatsapp_access_token }

  let patientId: string | null = body.patientId ?? null
  let to = body.to ?? ''
  if (!to && body.patientId) {
    const { data: numbers } = await supabase
      .from('patient_contact_numbers')
      .select('number, country_code, is_whatsapp')
      .eq('account_id', accountId)
      .eq('patient_id', body.patientId)
    const target = numbers?.find((n) => n.is_whatsapp) ?? numbers?.[0]
    if (!target) throw badRequest('This patient has no phone number on file.', 'patient_id')
    const e164 = toE164(target.number, target.country_code)
    if (!e164) throw badRequest("This patient's phone number could not be formatted for WhatsApp.", 'patient_id')
    to = e164
  }
  if (!patientId) {
    // Scoped to this token's account -- unscoped, this pulled every clinic's
    // contact numbers into memory on every send (service-role bypasses RLS),
    // which is what took the process down as the table grew.
    const { data: numbers } = await supabase.from('patient_contact_numbers').select('patient_id, number, country_code').eq('account_id', accountId)
    patientId = numbers?.find((n) => toE164(n.number, n.country_code) === to)?.patient_id ?? null
  }
  if (patientId) {
    const { data: patient } = await supabase.from('patients').select('is_minor, do_not_contact').eq('id', patientId).eq('account_id', accountId).maybeSingle()
    if (patient?.is_minor || patient?.do_not_contact) {
      throw badRequest('This patient cannot be contacted (under age, or marked do not contact).', 'patient_id')
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
        throw badRequest(
          'More than 24h since this recipient last messaged the clinic — use "template_name" instead of "text". This is a WhatsApp platform rule, not a QuiroFlow one.',
          'text',
        )
      }
      wamid = await sendWhatsAppText(waAccount, to, body.text)
      insert.body_preview = body.text.slice(0, 2000)
    }
  } catch (err: any) {
    if (err instanceof ApiError) throw err
    const metaMessage = err?.data?.error?.message
    // Meta's own rejection reason is far more actionable than anything we
    // could write, so it's passed straight through.
    throw new ApiError('bad_gateway', metaMessage ?? 'WhatsApp rejected the send.')
  }

  insert.wamid = wamid
  await supabase.from('whatsapp_messages').insert(insert as never)

  return { success: true, wamid }
})

function pick<T>(body: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== '') return body[key] as T
  }
  return undefined
}

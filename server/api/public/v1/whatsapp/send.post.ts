import { toE164, whatsappDigits } from '~/utils/phone'
import { whatsappRecipient } from '~/utils/whatsappRecipient'
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
  await withMessagingTokens(accountId, account)
  if (!account?.whatsapp_phone_number_id || !account?.whatsapp_access_token) {
    throw badRequest('WhatsApp is not configured for this account yet. Connect it in Settings → WhatsApp.')
  }
  const waAccount = { whatsapp_phone_number_id: account.whatsapp_phone_number_id, whatsapp_access_token: account.whatsapp_access_token }

  let patientId: string | null = body.patientId ?? null
  // Digits only, the one shape every number in whatsapp_messages is in: Meta
  // sends inbound numbers that way, and toE164() below returns them that way.
  // "to" is documented as E.164, which is written with a "+" -- compared as
  // given, "+34612..." matched no patient, so the minor and do-not-contact
  // refusals below never ran for anyone addressed by number; the 24h window
  // found none of their replies; and the row was stored under a number no
  // thread is keyed by.
  let to = body.to ? whatsappDigits(String(body.to)) : ''
  if (body.to && !to) throw badRequest('"to" must be a phone number in E.164 format, e.g. +34612345678.', 'to')
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
    // Every number the account has, not the first 1000, matched loosely, and
    // every patient sharing the number checked -- see whatsappRecipient. A
    // read that fails throws (a 500, nothing sent) rather than reading as
    // "nobody", which is what skipped the refusal for row 1001 onwards.
    const recipient = await whatsappRecipient(supabase, accountId, to)
    if (recipient.blocked) {
      throw badRequest(
        'This number belongs to a patient who cannot be contacted (under age, or marked do not contact). If it is shared and the message is for someone else on it, send their "patient_id".',
        'to',
      )
    }
    patientId = recipient.patientId
  } else {
    const { data: patient, error } = await supabase
      .from('patients')
      .select('is_minor, do_not_contact')
      .eq('id', patientId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) throw error
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


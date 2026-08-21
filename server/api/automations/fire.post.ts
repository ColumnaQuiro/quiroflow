import { createHmac } from 'node:crypto'
import { toE164 } from '~/utils/phone'
import { renderTemplateFields } from '~/utils/docFields'

// Fires every enabled automation_rule matching a trigger event -- called
// from the client right after the underlying action already happened (a
// patient checked in, an appointment saved as completed, an invoice paid),
// same pattern as the best-effort invoice-email send elsewhere in the app:
// a failed automation shouldn't undo or block the action that triggered it,
// so every action here is best-effort and never throws back to the caller.
interface FireBody {
  triggerEvent: string
  patientId: string
  appointmentId?: string
  invoiceId?: string
}

interface RuleRow {
  id: string
  name: string
}
interface ActionRow {
  id: string
  action_type: 'whatsapp_template' | 'email' | 'webhook'
  config: Record<string, any>
}

export default defineEventHandler(async (event) => {
  const body = await readBody<FireBody>(event)
  if (!body?.triggerEvent || !body?.patientId) {
    throw createError({ statusCode: 400, statusMessage: 'triggerEvent and patientId are required' })
  }

  const { supabase, teamMember } = await requireTeamMember(event)
  const accountId = teamMember.account_id

  const { data: rules } = await supabase
    .from('automation_rules')
    .select('id, name')
    .eq('account_id', accountId)
    .eq('trigger_event', body.triggerEvent)
    .eq('enabled', true)

  if (!rules || rules.length === 0) return { fired: 0 }

  const { data: patient } = await supabase
    .from('patients')
    .select('id, first_name, last_name, email')
    .eq('id', body.patientId)
    .maybeSingle()
  if (!patient) return { fired: 0 }

  const origin = getRequestURL(event).origin

  for (const rule of rules as RuleRow[]) {
    const { data: actions } = await supabase
      .from('automation_actions')
      .select('id, action_type, config')
      .eq('rule_id', rule.id)
      .order('position')

    for (const action of (actions ?? []) as ActionRow[]) {
      try {
        if (action.action_type === 'whatsapp_template') {
          await runWhatsAppAction(supabase, accountId, patient, action.config, origin, body.appointmentId)
        } else if (action.action_type === 'email') {
          await runEmailAction(patient, action.config)
        } else if (action.action_type === 'webhook') {
          await runWebhookAction(action.config, body)
        }
      } catch {
        // Best-effort: one failed action shouldn't stop the rest of the
        // rule, or the other rules, from running.
      }
    }
  }

  return { fired: rules.length }
})

async function runWhatsAppAction(
  supabase: any,
  accountId: string,
  patient: { id: string; first_name: string; last_name: string | null; email: string | null },
  config: Record<string, any>,
  origin: string,
  appointmentId?: string,
) {
  const templateName: string | undefined = config.template_name
  const templateLanguage: string = config.template_language || 'es'
  if (!templateName) return

  const { data: account } = await supabase
    .from('accounts')
    .select('whatsapp_phone_number_id, whatsapp_access_token')
    .eq('id', accountId)
    .maybeSingle()
  if (!account?.whatsapp_phone_number_id || !account?.whatsapp_access_token) return

  const { data: numbers } = await supabase
    .from('patient_contact_numbers')
    .select('number, country_code, is_whatsapp')
    .eq('patient_id', patient.id)
  const target = numbers?.find((n: any) => n.is_whatsapp) ?? numbers?.[0]
  if (!target) return
  const to = toE164(target.number, target.country_code)
  if (!to) return

  const variables: string[] = [patient.first_name]

  if (config.doc_template_id) {
    const { data: template } = await supabase
      .from('doc_templates')
      .select('title, fields')
      .eq('id', config.doc_template_id)
      .maybeSingle()
    if (template) {
      const rendered = renderTemplateFields(template.fields, {
        first_name: patient.first_name ?? '',
        last_name: patient.last_name ?? '',
        email: patient.email ?? '',
      })
      const { data: doc } = await supabase
        .from('patient_docs')
        .insert({
          account_id: accountId,
          patient_id: patient.id,
          title: template.title,
          fields: rendered,
          template_id: config.doc_template_id,
        })
        .select('public_token')
        .single()
      if (doc?.public_token) variables.push(`${origin}/doc/${doc.public_token}`)
    }
  }

  const response = await $fetch<{ messages?: { id: string }[] }>(
    `https://graph.facebook.com/v21.0/${account.whatsapp_phone_number_id}/messages`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${account.whatsapp_access_token}` },
      body: {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name: templateName, language: { code: templateLanguage }, components: [{ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: v })) }] },
      },
    },
  ).catch(() => null)

  await supabase.from('whatsapp_messages').insert({
    account_id: accountId,
    patient_id: patient.id,
    appointment_id: appointmentId ?? null,
    wamid: response?.messages?.[0]?.id ?? null,
    purpose: 'other',
    template_name: templateName,
    status: response ? 'sent' : 'failed',
  })
}

async function runEmailAction(patient: { first_name: string; last_name: string | null; email: string | null }, config: Record<string, any>) {
  const subject: string | undefined = config.subject
  const rawBody: string | undefined = config.body
  if (!subject || !rawBody || !patient.email) return

  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const mergePlain = (text: string) =>
    text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => (key === 'first_name' ? patient.first_name ?? '' : key === 'last_name' ? patient.last_name ?? '' : ''))
  const mergeHtml = (text: string) =>
    escapeHtml(text).replace(/\{\{(\w+)\}\}/g, (_, key: string) => (key === 'first_name' ? escapeHtml(patient.first_name ?? '') : key === 'last_name' ? escapeHtml(patient.last_name ?? '') : ''))

  const runtimeConfig = useRuntimeConfig()
  if (!runtimeConfig.resendApiKey) return

  const html = `
    <div style="background:#F4F4F6;padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
      <div style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:14px;border:1px solid #E4E4EA;overflow:hidden;">
        <div style="padding:24px 32px 32px;">
          <p style="margin:0;font-size:14px;line-height:1.6;color:#4A4A57;white-space:pre-wrap;">${mergeHtml(rawBody)}</p>
        </div>
      </div>
    </div>
  `

  await $fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${runtimeConfig.resendApiKey}`, 'Content-Type': 'application/json' },
    body: { from: 'QuiroFlow <notifications@quiroflow.com>', to: patient.email, subject: mergePlain(subject), html },
  }).catch(() => null)
}

async function runWebhookAction(config: Record<string, any>, body: FireBody) {
  const url: string | undefined = config.url
  if (!url) return

  const payload = {
    event: body.triggerEvent,
    fired_at: new Date().toISOString(),
    data: { patient_id: body.patientId, appointment_id: body.appointmentId ?? null, invoice_id: body.invoiceId ?? null },
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-QuiroFlow-Event': body.triggerEvent }
  if (config.secret) {
    headers['X-QuiroFlow-Signature'] = createHmac('sha256', config.secret).update(JSON.stringify(payload)).digest('hex')
  }

  await $fetch(url, { method: 'POST', headers, body: payload }).catch(() => null)
}

import { createHmac } from 'node:crypto'
import { toE164 } from '~/utils/phone'
import { renderTemplateFields } from '~/utils/docFields'

// Shared by both the trigger-based fire endpoint and the one-off "Send Now"
// endpoint: both ultimately just need to run one rule's actions for one
// patient. Kept here (server/utils/*.ts auto-imports into server routes per
// Nitro convention, same as requirePermission.ts) so neither endpoint
// duplicates the WhatsApp/email/webhook sending logic.
interface PatientForAction {
  id: string
  first_name: string
  last_name: string | null
  email: string | null
}
interface ActionRow {
  id: string
  action_type: 'whatsapp_template' | 'email' | 'webhook'
  config: Record<string, any>
}
interface TriggerBody {
  triggerEvent: string
  patientId: string
  appointmentId?: string
  invoiceId?: string
}

export async function runRuleActions(
  supabase: any,
  accountId: string,
  ruleId: string,
  patient: PatientForAction,
  origin: string,
  appointmentId?: string,
  triggerBody?: TriggerBody,
) {
  const { data: actions } = await supabase
    .from('automation_actions')
    .select('id, action_type, config')
    .eq('rule_id', ruleId)
    .order('position')

  for (const action of (actions ?? []) as ActionRow[]) {
    try {
      if (action.action_type === 'whatsapp_template') {
        await runWhatsAppAction(supabase, accountId, patient, action.config, origin, appointmentId)
      } else if (action.action_type === 'email') {
        await runEmailAction(patient, action.config)
      } else if (action.action_type === 'webhook') {
        await runWebhookAction(action.config, triggerBody ?? { triggerEvent: 'manual', patientId: patient.id, appointmentId })
      }
    } catch {
      // Best-effort: one failed action shouldn't stop the rest of the rule.
    }
  }
}

function patientFieldValue(patient: PatientForAction, source: string): string {
  if (source === 'first_name') return patient.first_name ?? ''
  if (source === 'last_name') return patient.last_name ?? ''
  if (source === 'email') return patient.email ?? ''
  return ''
}

async function runWhatsAppAction(
  supabase: any,
  accountId: string,
  patient: PatientForAction,
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

  // Each configured variable slot maps to a patient field (first_name,
  // last_name, email) or fixed text -- lets a template with more than one
  // {{n}} placeholder be filled correctly, matching however many variables
  // that specific template actually needs (Meta doesn't expose this to us
  // to validate against, so the config is where staff match it themselves).
  const configuredVariables: { source: string; text?: string }[] = Array.isArray(config.variables) && config.variables.length > 0
    ? config.variables
    : [{ source: 'first_name' }]
  const variables: string[] = configuredVariables.map((v) => (v.source === 'text' ? (v.text ?? '') : patientFieldValue(patient, v.source)))

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

async function runEmailAction(patient: PatientForAction, config: Record<string, any>) {
  const subject: string | undefined = config.subject
  const rawBody: string | undefined = config.body
  if (!subject || !rawBody || !patient.email) return

  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const mergePlain = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => patientFieldValue(patient, key))
  // rawBody is HTML produced by the account's own rich-text editor (bold/
  // italic/underline/image, no freeform tag entry), so unlike the plain
  // subject it's trusted and must NOT be escaped wholesale -- that would
  // turn every tag into literal text. Only the substituted variable values
  // (patient-controlled data) get escaped.
  const mergeHtml = (html: string) => html.replace(/\{\{(\w+)\}\}/g, (_, key: string) => escapeHtml(patientFieldValue(patient, key)))

  const runtimeConfig = useRuntimeConfig()
  if (!runtimeConfig.resendApiKey) return

  const html = `
    <div style="background:#F4F4F6;padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
      <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:14px;border:1px solid #E4E4EA;overflow:hidden;">
        <div style="padding:24px 32px 32px;font-size:14px;line-height:1.6;color:#4A4A57;">${mergeHtml(rawBody)}</div>
      </div>
    </div>
  `

  await $fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${runtimeConfig.resendApiKey}`, 'Content-Type': 'application/json' },
    body: { from: 'QuiroFlow <notifications@quiroflow.com>', to: patient.email, subject: mergePlain(subject), html },
  }).catch(() => null)
}

async function runWebhookAction(config: Record<string, any>, body: TriggerBody) {
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

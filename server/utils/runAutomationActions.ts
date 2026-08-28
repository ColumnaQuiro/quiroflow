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
  is_minor?: boolean
  do_not_contact?: boolean
  marketing_channels?: string[]
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
  membershipId?: string
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
  const [{ data: rule }, { data: actions }] = await Promise.all([
    supabase.from('automation_rules').select('is_marketing').eq('id', ruleId).maybeSingle(),
    supabase.from('automation_actions').select('id, action_type, config').eq('rule_id', ruleId).order('position'),
  ])

  await runActionsList(supabase, accountId, (actions ?? []) as ActionRow[], patient, origin, rule?.is_marketing ?? false, appointmentId, triggerBody)
}

// Split out from runRuleActions so a caller that already has an in-memory
// list of actions (the editor drawer's "Send test to me", which tests the
// unsaved draft on screen) can run them without needing a persisted
// automation_actions/automation_rules row to read back -- test sends
// shouldn't have the side effect of writing a real, enabled rule to the
// database just so it can be read back out again.
export async function runActionsList(
  supabase: any,
  accountId: string,
  actions: ActionRow[],
  patient: PatientForAction,
  origin: string,
  isMarketing = false,
  appointmentId?: string,
  triggerBody?: TriggerBody,
  whatsappOverrideNumber?: string,
) {
  // Minors and do-not-contact patients get no communications -- webhook
  // actions still run since those are internal side effects, not messages
  // sent to the patient.
  const canContact = !patient.is_minor && !patient.do_not_contact
  // Marketing rules (patient.birthday campaigns, or any rule staff has
  // explicitly flagged as promotional rather than transactional) only reach
  // patients who've opted that channel in via marketing_channels -- LSSI-CE
  // and GDPR require real opt-in for unsolicited commercial communications,
  // distinct from transactional ones like an appointment confirmation.
  const channelAllowed = (channel: string) => !isMarketing || (patient.marketing_channels ?? []).includes(channel)

  // Resolved once per rule firing (not per-action) since the {{next_appointment}}
  // merge token always refers to the appointment that triggered this rule --
  // there's no other appointment in scope an email action could mean instead.
  let nextAppointmentAt: string | undefined
  if (appointmentId) {
    const { data: appt } = await supabase.from('appointments').select('starts_at').eq('id', appointmentId).maybeSingle()
    nextAppointmentAt = appt?.starts_at ?? undefined
  }

  for (const action of actions) {
    try {
      if (action.action_type === 'whatsapp_template') {
        if (canContact && channelAllowed('whatsapp')) await runWhatsAppAction(supabase, accountId, patient, action.config, origin, appointmentId, whatsappOverrideNumber)
      } else if (action.action_type === 'email') {
        if (canContact && channelAllowed('email')) await runEmailAction(patient, action.config, { nextAppointmentAt })
      } else if (action.action_type === 'webhook') {
        await runWebhookAction(action.config, triggerBody ?? { triggerEvent: 'manual', patientId: patient.id, appointmentId })
      }
    } catch {
      // Best-effort: one failed action shouldn't stop the rest of the rule.
    }
  }
}

interface MergeContext { nextAppointmentAt?: string }

function patientFieldValue(patient: PatientForAction, source: string, context?: MergeContext): string {
  if (source === 'first_name') return patient.first_name ?? ''
  if (source === 'last_name') return patient.last_name ?? ''
  if (source === 'email') return patient.email ?? ''
  if (source === 'next_appointment') {
    if (!context?.nextAppointmentAt) return ''
    return new Date(context.nextAppointmentAt).toLocaleString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  return ''
}

async function runWhatsAppAction(
  supabase: any,
  accountId: string,
  patient: PatientForAction,
  config: Record<string, any>,
  origin: string,
  appointmentId?: string,
  toOverride?: string,
) {
  const templateName: string | undefined = config.template_name
  const templateLanguage: string = config.template_language || 'es'
  if (!templateName) return

  const { data: account } = await supabase
    .from('accounts')
    .select('whatsapp_phone_number_id, whatsapp_access_token, whatsapp_business_account_id')
    .eq('id', accountId)
    .maybeSingle()
  if (!account?.whatsapp_phone_number_id || !account?.whatsapp_access_token) return

  let to = toOverride
  if (!to) {
    const { data: numbers } = await supabase
      .from('patient_contact_numbers')
      .select('number, country_code, is_whatsapp')
      .eq('patient_id', patient.id)
    const target = numbers?.find((n: any) => n.is_whatsapp) ?? numbers?.[0]
    if (!target) return
    to = toE164(target.number, target.country_code) ?? undefined
  }
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

  // Fetch the live approved template so the send always matches what Meta
  // actually expects, rather than trusting the staff-entered config alone:
  // (a) a template can carry URL buttons whose link needs a per-recipient
  // suffix -- Meta requires a "button" component for every URL button that
  // has a {{n}} placeholder, or the whole send is rejected with error
  // 131008 "Required parameter is missing" (found via new_patient_arrived_tasks's
  // onboarding-form links, built this way); the approved template's own Meta
  // example for these buttons is a `?name=<name>&id=<id>` query string, so
  // that's what's sent here too. (b) the body's own placeholder count can
  // differ from what staff configured (e.g. new_patient_arrived_tasks_2 has
  // no {{n}} at all but was configured with a first_name slot anyway),
  // which Meta rejects with error 132000 "Number of parameters does not
  // match" -- so the configured variables are trimmed/padded to match.
  const bodyComponents: Record<string, any>[] = []
  const buttonComponents: Record<string, any>[] = []
  if (account.whatsapp_business_account_id) {
    const templates = await $fetch<{ data: { name: string; language: string; components: any[] }[] }>(
      `https://graph.facebook.com/v21.0/${account.whatsapp_business_account_id}/message_templates`,
      { params: { name: templateName, fields: 'name,language,components' }, headers: { Authorization: `Bearer ${account.whatsapp_access_token}` } },
    ).catch(() => null)
    // Meta's `name` query param is a fuzzy/substring match, not an exact
    // filter -- e.g. querying "new_patient_arrived_tasks" also returns
    // "new_patient_arrived_tasks_2" -- so the exact name has to be checked
    // again client-side or the wrong template's body/buttons get used.
    const candidates = (templates?.data ?? []).filter((t: { name: string }) => t.name === templateName)
    const match = candidates.find((t: { language: string }) => t.language === templateLanguage) ?? candidates[0]

    const bodyText: string = match?.components?.find((c: any) => c.type === 'BODY')?.text ?? ''
    const bodySlots = new Set<string>()
    for (const m of bodyText.matchAll(/\{\{(\d+)\}\}/g)) bodySlots.add(m[1])
    if (bodySlots.size > 0) {
      const trimmed = Array.from({ length: bodySlots.size }, (_, i) => variables[i] ?? patient.first_name ?? '')
      bodyComponents.push({ type: 'body', parameters: trimmed.map((v) => ({ type: 'text', text: v })) })
    }

    const buttons = match?.components?.find((c: any) => c.type === 'BUTTONS')?.buttons ?? []
    buttons.forEach((b: any, index: number) => {
      if (b.type === 'URL' && /\{\{\d+\}\}/.test(b.url ?? '')) {
        buttonComponents.push({
          type: 'button',
          sub_type: 'url',
          index: String(index),
          parameters: [{ type: 'text', text: `name=${encodeURIComponent(patient.first_name ?? '')}&id=${patient.id}` }],
        })
      }
    })
  } else if (variables.length > 0) {
    // No business-account id on file to look the template up against --
    // fall back to sending exactly what was configured, same as before.
    bodyComponents.push({ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: v })) })
  }

  let wamid: string | null = null
  let errorMessage: string | null = null
  try {
    const response = await $fetch<{ messages?: { id: string }[] }>(
      `https://graph.facebook.com/v21.0/${account.whatsapp_phone_number_id}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${account.whatsapp_access_token}` },
        body: {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: templateLanguage },
            components: [...bodyComponents, ...buttonComponents],
          },
        },
      },
    )
    wamid = response?.messages?.[0]?.id ?? null
  } catch (e: any) {
    errorMessage = e?.data?.error?.message ?? e?.message ?? 'Unknown error'
  }

  await supabase.from('whatsapp_messages').insert({
    account_id: accountId,
    patient_id: patient.id,
    appointment_id: appointmentId ?? null,
    wamid,
    purpose: 'other',
    template_name: templateName,
    status: wamid ? 'sent' : 'failed',
    error_message: errorMessage,
    phone_number: to,
  })
}

async function runEmailAction(patient: PatientForAction, config: Record<string, any>, context?: MergeContext) {
  const subject: string | undefined = config.subject
  const rawBody: string | undefined = config.body
  if (!subject || !rawBody || !patient.email) return

  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const mergePlain = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => patientFieldValue(patient, key, context))
  // rawBody is HTML produced by the account's own rich-text editor (bold/
  // italic/underline/image, no freeform tag entry), so unlike the plain
  // subject it's trusted and must NOT be escaped wholesale -- that would
  // turn every tag into literal text. Only the substituted variable values
  // (patient-controlled data) get escaped.
  const mergeHtml = (html: string) => html.replace(/\{\{(\w+)\}\}/g, (_, key: string) => escapeHtml(patientFieldValue(patient, key, context)))

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

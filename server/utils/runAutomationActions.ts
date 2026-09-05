import { createHmac } from 'node:crypto'
import { toE164 } from '~/utils/phone'
import { renderTemplateFields } from '~/utils/docFields'

// The server runs in UTC, so formatting a UTC Date with toLocaleString and no
// timeZone renders the UTC wall-clock time, not the clinic's -- a booking at
// 16:00 Madrid time (CEST, UTC+2) would merge into a message as "14:00".
// There's no per-account timezone column yet, so this is hardcoded the same
// way same-day-cron.post.ts and appointmentNotifications.ts hardcode it.
const CLINIC_TIMEZONE = 'Europe/Madrid'

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
  extraContext?: Partial<MergeContext>,
) {
  const [{ data: rule }, { data: actions }] = await Promise.all([
    supabase.from('automation_rules').select('is_marketing').eq('id', ruleId).maybeSingle(),
    supabase.from('automation_actions').select('id, action_type, config').eq('rule_id', ruleId).order('position'),
  ])

  await runActionsList(supabase, accountId, (actions ?? []) as ActionRow[], patient, origin, rule?.is_marketing ?? false, appointmentId, triggerBody, undefined, extraContext)
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
  // Caller-supplied merge values that can't be derived from appointmentId/
  // accountId alone -- e.g. waitlistOffer.ts's claim link and slot time,
  // which describe an appointment that doesn't exist as a row yet (claiming
  // is what creates it). Auto-resolved fields below still win their own keys
  // unconditionally rather than merging under extraContext, since only
  // waitlistOffer.ts (which never sets appointmentId) has any reason to pass
  // those two keys.
  extraContext?: Partial<MergeContext>,
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
  // Also resolved once per firing, not per-action -- backs {{google_review_link}}
  // for the appointment.review_request campaign (and any other campaign that
  // wants it). A cheap extra query even when unused, same tradeoff as
  // nextAppointmentAt above, kept simple rather than conditioned on whether
  // any action actually references the token.
  const { data: account } = await supabase.from('accounts').select('google_review_url').eq('id', accountId).maybeSingle()
  const googleReviewUrl: string | undefined = account?.google_review_url ?? undefined

  const context: MergeContext = { ...extraContext, nextAppointmentAt, googleReviewUrl }

  for (const action of actions) {
    try {
      if (action.action_type === 'whatsapp_template') {
        if (canContact && channelAllowed('whatsapp')) await runWhatsAppAction(supabase, accountId, patient, action.config, origin, appointmentId, whatsappOverrideNumber, context)
      } else if (action.action_type === 'email') {
        if (canContact && channelAllowed('email')) await runEmailAction(patient, action.config, context)
      } else if (action.action_type === 'webhook') {
        await runWebhookAction(action.config, triggerBody ?? { triggerEvent: 'manual', patientId: patient.id, appointmentId })
      }
    } catch {
      // Best-effort: one failed action shouldn't stop the rest of the rule.
    }
  }
}

interface MergeContext { nextAppointmentAt?: string; googleReviewUrl?: string; waitlistClaimLink?: string; waitlistSlotDatetime?: string }

function patientFieldValue(patient: PatientForAction, source: string, context?: MergeContext): string {
  if (source === 'first_name') return patient.first_name ?? ''
  if (source === 'last_name') return patient.last_name ?? ''
  if (source === 'email') return patient.email ?? ''
  if (source === 'google_review_link') return context?.googleReviewUrl ?? ''
  if (source === 'waitlist_claim_link') return context?.waitlistClaimLink ?? ''
  if (source === 'waitlist_slot_datetime') return context?.waitlistSlotDatetime ?? ''
  if (source === 'next_appointment') {
    if (!context?.nextAppointmentAt) return ''
    return new Date(context.nextAppointmentAt).toLocaleString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: CLINIC_TIMEZONE })
  }
  // Split date/time -- some WhatsApp templates (Meta's own approved
  // "appointment_reminder" among them) have separate {{n}} slots for the
  // date and the time rather than one combined string like next_appointment.
  if (source === 'appointment_date') {
    if (!context?.nextAppointmentAt) return ''
    return new Date(context.nextAppointmentAt).toLocaleString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: CLINIC_TIMEZONE })
  }
  if (source === 'appointment_time') {
    if (!context?.nextAppointmentAt) return ''
    return new Date(context.nextAppointmentAt).toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: CLINIC_TIMEZONE })
  }
  return ''
}

// Creates the patient's copy of a doc template (health history, consent,
// etc.) and returns its public_token, or null if the template is gone.
// Returns just the token, not the full URL, since callers need it in two
// shapes: appended as `${origin}/doc/${token}` in a message body, or as the
// bare token substituted into a WhatsApp URL button's {{n}} placeholder
// (Meta stores the rest of the URL, e.g. ".../doc/{{1}}", on the button itself).
async function generateDocLink(supabase: any, accountId: string, patient: PatientForAction, docTemplateId: string): Promise<string | null> {
  const { data: template } = await supabase.from('doc_templates').select('title, fields').eq('id', docTemplateId).maybeSingle()
  if (!template) return null
  const rendered = renderTemplateFields(template.fields, {
    first_name: patient.first_name ?? '',
    last_name: patient.last_name ?? '',
    email: patient.email ?? '',
  })
  const { data: doc } = await supabase
    .from('patient_docs')
    .insert({ account_id: accountId, patient_id: patient.id, title: template.title, fields: rendered, template_id: docTemplateId })
    .select('public_token')
    .single()
  return doc?.public_token ?? null
}

async function runWhatsAppAction(
  supabase: any,
  accountId: string,
  patient: PatientForAction,
  config: Record<string, any>,
  origin: string,
  appointmentId?: string,
  toOverride?: string,
  context?: MergeContext,
) {
  const templateName: string | undefined = config.template_name
  const templateLanguage: string = config.template_language || 'es'
  if (!templateName) return

  const { data: account } = await supabase
    .from('accounts')
    .select(
      'whatsapp_phone_number_id, whatsapp_access_token, whatsapp_business_account_id, whatsapp_confirmation_template_name, whatsapp_reminder_template_name, whatsapp_recall_template_name',
    )
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
  const variables: string[] = configuredVariables.map((v) => (v.source === 'text' ? (v.text ?? '') : patientFieldValue(patient, v.source, context)))

  // One doc-template slot per configured link. A template with URL buttons
  // that carry a {{n}} placeholder maps each slot to a button by position
  // (new_patient_arrived_tasks has two separate "fill this form" buttons);
  // a template with no such buttons instead treats slot 0 (if set) as one
  // more body variable, appended last -- the original single-link design.
  const docTemplateIds: (string | null)[] = Array.isArray(config.doc_template_ids) ? config.doc_template_ids : []

  // Fetch the live approved template so the send always matches what Meta
  // actually expects, rather than trusting the staff-entered config alone:
  // (a) a template can carry URL buttons whose link needs a per-recipient
  // suffix -- Meta requires a "button" component for every URL button that
  // has a {{n}} placeholder, or the whole send is rejected with error
  // 131008 "Required parameter is missing" (found via new_patient_arrived_tasks's
  // onboarding-form links, built this way); a button with no doc template
  // configured for its slot falls back to Meta's own example suffix for
  // these buttons, a `?name=<name>&id=<id>` query string. (b) the body's own
  // placeholder count can differ from what staff configured (e.g.
  // new_patient_arrived_tasks_2 has no {{n}} at all but was configured with
  // a first_name slot anyway), which Meta rejects with error 132000 "Number
  // of parameters does not match" -- so the configured variables are
  // trimmed/padded to match.
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

    const buttons = match?.components?.find((c: any) => c.type === 'BUTTONS')?.buttons ?? []
    const dynamicUrlButtonIndexes = buttons
      .map((b: any, index: number) => ({ b, index }))
      .filter(({ b }: any) => b.type === 'URL' && /\{\{\d+\}\}/.test(b.url ?? ''))
      .map(({ index }: any) => index)

    // No dynamic URL button to attach a doc link to -- fall back to the
    // older behaviour of tacking it onto the message body instead.
    if (dynamicUrlButtonIndexes.length === 0 && docTemplateIds[0]) {
      const token = await generateDocLink(supabase, accountId, patient, docTemplateIds[0])
      if (token) variables.push(`${origin}/doc/${token}`)
    }

    const bodyText: string = match?.components?.find((c: any) => c.type === 'BODY')?.text ?? ''
    const bodySlots = new Set<string>()
    for (const m of bodyText.matchAll(/\{\{(\d+)\}\}/g)) bodySlots.add(m[1])
    if (bodySlots.size > 0) {
      const trimmed = Array.from({ length: bodySlots.size }, (_, i) => variables[i] ?? patient.first_name ?? '')
      bodyComponents.push({ type: 'body', parameters: trimmed.map((v) => ({ type: 'text', text: v })) })
    }

    for (let i = 0; i < dynamicUrlButtonIndexes.length; i++) {
      const docTemplateId = docTemplateIds[i]
      const token = docTemplateId ? await generateDocLink(supabase, accountId, patient, docTemplateId) : null
      const paramText = token ? token : `name=${encodeURIComponent(patient.first_name ?? '')}&id=${patient.id}`
      buttonComponents.push({ type: 'button', sub_type: 'url', index: String(dynamicUrlButtonIndexes[i]), parameters: [{ type: 'text', text: paramText }] })
    }
  } else {
    // No business-account id on file to look the template up against --
    // fall back to sending exactly what was configured, same as before.
    if (docTemplateIds[0]) {
      const token = await generateDocLink(supabase, accountId, patient, docTemplateIds[0])
      if (token) variables.push(`${origin}/doc/${token}`)
    }
    if (variables.length > 0) bodyComponents.push({ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: v })) })
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

  // Does this template ask the patient to confirm? Both the account's
  // confirmation and reminder templates carry the Confirmar/Cambiar/Cancelar
  // reply buttons; everything else an automation might send (first-visit
  // info, arrival tasks...) happens to be appointment-linked too but asks
  // for nothing, so it must not touch confirmation state.
  const asksForConfirmation =
    templateName === account.whatsapp_confirmation_template_name || templateName === account.whatsapp_reminder_template_name

  // NB purpose stays on the schema's existing confirmation/recall/other set.
  // A reminder is really its own purpose, but 'reminder' isn't allowed by
  // whatsapp_messages_purpose_check yet -- widening that is a schema change,
  // tracked separately rather than smuggled into this fix.
  const purpose =
    templateName === account.whatsapp_confirmation_template_name
      ? 'confirmation'
      : templateName === account.whatsapp_recall_template_name
        ? 'recall'
        : 'other'

  await supabase.from('whatsapp_messages').insert({
    account_id: accountId,
    patient_id: patient.id,
    appointment_id: appointmentId ?? null,
    wamid,
    purpose,
    template_name: templateName,
    status: wamid ? 'sent' : 'failed',
    error_message: errorMessage,
    phone_number: to,
  })

  // A confirmation/reminder template carries the Confirmar/Cambiar/Cancelar
  // reply buttons, so the appointment has to be marked 'pending' before it
  // goes out -- the webhook resolves "which appointment is this reply about"
  // partly off that flag, and until this was set an automation-sent reminder
  // (e.g. a "3 days before" rule, which fires well before the built-in 24h
  // reminder has set it) left the appointment at NULL, so a genuine
  // "Confirmar" reply silently no-opped. appointmentNotifications.ts already
  // does this for the built-in sends; this is the same guard for the
  // automation-rule path. Skip if the patient already confirmed, so a later
  // reminder doesn't reset them back to unconfirmed.
  if (wamid && appointmentId && asksForConfirmation) {
    const { data: current } = await supabase.from('appointments').select('confirmation_status').eq('id', appointmentId).maybeSingle()
    if (current?.confirmation_status !== 'confirmed') {
      await supabase.from('appointments').update({ confirmation_status: 'pending' }).eq('id', appointmentId)
    }
  }
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

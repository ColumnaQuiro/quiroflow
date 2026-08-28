import { toE164 } from '~/utils/phone'
import { sendResendEmail } from './resend'

// Automatic appointment confirmation/reminder sends (Settings > Communication
// > General). Deliberately its own small module rather than routed through
// runAutomationActions.ts's runActionsList: unlike a staff-built automation
// rule, a confirmation send also needs to flip appointments.confirmation_status
// to 'pending' (the same thing the manual send in whatsapp/send.post.ts does)
// and log to contact_log, neither of which the generic automation runner does.
// Kept in server/utils/*.ts so it auto-imports into server routes per Nitro
// convention, same as requirePermission.ts and runAutomationActions.ts.

interface AppointmentContext {
  id: string
  accountId: string
  patientId: string
  startsAt: string
  practitionerName: string
  appointmentTypeName: string
  patientFirstName: string
  patientLastName: string | null
  patientEmail: string | null
  patientPreferredLanguage: string | null
  patientIsMinor: boolean
  patientDoNotContact: boolean
}

async function loadAppointmentContext(supabase: any, appointmentId: string): Promise<AppointmentContext | null> {
  const { data } = await supabase
    .from('appointments')
    .select(
      'id, account_id, patient_id, starts_at, team_members(full_name), appointment_types(name), patients(first_name, last_name, email, preferred_language, is_minor, do_not_contact)',
    )
    .eq('id', appointmentId)
    .maybeSingle()
  if (!data || !data.patients) return null

  return {
    id: data.id,
    accountId: data.account_id,
    patientId: data.patient_id,
    startsAt: data.starts_at,
    practitionerName: data.team_members?.full_name ?? '',
    appointmentTypeName: data.appointment_types?.name ?? '',
    patientFirstName: data.patients.first_name ?? '',
    patientLastName: data.patients.last_name ?? null,
    patientEmail: data.patients.email ?? null,
    patientPreferredLanguage: data.patients.preferred_language ?? null,
    patientIsMinor: !!data.patients.is_minor,
    patientDoNotContact: !!data.patients.do_not_contact,
  }
}

function mergeText(template: string, ctx: AppointmentContext, escape = false): string {
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const wrap = (s: string) => (escape ? escapeHtml(s) : s)
  const appointmentDate = new Date(ctx.startsAt).toLocaleString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (key === 'first_name') return wrap(ctx.patientFirstName)
    if (key === 'last_name') return wrap(ctx.patientLastName ?? '')
    if (key === 'next_appointment') return wrap(appointmentDate)
    if (key === 'practitioner_name') return wrap(ctx.practitionerName)
    if (key === 'appointment_type_name') return wrap(ctx.appointmentTypeName)
    return ''
  })
}

interface MetaTemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS'
  text?: string
}
interface MetaTemplate {
  name: string
  language: string
  components: MetaTemplateComponent[]
}

// A template name isn't unique on its own -- Meta approves one language
// variant at a time under the same name (e.g. "appointment_reminder" in
// es/en/fr, as seen in Settings > WhatsApp's own template list), so sending
// in the patient's own language means picking the right *variant*, not just
// resending the account's stored default. Same fallback order
// SendWhatsAppModal.vue already uses for a manual send: exact language match,
// then a locale-prefix match (e.g. patient 'en' against template 'en_US'),
// then the account's configured default language, then whatever's left.
async function resolveTemplateVariant(
  businessAccountId: string,
  accessToken: string,
  templateName: string,
  accountDefaultLanguage: string,
  patientPreferredLanguage: string | null,
): Promise<{ language: string; bodyText: string } | null> {
  const response = await $fetch<{ data: MetaTemplate[] }>(`https://graph.facebook.com/v21.0/${businessAccountId}/message_templates`, {
    params: { fields: 'name,language,components', limit: 100 },
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const candidates: MetaTemplate[] = (response.data ?? []).filter((t: MetaTemplate) => t.name === templateName)
  if (candidates.length === 0) return null

  const match: MetaTemplate =
    (patientPreferredLanguage && candidates.find((t: MetaTemplate) => t.language === patientPreferredLanguage)) ||
    (patientPreferredLanguage && candidates.find((t: MetaTemplate) => t.language.split('_')[0] === patientPreferredLanguage)) ||
    candidates.find((t: MetaTemplate) => t.language === accountDefaultLanguage) ||
    candidates[0]

  return { language: match.language, bodyText: match.components.find((c: MetaTemplateComponent) => c.type === 'BODY')?.text ?? '' }
}

// Meta template variables are positional ({{1}}, {{2}}...), not named merge
// tags -- fill them with the most generally-useful values in a fixed order
// (name, date, time, type, practitioner). Date and time are split into their
// own slots because the one template actually in use for this
// (appointment_reminder: "el día {{2}} a las {{3}}h") needs them separate.
// Meta rejects a template send outright (error 131008) if any parameter is
// an empty string, so a slot beyond what we have -- or one whose real value
// is empty, e.g. an appointment with no practitioner assigned -- falls back
// to the patient's first name rather than '' to keep the send from failing.
function resolveWhatsAppVariables(bodyText: string, ctx: AppointmentContext): string[] {
  const start = new Date(ctx.startsAt)
  const dateOnly = start.toLocaleString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
  const timeOnly = start.toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit' })
  const guesses = [ctx.patientFirstName, dateOnly, timeOnly, ctx.appointmentTypeName, ctx.practitionerName]
  const slots = new Set<string>()
  for (const m of bodyText.matchAll(/\{\{(\d+)\}\}/g)) slots.add(m[1])
  return Array.from({ length: slots.size }, (_, i) => guesses[i] || ctx.patientFirstName)
}

async function sendWhatsApp(
  supabase: any,
  ctx: AppointmentContext,
  purpose: 'confirmation' | 'reminder',
  templateName: string,
  templateLanguage: string,
): Promise<void> {
  const { data: account } = await supabase
    .from('accounts')
    .select('whatsapp_phone_number_id, whatsapp_business_account_id, whatsapp_access_token')
    .eq('id', ctx.accountId)
    .maybeSingle()
  if (!account?.whatsapp_phone_number_id || !account?.whatsapp_access_token) return

  const { data: numbers } = await supabase
    .from('patient_contact_numbers')
    .select('number, country_code, is_whatsapp')
    .eq('patient_id', ctx.patientId)
  const target = numbers?.find((n: any) => n.is_whatsapp) ?? numbers?.[0]
  if (!target) return
  const to = toE164(target.number, target.country_code)
  if (!to) return

  let resolvedLanguage = templateLanguage
  let bodyText = ''
  try {
    const variant = await resolveTemplateVariant(account.whatsapp_business_account_id ?? '', account.whatsapp_access_token, templateName, templateLanguage, ctx.patientPreferredLanguage)
    if (variant) {
      resolvedLanguage = variant.language
      bodyText = variant.bodyText
    }
  } catch {
    // Best-effort: fall back to the account's stored default language/variable
    // count (1 slot, first_name) rather than failing the send outright.
  }
  const variables = resolveWhatsAppVariables(bodyText, ctx)

  let wamid: string | null = null
  let status = 'sent'
  let errorMessage: string | null = null
  try {
    const response = await $fetch<{ messages?: { id: string }[] }>(`https://graph.facebook.com/v21.0/${account.whatsapp_phone_number_id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${account.whatsapp_access_token}` },
      body: {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name: templateName, language: { code: resolvedLanguage }, components: [{ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: v })) }] },
      },
    })
    wamid = response?.messages?.[0]?.id ?? null
  } catch (e: any) {
    status = 'failed'
    errorMessage = e?.data?.error?.message ?? e?.message ?? 'Unknown error'
  }

  await Promise.all([
    supabase.from('contact_log').insert({
      account_id: ctx.accountId,
      patient_id: ctx.patientId,
      appointment_id: ctx.id,
      action: 'sent_whatsapp',
      note: `Template: ${templateName} (automatic ${purpose})`,
      created_by: null,
    }),
    supabase.from('whatsapp_messages').insert({
      account_id: ctx.accountId,
      patient_id: ctx.patientId,
      appointment_id: ctx.id,
      phone_number: to,
      wamid,
      purpose,
      template_name: templateName,
      status,
      error_message: errorMessage,
    }),
  ])

  if (purpose === 'confirmation' && status === 'sent') {
    await supabase.from('appointments').update({ confirmation_status: 'pending' }).eq('id', ctx.id)
  }
}

async function sendEmail(ctx: AppointmentContext, subject: string, body: string): Promise<void> {
  if (!ctx.patientEmail) return
  const html = `
    <div style="background:#F4F4F6;padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
      <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:14px;border:1px solid #E4E4EA;overflow:hidden;">
        <div style="padding:24px 32px 32px;font-size:14px;line-height:1.6;color:#4A4A57;">${mergeText(body, ctx, true)}</div>
      </div>
    </div>
  `
  await sendResendEmail({ to: ctx.patientEmail, subject: mergeText(subject, ctx), html })
}

interface CommunicationSettings {
  enabled: boolean
  channels: string[]
  emailSubject: string | null
  emailBody: string | null
  whatsappTemplateName: string | null
  whatsappTemplateLanguage: string
}

async function sendForPurpose(supabase: any, appointmentId: string, purpose: 'confirmation' | 'reminder', settings: CommunicationSettings): Promise<boolean> {
  if (!settings.enabled) return false
  const ctx = await loadAppointmentContext(supabase, appointmentId)
  if (!ctx || ctx.patientIsMinor || ctx.patientDoNotContact) return false

  let sent = false
  if (settings.channels.includes('whatsapp') && settings.whatsappTemplateName) {
    try {
      await sendWhatsApp(supabase, ctx, purpose, settings.whatsappTemplateName, settings.whatsappTemplateLanguage)
      sent = true
    } catch {
      // Best-effort: a failed channel shouldn't block the other one.
    }
  }
  if (settings.channels.includes('email') && settings.emailSubject && settings.emailBody) {
    try {
      await sendEmail(ctx, settings.emailSubject, settings.emailBody)
      sent = true
    } catch {
      // Best-effort, same as above.
    }
  }
  return sent
}

export async function sendAppointmentConfirmation(supabase: any, accountId: string, appointmentId: string): Promise<void> {
  const { data: account } = await supabase
    .from('accounts')
    .select('appointment_confirmation_enabled, appointment_confirmation_channels, email_confirmation_subject, email_confirmation_body, whatsapp_confirmation_template_name, whatsapp_confirmation_template_language')
    .eq('id', accountId)
    .maybeSingle()
  if (!account) return

  const sent = await sendForPurpose(supabase, appointmentId, 'confirmation', {
    enabled: account.appointment_confirmation_enabled,
    channels: account.appointment_confirmation_channels ?? [],
    emailSubject: account.email_confirmation_subject,
    emailBody: account.email_confirmation_body,
    whatsappTemplateName: account.whatsapp_confirmation_template_name,
    whatsappTemplateLanguage: account.whatsapp_confirmation_template_language ?? 'es',
  })
  if (sent) await supabase.from('appointments').update({ confirmation_sent_at: new Date().toISOString() }).eq('id', appointmentId)
}

export async function sendAppointmentReminder(supabase: any, accountId: string, appointmentId: string): Promise<void> {
  const { data: account } = await supabase
    .from('accounts')
    .select('appointment_reminder_enabled, appointment_reminder_channels, email_reminder_subject, email_reminder_body, whatsapp_reminder_template_name, whatsapp_reminder_template_language')
    .eq('id', accountId)
    .maybeSingle()
  if (!account) return

  const sent = await sendForPurpose(supabase, appointmentId, 'reminder', {
    enabled: account.appointment_reminder_enabled,
    channels: account.appointment_reminder_channels ?? [],
    emailSubject: account.email_reminder_subject,
    emailBody: account.email_reminder_body,
    whatsappTemplateName: account.whatsapp_reminder_template_name,
    whatsappTemplateLanguage: account.whatsapp_reminder_template_language ?? 'es',
  })
  if (sent) await supabase.from('appointments').update({ reminder_sent_at: new Date().toISOString() }).eq('id', appointmentId)
}

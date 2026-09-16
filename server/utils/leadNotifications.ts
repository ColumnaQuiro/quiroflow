import { resolveTemplateVariant } from './appointmentNotifications'
import { sendResendEmail } from './resend'
import { sendWhatsAppTemplate, sendWhatsAppText } from './whatsappSend'

/**
 * Tells the clinic a lead has arrived, by email and/or WhatsApp.
 *
 * Replaces the Slack post n8n has been making since December. The leads board
 * already lists every enquiry; what it cannot do is interrupt somebody. A
 * lead that sits unnoticed for four hours is the failure this tier exists to
 * prevent, and the drip answering instantly does not help if nobody human
 * follows up.
 *
 * Modelled on notifyStaffOfOnlineBooking, down to the column names -- it is
 * the same problem and should not look like a different one.
 *
 * Best-effort throughout. The enquiry is already saved by the time this runs,
 * and it is the thing that cannot be recovered; a Resend outage or an expired
 * WhatsApp token must not turn a captured lead into a 500 and a retry from
 * whatever posted it.
 */
export async function notifyStaffOfNewLead(supabase: any, accountId: string, leadId: string): Promise<void> {
  const { data: account } = await supabase
    .from('accounts')
    .select(
      'new_lead_notify_email, new_lead_notify_whatsapp, whatsapp_phone_number_id, whatsapp_business_account_id, whatsapp_access_token, new_lead_notify_whatsapp_template_name, new_lead_notify_whatsapp_template_language',
    )
    .eq('id', accountId)
    .maybeSingle()
  if (!account?.new_lead_notify_email && !account?.new_lead_notify_whatsapp) return

  const { data: lead } = await supabase
    .from('leads')
    .select('reference, full_name, phone, email, source')
    .eq('id', leadId)
    .maybeSingle()
  if (!lead) return

  const name = (lead.full_name ?? '').trim() || 'Sin nombre'
  // Phone and email are both optional on a lead and at least one is always
  // present, so the line is built from whichever exist rather than printing
  // an empty bracket.
  const contact = [lead.phone, lead.email].filter(Boolean).join(' · ')
  const summary = `Nuevo lead: ${name}${contact ? ` (${contact})` : ''}${lead.source ? ` — ${lead.source}` : ''}.`

  if (account.new_lead_notify_email) {
    try {
      await sendResendEmail({
        to: account.new_lead_notify_email,
        subject: `Nuevo lead: ${name}`,
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:#4A4A57;line-height:1.6;">${escapeHtml(summary)}</div>`,
      })
    } catch {
      // Best-effort, see above.
    }
  }

  if (account.new_lead_notify_whatsapp && account.whatsapp_phone_number_id && account.whatsapp_access_token) {
    const whatsappAccount = {
      whatsapp_phone_number_id: account.whatsapp_phone_number_id,
      whatsapp_access_token: account.whatsapp_access_token,
    }
    try {
      if (account.new_lead_notify_whatsapp_template_name) {
        const templateLanguage = account.new_lead_notify_whatsapp_template_language ?? 'es'
        let bodyText = ''
        try {
          const variant = await resolveTemplateVariant(
            account.whatsapp_business_account_id ?? '',
            account.whatsapp_access_token,
            account.new_lead_notify_whatsapp_template_name,
            templateLanguage,
            null,
          )
          if (variant) bodyText = variant.bodyText
        } catch {
          // bodyText stays '', so no {{n}} slots are found and the template
          // sends with no body variables -- same fallback as the booking one.
        }
        await sendWhatsAppTemplate(
          whatsappAccount,
          account.new_lead_notify_whatsapp,
          account.new_lead_notify_whatsapp_template_name,
          templateLanguage,
          resolveLeadNotifyVariables(bodyText, { name, phone: lead.phone, email: lead.email, source: lead.source, reference: lead.reference }),
        )
      } else {
        await sendWhatsAppText(whatsappAccount, account.new_lead_notify_whatsapp, summary)
      }
    } catch {
      // With no template configured the likeliest failure is the notify
      // number not having messaged the clinic's WhatsApp number in the last
      // 24h, which the settings screen calls out as a WhatsApp platform rule.
    }
  }
}

interface LeadNotifyFields {
  name: string
  phone: string | null
  email: string | null
  source: string | null
  reference: string | null
}

/**
 * Fills a template's {{1}}, {{2}}… in the order the fields are listed here.
 *
 * Positional because Meta templates are positional -- there are no named
 * variables to match against. Same guessing approach, and the same
 * limitation, as resolveStaffNotifyVariables: it only produces the right
 * message if the template was written in this order, which is why the
 * settings screen names the order.
 */
function resolveLeadNotifyVariables(bodyText: string, lead: LeadNotifyFields): string[] {
  const guesses = [lead.name, lead.phone ?? '', lead.email ?? '', lead.source ?? '', lead.reference ?? '']
  const slots = new Set<string>()
  for (const m of bodyText.matchAll(/\{\{(\d+)\}\}/g)) slots.add(m[1]!)
  return Array.from({ length: slots.size }, (_, i) => guesses[i] || lead.name)
}

/**
 * A lead's name and source are whatever the ad platform sent, so they reach
 * this email unescaped otherwise -- `&` in a campaign name is enough to
 * break the markup without anybody doing it on purpose.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// A receipt or a factura sent over WhatsApp: "Send by WhatsApp" beside "Send
// by email" (server/api/invoices/[id]/send-whatsapp, facturas/[id]/send-whatsapp).
//
// WhatsApp lets a business start a conversation only with a template Meta
// approved, so the document cannot simply be sent as a file: it rides in the
// DOCUMENT header of the template the clinic chose for this in Settings >
// WhatsApp (accounts.whatsapp_invoice_template_*). The PDF is the one the
// email attaches -- the same loader, the same generator -- uploaded to Meta
// and named by id, so no link to it ever exists outside the two of them.
//
// It goes to the number on the patient's own record and nowhere else: the
// routes take an invoice id and nothing that names a recipient.

import type { H3Event } from 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { toE164 } from '~/utils/phone'
import { formatEur } from '~/utils/billing'
import { sanitizeStorageFilename } from '~/utils/storageFilename'
import { templateMediaFormat } from '~/utils/whatsappTemplateSend'
import { resolveTemplateVariant } from '~/server/utils/appointmentNotifications'
import { fillTemplateComponents } from '~/server/utils/whatsappTemplateFill'
import { sendWhatsAppTemplate, uploadMediaToMeta } from '~/server/utils/whatsappSend'
import { generateInvoicePdf, type InvoiceDocumentData } from '~/server/utils/invoiceData'

/**
 * Why a document cannot go by WhatsApp right now. The first two are the
 * clinic's to fix in Settings > WhatsApp, the rest are about this patient.
 */
export type InvoiceWhatsAppBlocker = 'not_connected' | 'no_template' | 'minor' | 'no_phone' | 'bad_phone'

const BLOCKER_MESSAGES: Record<InvoiceWhatsAppBlocker, string> = {
  not_connected: 'WhatsApp is not configured. Set it up in Settings > WhatsApp.',
  no_template: 'No template is chosen for receipts and invoices. Choose one in Settings > WhatsApp.',
  minor: 'This patient is under age, so nothing is sent to them by WhatsApp.',
  no_phone: 'This patient has no phone number on file',
  bad_phone: "This patient's phone number could not be formatted for WhatsApp",
}

interface Readiness {
  blocker: InvoiceWhatsAppBlocker | null
  account: {
    whatsapp_phone_number_id: string | null
    whatsapp_business_account_id: string | null
    whatsapp_access_token: string | null
    whatsapp_invoice_template_name: string | null
    whatsapp_invoice_template_language: string | null
  } | null
  patient: { id: string; first_name: string | null; preferred_language: string | null } | null
  /** The patient's own number, E.164, when there is nothing in the way. */
  to: string | null
}

/**
 * Whether a document of this patient's can go by WhatsApp, and to which
 * number. One answer for the button's tooltip and for the send itself, so
 * the button is never enabled for a send the server then refuses.
 *
 * `supabase` is the caller's own client: a patient of another account, or one
 * outside the caller's patient scope, is simply not found.
 */
export async function invoiceWhatsAppReadiness(supabase: SupabaseClient<Database>, accountId: string, patientId: string | null): Promise<Readiness> {
  const { data: account } = await supabase
    .from('accounts')
    .select('whatsapp_phone_number_id, whatsapp_business_account_id, whatsapp_access_token, whatsapp_invoice_template_name, whatsapp_invoice_template_language')
    .eq('id', accountId)
    .maybeSingle()
  await withMessagingTokens(accountId, account)

  const none = { account: account ?? null, patient: null, to: null }
  if (!account?.whatsapp_phone_number_id || !account?.whatsapp_access_token) return { ...none, blocker: 'not_connected' }
  if (!account.whatsapp_invoice_template_name?.trim()) return { ...none, blocker: 'no_template' }
  if (!patientId) return { ...none, blocker: 'no_phone' }

  const { data: patient } = await supabase
    .from('patients')
    .select('id, account_id, first_name, preferred_language, is_minor')
    .eq('id', patientId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!patient) return { ...none, blocker: 'no_phone' }
  // As every other staff send treats a minor (whatsapp/send.post.ts).
  if (patient.is_minor) return { ...none, patient, blocker: 'minor' }

  const { data: numbers } = await supabase
    .from('patient_contact_numbers')
    .select('number, country_code, is_whatsapp')
    .eq('patient_id', patient.id)
    // Oldest first, so a patient with two numbers is always sent to the same
    // one -- the rule whatsapp/send.post.ts uses for a template.
    .order('created_at')
  const target = numbers?.find((n) => n.is_whatsapp) ?? numbers?.[0]
  if (!target) return { ...none, patient, blocker: 'no_phone' }
  const to = toE164(target.number, target.country_code)
  if (!to) return { ...none, patient, blocker: 'bad_phone' }

  return { blocker: null, account, patient, to }
}

/**
 * The body's {{n}}, in a fixed order: the patient's first name, the document
 * ("Recibo INV-0042", "Factura simplificada F-2026-0007"), its total the
 * Spanish way ("45,00 €"), the clinic's name. Positional, as every template
 * QuiroFlow fills by itself is (appointmentNotifications.ts): a template
 * with fewer blanks takes the first of these, and a blank past the fourth --
 * or one whose value is empty -- takes the first name, because Meta refuses
 * a send with an empty parameter (131008).
 */
export function invoiceTemplateVariables(bodyText: string, values: { firstName: string; document: string; total: string; clinicName: string }): string[] {
  const guesses = [values.firstName, values.document, values.total, values.clinicName]
  const slots = new Set<string>()
  for (const m of bodyText.matchAll(/\{\{(\d+)\}\}/g)) slots.add(m[1]!)
  return Array.from({ length: slots.size }, (_, i) => guesses[i]?.trim() || values.firstName || values.document)
}

/**
 * Sends the document `data` describes to its patient with the clinic's
 * invoice template, and records it where a template send is recorded: the
 * contact log, and the patient's WhatsApp thread with the PDF on it.
 *
 * Throws what the route should answer: 404 for a document of another
 * account, 400 with the reason when it cannot be sent, 502 with Meta's own
 * words when Meta refuses it.
 */
export async function sendInvoiceByWhatsApp(
  event: H3Event,
  { supabase, teamMember }: { supabase: SupabaseClient<Database>; teamMember: { id: string; account_id: string } },
  data: InvoiceDocumentData,
): Promise<{ sent: true }> {
  // Row-level security already keeps another clinic's invoice from loading.
  // Said again here because this sends a patient's document out of the
  // system, and a policy changed later must not be the only thing in the way.
  if (data.accountId !== teamMember.account_id) {
    throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
  }

  const ready = await invoiceWhatsAppReadiness(supabase, teamMember.account_id, data.patientId)
  if (ready.blocker) throw createError({ statusCode: 400, statusMessage: BLOCKER_MESSAGES[ready.blocker] })
  const account = ready.account!
  const patient = ready.patient!
  const to = ready.to!
  const waAccount = { whatsapp_phone_number_id: account.whatsapp_phone_number_id!, whatsapp_access_token: account.whatsapp_access_token! }
  const templateName = account.whatsapp_invoice_template_name!.trim()
  const defaultLanguage = account.whatsapp_invoice_template_language?.trim() || 'es'

  // The template as Meta has it, in the patient's language when it has an
  // approved variant: how many blanks its body has, and whether it has the
  // document header this needs. Best-effort, like every other send -- with
  // Meta's list unreachable the send still goes, in the stored language.
  const variant = account.whatsapp_business_account_id
    ? await resolveTemplateVariant(account.whatsapp_business_account_id, waAccount.whatsapp_access_token, templateName, defaultLanguage, patient.preferred_language).catch(() => null)
    : null
  if (variant && templateMediaFormat(variant.template) !== 'document') {
    throw createError({
      statusCode: 400,
      statusMessage: `The template "${templateName}" has no document header, so the PDF cannot be attached. Choose another in Settings > WhatsApp.`,
    })
  }
  const language = variant?.language ?? defaultLanguage

  const document = data.documentTitle ?? `Recibo ${data.invoiceNumber}`
  const variables = invoiceTemplateVariables(variant?.bodyText ?? '', {
    // Who it is sent to, not who the document is addressed to: a factura in
    // a tutor's name still goes to the patient whose record it is on.
    firstName: (patient.first_name ?? '').trim() || data.patient.firstName,
    document,
    total: formatEur(data.totalCents),
    clinicName: data.clinic?.name ?? '',
  })

  const pdf = await generateInvoicePdf(data)
  const filename = `${data.invoiceNumber}.pdf`

  // Service role only for what the template kept when it was made here
  // (whatsapp_template_send_values) -- a button's link, a code. After the
  // route's guard, so the audit trail names the person sending.
  const admin = serverSupabaseServiceRole<Database>(event)
  let missing: string[] = []
  let wamid: string | null = null
  try {
    // By id, not by link: the PDF never needs a URL anyone else could open.
    const mediaId = await uploadMediaToMeta(waAccount, pdf, 'application/pdf', filename)
    const header = { type: 'header', parameters: [{ type: 'document', document: { id: mediaId, filename } }] }
    wamid = await sendWhatsAppTemplate(waAccount, to, templateName, language, variables, header, async (components) => {
      const filled = await fillTemplateComponents(admin, teamMember.account_id, variant?.template ?? null, components, { firstName: variables[0] ?? null, phone: to })
      missing = filled.missing
      if (missing.length) throw new Error('template part missing')
      return filled.components
    })
  } catch (err: any) {
    if (missing.length) {
      throw createError({ statusCode: 400, statusMessage: `This template has a part QuiroFlow cannot fill (${missing.join(', ')}). Edit it in Settings > WhatsApp.` })
    }
    // error_data.details is where Meta says WHICH parameter or why the file
    // was refused; the message alone is a category.
    const metaError = err?.data?.error
    const metaMessage = metaError ? [metaError.message, metaError.error_data?.details].filter(Boolean).join(': ') : null
    throw createError({ statusCode: 502, statusMessage: metaMessage || 'WhatsApp send failed' })
  }

  // What the patient reads under the PDF, for the thread; the document's own
  // name when Meta's wording could not be read.
  const bodyPreview = variant?.bodyText ? variant.bodyText.replace(/\{\{(\d+)\}\}/g, (_, n: string) => variables[Number(n) - 1] ?? '') : document
  const storagePath = `${teamMember.account_id}/out-${Date.now()}-${sanitizeStorageFilename(filename)}`

  // The row first, the copy of the file after: a delivery status can arrive
  // within seconds and has to find the message (inboxSend.ts).
  await Promise.all([
    supabase.from('contact_log').insert({
      account_id: teamMember.account_id,
      patient_id: patient.id,
      action: 'sent_whatsapp',
      note: `Template: ${templateName} (${document})`,
      created_by: teamMember.id,
    }),
    supabase.from('whatsapp_messages').insert({
      account_id: teamMember.account_id,
      patient_id: patient.id,
      phone_number: to,
      wamid,
      direction: 'outbound',
      purpose: 'other',
      template_name: templateName,
      status: 'sent',
      body_preview: bodyPreview.slice(0, 2000),
      media_type: 'document',
      media_storage_path: storagePath,
      media_mime_type: 'application/pdf',
      media_filename: filename,
    }),
  ])
  await supabase.storage.from('whatsapp-media').upload(storagePath, pdf, { contentType: 'application/pdf', upsert: true })

  return { sent: true }
}

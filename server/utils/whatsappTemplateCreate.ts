import {
  HEADER_FILES,
  FORM_BUTTON_PATH,
  draftFormId,
  headerFileProblem,
  isFormButton,
  isMediaHeader,
  mimeTypeFromFilename,
  normaliseDraft,
  safeFileName,
  sendValuesFromDraft,
  templateComponents,
  templateEditBlocker,
  templateHeaderKind,
  templateMediaPath,
  type Bilingual,
  type TemplateDraft,
} from '~/utils/whatsappTemplateDraft'
import { saveTemplateSendValues } from '~/server/utils/whatsappTemplateFill'
import { withMessagingTokens } from '~/server/utils/accountSecrets'
import { templateMediaFile } from '~/server/utils/whatsappTemplateMedia'
import { isOwnForm, saveTemplateForm } from '~/server/utils/whatsappTemplateForms'
import type { WhatsAppTemplateSummary } from '~/server/utils/whatsappTemplates'
import { templateMetaProblem } from '~/utils/whatsappTemplateMetaError'

// Submits a new message template to Meta for review, from inside QuiroFlow.
//
// Until this existed a clinic had to build every template in WhatsApp Manager,
// which is where a template with a PDF or an image at the top died: the
// automation could already attach the file (runAutomationActions'
// buildHeaderComponent), but nobody outside this team could make the template
// that asks for one.
//
// A header file is the awkward part. Meta does not take the sample as a URL or
// as a /media id: it wants a handle from the Resumable Upload API, which hangs
// off the APP the token belongs to rather than the WhatsApp Business Account.
// That app is the platform's for a clinic that pressed Connect and the
// clinic's own for one that pasted a token, so it is read from the token
// (debug_token) rather than assumed.

export class TemplateCreateError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    /** The same refusal in words a clinic can act on, both languages, for the dialog to show instead of Meta's English. */
    public problem: Bilingual | null = null,
  ) {
    super(message)
  }
}

interface HeaderFile {
  data: Buffer
  type: string
  filename: string
}

/**
 * The create and edit endpoints' body: multipart, `draft` the TemplateDraft as
 * JSON and `file` the PDF, image or video for the top when there is one.
 * Every field is coerced to what a draft may hold, so the checks after this
 * see a draft, whatever was posted.
 *
 * `origin` is the app the request came to, which a new form button links to.
 */
export async function readTemplateSubmission(event: any): Promise<{ draft: TemplateDraft; file: HeaderFile | null; origin: string }> {
  const form = await readMultipartFormData(event)
  const raw = form?.find((part) => part.name === 'draft')?.data?.toString()
  let parsed: unknown
  try {
    parsed = raw ? JSON.parse(raw) : {}
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'The template could not be read.' })
  }
  const draft = normaliseDraft(parsed)
  const filePart = form?.find((part) => part.name === 'file' && part.filename)
  const file = filePart?.data ? { data: filePart.data, type: filePart.type ?? '', filename: filePart.filename ?? 'archivo' } : null
  return { draft, file, origin: getRequestURL(event).origin }
}

/** Refuses a form button that opens a form this clinic does not have, before Meta is asked. */
async function checkForm(supabase: any, accountId: string, draft: TemplateDraft) {
  const formId = draftFormId(draft)
  if (formId && !(await isOwnForm(supabase, accountId, formId))) {
    throw new TemplateCreateError('That form is not one of this clinic\'s forms. Choose it again.', 400)
  }
}

function metaMessage(err: any): string | null {
  const e = err?.data?.error
  if (!e) return null
  // error_user_msg is the sentence Meta writes for a person ("The template
  // name already exists in this language"); message alone is often just
  // "Invalid parameter".
  return [e.error_user_title, e.error_user_msg ?? e.message].filter(Boolean).join(': ') || null
}

/** The app the token was issued by: the platform's, or the clinic's own. */
async function appIdForToken(graph: string, token: string): Promise<string> {
  try {
    const debug = await $fetch<{ data?: { app_id?: string } }>(`${graph}/debug_token`, {
      query: { input_token: token, access_token: token },
    })
    if (debug.data?.app_id) return String(debug.data.app_id)
  } catch {
    // Falls through to the platform app below.
  }
  const platform = useRuntimeConfig().public.metaPlatformAppId as string | undefined
  if (platform) return platform
  throw new TemplateCreateError('Could not tell which Meta app this WhatsApp connection belongs to, so the file could not be sent to Meta.', 502)
}

/** Meta's Resumable Upload: open a session on the app, send the bytes, get back the handle a template header names. */
async function uploadSample(graph: string, token: string, file: HeaderFile): Promise<string> {
  const appId = await appIdForToken(graph, token)
  try {
    const session = await $fetch<{ id: string }>(`${graph}/${appId}/uploads`, {
      method: 'POST',
      query: { file_name: file.filename, file_length: file.data.length, file_type: file.type, access_token: token },
    })
    // The session id carries its own "?sig=" query, so it is appended as-is.
    const uploaded = await $fetch<{ h: string }>(`${graph}/${session.id}`, {
      method: 'POST',
      // "OAuth", not "Bearer": this endpoint is the one place in the Graph API
      // that insists on the older scheme.
      headers: { Authorization: `OAuth ${token}`, file_offset: '0', 'Content-Type': file.type },
      body: file.data,
    })
    if (!uploaded?.h) throw new Error('no handle')
    return uploaded.h
  } catch (err: any) {
    const detail = metaMessage(err)
    throw new TemplateCreateError(detail ? `Meta refused the file: ${detail}` : 'Could not send the file to Meta.', 502)
  }
}

export interface CreatedTemplate {
  id: string
  status: string
  category: string
  /** Where the file was kept for the automations that use this template, when it has one. */
  storagePath: string | null
}

interface Connection {
  graph: string
  token: string
  wabaId: string
}

async function connection(supabase: any, accountId: string): Promise<Connection> {
  const { data: account } = await supabase.from('accounts').select('whatsapp_business_account_id, whatsapp_access_token').eq('id', accountId).maybeSingle()
  await withMessagingTokens(accountId, account)
  if (!account?.whatsapp_business_account_id || !account?.whatsapp_access_token) {
    throw new TemplateCreateError('WhatsApp is not configured. Set it up in Settings > WhatsApp.', 400)
  }
  return { graph: useRuntimeConfig().metaGraphBaseUrl, token: account.whatsapp_access_token, wabaId: account.whatsapp_business_account_id }
}

/**
 * Keeps a new file in whatsapp-media before Meta is asked, so a template Meta
 * accepts always has its file; `forget` removes it again when Meta refuses,
 * so a refusal leaves nothing behind.
 */
async function keepFile(supabase: any, accountId: string, draft: TemplateDraft, file: HeaderFile) {
  if (!isMediaHeader(draft.header) || !HEADER_FILES[draft.header].mimeTypes.includes(file.type)) {
    throw new TemplateCreateError('That file type cannot go at the top of this template.', 400)
  }
  const storagePath = templateMediaPath(accountId, draft.name, draft.language, file.filename)
  const { error } = await supabase.storage.from('whatsapp-media').upload(storagePath, file.data, { contentType: file.type, upsert: false })
  if (error) throw new TemplateCreateError(error.message, 500)
  return {
    storagePath,
    forget: async () => {
      await supabase.storage.from('whatsapp-media').remove([storagePath])
    },
  }
}

/**
 * Sends the draft to Meta. The caller has already validated it
 * (templateDraftProblems / headerFileProblem); this only talks to Meta and
 * keeps the file.
 */
export async function createWhatsAppTemplate(supabase: any, accountId: string, draft: TemplateDraft, file: HeaderFile | null, origin: string): Promise<CreatedTemplate> {
  const { graph, token, wabaId } = await connection(supabase, accountId)
  await checkForm(supabase, accountId, draft)
  const kept = isMediaHeader(draft.header) && file ? await keepFile(supabase, accountId, draft, file) : null

  try {
    const handle = isMediaHeader(draft.header) && file ? await uploadSample(graph, token, file) : null
    let created: { id: string; status?: string; category?: string }
    try {
      created = await $fetch<{ id: string; status?: string; category?: string }>(`${graph}/${wabaId}/message_templates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: {
          name: draft.name,
          language: draft.language,
          category: draft.category,
          components: templateComponents(draft, handle, origin),
        },
      })
    } catch (err: any) {
      const detail = metaMessage(err)
      throw new TemplateCreateError(detail ? `Meta refused the template: ${detail}` : 'Could not reach WhatsApp to submit the template.', 502, templateMetaProblem(err?.data?.error))
    }
    // After Meta accepted it: a refused template leaves no row behind. Always
    // written, so a template made again under a name an earlier one had does
    // not inherit that one's form, or what filled its blanks.
    await saveTemplateForm(supabase, accountId, draft.name, draft.language, draftFormId(draft))
    await saveTemplateSendValues(supabase, accountId, draft.name, draft.language, sendValuesFromDraft(draft))
    return { id: String(created.id), status: created.status ?? 'PENDING', category: created.category ?? draft.category, storagePath: kept?.storagePath ?? null }
  } catch (err) {
    await kept?.forget()
    throw err
  }
}

export interface EditedTemplate {
  header: TemplateDraft['header']
  /** The file the template now has in QuiroFlow, when a new one was attached. */
  headerMedia: { type: string; storage_path: string; filename: string } | null
  /** The file it had before, which automation steps that used it have been moved off. */
  previousStoragePath: string | null
}

/**
 * Edits a template that already exists at Meta (POST /{template-id}).
 *
 * `existing` is the template as Meta lists it NOW, read by the caller from the
 * account's own Business Account -- so the id cannot name another clinic's
 * template, and the status, name and language are Meta's rather than the
 * browser's.
 *
 * Meta replaces every component with the ones sent, so a file at the top has
 * to go up again as a sample even when the clinic did not change it. That is
 * the file kept when the template was made in QuiroFlow; one made in WhatsApp
 * Manager has none here, and has to be attached.
 */
export async function editWhatsAppTemplate(
  supabase: any,
  accountId: string,
  existing: WhatsAppTemplateSummary,
  draft: TemplateDraft,
  file: HeaderFile | null,
  origin: string,
): Promise<EditedTemplate> {
  const blocked = templateEditBlocker(existing)
  if (blocked) throw new TemplateCreateError(blocked.en, 409, blocked)
  // Neither can change at Meta; the draft carries what the template has.
  draft = { ...draft, name: existing.name, language: existing.language }
  await checkForm(supabase, accountId, draft)
  // A form button it already has keeps linking where it did: the app it was
  // made from, not whichever one this edit happens to come from.
  const formUrl = existing.buttons.find(isFormButton)?.url
  const buttonOrigin = formUrl ? formUrl.slice(0, formUrl.lastIndexOf(FORM_BUTTON_PATH)) : origin

  const { graph, token } = await connection(supabase, accountId)
  const previous = existing.mediaHeaderFormat ? await templateMediaFile(supabase, accountId, existing.name, existing.language) : null

  // The sample Meta reviews the edit with: the new file, or the one already kept.
  let sample: HeaderFile | null = null
  if (isMediaHeader(draft.header)) {
    if (file) sample = file
    else if (previous && templateHeaderKind(existing) === draft.header) {
      const { data: blob, error } = await supabase.storage.from('whatsapp-media').download(previous.path)
      const type = mimeTypeFromFilename(previous.filename)
      if (error || !blob || !type) throw new TemplateCreateError('The file this template was created with could not be read. Attach it again.', 500)
      sample = { data: Buffer.from(await blob.arrayBuffer()), type, filename: previous.filename }
    } else {
      const missing = headerFileProblem(draft.header, null)!
      throw new TemplateCreateError(missing.en, 400)
    }
  }

  const kept = isMediaHeader(draft.header) && file ? await keepFile(supabase, accountId, draft, file) : null
  try {
    const handle = sample ? await uploadSample(graph, token, sample) : null
    // Meta does not let an approved template's category change, so for one
    // it is not sent at all; for a rejected or paused one, only when changed.
    const categoryChange = existing.status !== 'APPROVED' && draft.category !== existing.category ? { category: draft.category } : {}
    try {
      await $fetch(`${graph}/${existing.id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: { ...categoryChange, components: templateComponents(draft, handle, buttonOrigin) },
      })
    } catch (err: any) {
      const detail = metaMessage(err)
      throw new TemplateCreateError(detail ? `Meta refused the change: ${detail}` : 'Could not reach WhatsApp to submit the change.', 502, templateMetaProblem(err?.data?.error))
    }
  } catch (err) {
    await kept?.forget()
    throw err
  }
  await saveTemplateForm(supabase, accountId, existing.name, existing.language, draftFormId(draft))
  await saveTemplateSendValues(supabase, accountId, existing.name, existing.language, sendValuesFromDraft(draft))

  const headerMedia = kept && isMediaHeader(draft.header) ? { type: draft.header, storage_path: kept.storagePath, filename: safeFileName(file!.filename) } : null
  await moveAutomationSteps(supabase, accountId, existing, draft, previous?.path ?? null, headerMedia)
  return { header: draft.header, headerMedia, previousStoragePath: previous?.path ?? null }
}

/**
 * An automation step copies the template's file into its own config when the
 * template is chosen (WhatsAppPanel's selectTemplate), so a new file would
 * otherwise never reach it: every automation would keep sending the old PDF.
 * Steps on this template that were still sending its file are moved to the
 * new one; a template that no longer has anything at the top has the header
 * taken off its steps, which Meta would otherwise refuse each send over.
 * A step that attaches a file of its own is left with it.
 */
async function moveAutomationSteps(
  supabase: any,
  accountId: string,
  existing: WhatsAppTemplateSummary,
  draft: TemplateDraft,
  previousPath: string | null,
  headerMedia: EditedTemplate['headerMedia'],
) {
  if (!headerMedia && isMediaHeader(draft.header)) return
  const { data: steps } = await supabase
    .from('automation_actions')
    .select('id, config')
    .eq('account_id', accountId)
    .eq('action_type', 'whatsapp_template')
    .eq('config->>template_name', existing.name)
  for (const step of steps ?? []) {
    const config = step.config ?? {}
    if ((config.template_language || 'es') !== existing.language || !config.header) continue
    const usedTemplateFile = previousPath && config.header.storage_path === previousPath
    // A step's own place stays while the template still has a place at the top.
    if (config.header.type === 'location' && draft.header === 'location') continue
    let header: Record<string, unknown> | undefined
    if (!isMediaHeader(draft.header)) header = undefined
    else if (usedTemplateFile) header = { ...headerMedia }
    else continue
    const { header: _old, ...rest } = config
    await supabase.from('automation_actions').update({ config: header ? { ...rest, header } : rest }).eq('id', step.id)
  }
}

/** The settings columns that each name a template QuiroFlow sends by itself, with what the clinic calls them. */
const SETTINGS_USES = [
  { name: 'whatsapp_confirmation_template_name', language: 'whatsapp_confirmation_template_language', en: 'Appointment confirmation', es: 'Confirmación de cita' },
  { name: 'whatsapp_reminder_template_name', language: 'whatsapp_reminder_template_language', en: 'Appointment reminder', es: 'Recordatorio de cita' },
  { name: 'whatsapp_recall_template_name', language: 'whatsapp_recall_template_language', en: 'Recall', es: 'Revisión' },
  { name: 'whatsapp_invoice_template_name', language: 'whatsapp_invoice_template_language', en: 'Receipts and invoices', es: 'Recibos y facturas' },
  { name: 'online_booking_notify_whatsapp_template_name', language: 'online_booking_notify_whatsapp_template_language', en: 'New booking alert', es: 'Aviso de reserva' },
  { name: 'new_lead_notify_whatsapp_template_name', language: 'new_lead_notify_whatsapp_template_language', en: 'New lead alert', es: 'Aviso de lead' },
] as const

export interface TemplateUse {
  en: string
  es: string
}

/**
 * Everything that would stop sending if this template went: the messages
 * chosen in Settings > WhatsApp and every automation step on it. Meta answers
 * a send on a deleted template with an error, so deleting one still in use
 * turns confirmations or a drip off with nothing on screen to say so.
 */
export async function whatsAppTemplateUses(supabase: any, accountId: string, template: { name: string; language: string }): Promise<TemplateUse[]> {
  const uses: TemplateUse[] = []
  const { data: account } = await supabase
    .from('accounts')
    .select(SETTINGS_USES.flatMap((u) => [u.name, u.language]).join(', '))
    .eq('id', accountId)
    .maybeSingle()
  for (const u of SETTINGS_USES) {
    if (account?.[u.name] === template.name && (account?.[u.language] || 'es') === template.language) {
      uses.push({ en: `Settings > WhatsApp: ${u.en}`, es: `Ajustes > WhatsApp: ${u.es}` })
    }
  }
  const { data: steps } = await supabase
    .from('automation_actions')
    .select('config, automation_rules(name)')
    .eq('account_id', accountId)
    .eq('action_type', 'whatsapp_template')
    .eq('config->>template_name', template.name)
  const rules = new Set<string>()
  for (const step of steps ?? []) {
    if ((step.config?.template_language || 'es') !== template.language) continue
    rules.add(step.automation_rules?.name || '—')
  }
  for (const rule of rules) uses.push({ en: `Automation "${rule}"`, es: `Automatización «${rule}»` })
  return uses
}

/**
 * Deletes one template -- this name in this language -- from the account's
 * WhatsApp Business Account. `existing` is the template as Meta lists it now,
 * read by the caller from the account's own Business Account, so the id
 * cannot name another clinic's template.
 *
 * hsm_id together with the name deletes only that language; the name alone
 * would take every language of it.
 */
export async function deleteWhatsAppTemplate(supabase: any, accountId: string, existing: WhatsAppTemplateSummary): Promise<void> {
  if (!existing.id) throw new TemplateCreateError('Meta did not give this template an id, so it cannot be deleted from here. Delete it in WhatsApp Manager.', 409)
  const { graph, token, wabaId } = await connection(supabase, accountId)
  try {
    await $fetch(`${graph}/${wabaId}/message_templates`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      query: { hsm_id: existing.id, name: existing.name },
    })
  } catch (err: any) {
    const detail = metaMessage(err)
    throw new TemplateCreateError(detail ? `Meta refused to delete it: ${detail}` : 'Could not reach WhatsApp to delete the template.', 502)
  }
}

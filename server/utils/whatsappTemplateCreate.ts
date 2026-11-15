import { HEADER_FILES, templateComponents, templateMediaPath, type TemplateDraft } from '~/utils/whatsappTemplateDraft'
import { withMessagingTokens } from '~/server/utils/accountSecrets'

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
  ) {
    super(message)
  }
}

interface HeaderFile {
  data: Buffer
  type: string
  filename: string
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

/**
 * Sends the draft to Meta. The caller has already validated it
 * (templateDraftProblems / headerFileProblem); this only talks to Meta and
 * keeps the file.
 */
export async function createWhatsAppTemplate(supabase: any, accountId: string, draft: TemplateDraft, file: HeaderFile | null): Promise<CreatedTemplate> {
  const { data: account } = await supabase.from('accounts').select('whatsapp_business_account_id, whatsapp_access_token').eq('id', accountId).maybeSingle()
  await withMessagingTokens(accountId, account)
  if (!account?.whatsapp_business_account_id || !account?.whatsapp_access_token) {
    throw new TemplateCreateError('WhatsApp is not configured. Set it up in Settings > WhatsApp.', 400)
  }
  const graph: string = useRuntimeConfig().metaGraphBaseUrl
  const token: string = account.whatsapp_access_token

  // The file is kept before Meta is asked, so a template Meta accepts always
  // has its file -- and removed again if Meta refuses, so a refusal leaves
  // nothing behind.
  let storagePath: string | null = null
  if (draft.header !== 'none' && file) {
    if (!HEADER_FILES[draft.header].mimeTypes.includes(file.type)) throw new TemplateCreateError('That file type cannot go at the top of this template.', 400)
    storagePath = templateMediaPath(accountId, draft.name, draft.language, file.filename)
    const { error } = await supabase.storage.from('whatsapp-media').upload(storagePath, file.data, { contentType: file.type, upsert: false })
    if (error) throw new TemplateCreateError(error.message, 500)
  }
  const forget = async () => {
    if (storagePath) await supabase.storage.from('whatsapp-media').remove([storagePath])
  }

  try {
    const handle = draft.header !== 'none' && file ? await uploadSample(graph, token, file) : null
    let created: { id: string; status?: string; category?: string }
    try {
      created = await $fetch<{ id: string; status?: string; category?: string }>(`${graph}/${account.whatsapp_business_account_id}/message_templates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: {
          name: draft.name,
          language: draft.language,
          category: draft.category,
          components: templateComponents(draft, handle),
        },
      })
    } catch (err: any) {
      const detail = metaMessage(err)
      throw new TemplateCreateError(detail ? `Meta refused the template: ${detail}` : 'Could not reach WhatsApp to submit the template.', 502)
    }
    return { id: String(created.id), status: created.status ?? 'PENDING', category: created.category ?? draft.category, storagePath }
  } catch (err) {
    await forget()
    throw err
  }
}

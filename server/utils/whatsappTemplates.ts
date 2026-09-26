// The account's WhatsApp message templates, read from Meta.
//
// Shared by GET /api/whatsapp/templates (the pickers, approved only) and the
// automation save API, which needs the ones that are NOT approved too: "the
// template is pending approval at Meta" is a thing to tell someone before
// they switch an automation on, not something to discover from a failed send.

interface MetaTemplateButton {
  type: string
  text?: string
  url?: string
}
interface MetaTemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS'
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION'
  text?: string
  buttons?: MetaTemplateButton[]
}
interface MetaTemplate {
  name: string
  language: string
  category: string
  status: string
  components: MetaTemplateComponent[]
}

export interface WhatsAppTemplateSummary {
  name: string
  language: string
  category: string
  status: string
  bodyText: string
  headerText: string | null
  variableCount: number
  urlButtonCount: number
  mediaHeaderFormat: string | null
  /** Every button, in order; `dynamic` marks a URL button that takes a per-recipient parameter. */
  buttons: { type: string; text: string; dynamic: boolean }[]
}

export class WhatsAppTemplatesError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message)
  }
}

function summarise(t: MetaTemplate): WhatsAppTemplateSummary {
  const components = t.components ?? []
  const body = components.find((c) => c.type === 'BODY')
  const header = components.find((c) => c.type === 'HEADER')
  const bodyText = body?.text ?? ''
  const variableCount = new Set(Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g)).map((m) => m[1])).size
  const buttons = components.find((c) => c.type === 'BUTTONS')?.buttons ?? []
  // Only URL buttons with a {{n}} placeholder take a per-recipient
  // parameter -- a static "Call us" or plain non-dynamic website button
  // doesn't need (or accept) a doc link.
  const isDynamic = (b: MetaTemplateButton) => b.type === 'URL' && /\{\{\d+\}\}/.test(b.url ?? '')
  return {
    name: t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    bodyText,
    headerText: header?.format === 'TEXT' ? (header.text ?? null) : null,
    variableCount,
    urlButtonCount: buttons.filter(isDynamic).length,
    mediaHeaderFormat: header?.format && header.format !== 'TEXT' ? header.format : null,
    buttons: buttons.map((b) => ({ type: b.type, text: b.text ?? '', dynamic: isDynamic(b) })),
  }
}

/**
 * Every template on the account's WhatsApp Business Account, whatever its
 * status. Throws WhatsAppTemplatesError with Meta's own words when WhatsApp is
 * not configured or refuses.
 */
export async function fetchWhatsAppTemplates(supabase: any, accountId: string): Promise<WhatsAppTemplateSummary[]> {
  const { data: account } = await supabase
    .from('accounts')
    .select('whatsapp_business_account_id, whatsapp_access_token')
    .eq('id', accountId)
    .maybeSingle()
  if (!account?.whatsapp_business_account_id || !account?.whatsapp_access_token) {
    throw new WhatsAppTemplatesError('WhatsApp is not configured. Set it up in Settings > WhatsApp.', 400)
  }

  // Runtime config rather than a literal, for the same reason
  // meta/connect/callback.post.ts uses it: the failure path here writes no
  // data but it IS the path people hit, and it cannot be tested against the
  // real Graph API without making live calls to Meta from CI.
  const url: string = `${useRuntimeConfig().metaGraphBaseUrl}/${account.whatsapp_business_account_id}/message_templates`
  let response: { data: MetaTemplate[] }
  try {
    response = await $fetch<{ data: MetaTemplate[] }>(url, {
      params: { fields: 'name,language,category,status,components', limit: 100 },
      headers: { Authorization: `Bearer ${account.whatsapp_access_token}` },
    })
  } catch (err: any) {
    // Meta says precisely what is wrong -- "Session has expired on Friday...",
    // "Unsupported get request", "(#200) Permissions error" -- and this used
    // to discard all of it for a fixed string that named two possible causes
    // and distinguished neither.
    //
    // That is not hypothetical. On 21 Sep an expired token and a wrong
    // Business Account ID presented identically here, and the only way to
    // tell them apart was to change one and see -- twice. Meta had answered
    // the question both times.
    const metaError = err?.data?.error
    const metaMessage = metaError ? [metaError.message, metaError.error_data?.details].filter(Boolean).join(' -- ') : null
    throw new WhatsAppTemplatesError(
      metaMessage ? `WhatsApp refused that request: ${metaMessage}` : 'Could not reach WhatsApp. Check your access token and Business Account ID.',
      502,
    )
  }
  return (response.data ?? []).map(summarise)
}

/** The templates, or null when they cannot be read -- for checks that should be skipped rather than fail then. */
export async function tryFetchWhatsAppTemplates(supabase: any, accountId: string): Promise<WhatsAppTemplateSummary[] | null> {
  try {
    return await fetchWhatsAppTemplates(supabase, accountId)
  } catch {
    return null
  }
}

interface MetaTemplateButton {
  type: string
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

export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requirePermission(event, 'communication_config')

  const { data: account } = await supabase
    .from('accounts')
    .select('whatsapp_business_account_id, whatsapp_access_token')
    .eq('id', teamMember.account_id)
    .maybeSingle()
  if (!account?.whatsapp_business_account_id || !account?.whatsapp_access_token) {
    throw createError({ statusCode: 400, statusMessage: 'WhatsApp is not configured. Set it up in Settings > WhatsApp.' })
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
    //
    // Same shape as whatsapp/inbox-send.post.ts, which already does this for
    // the send path; the lesson was learned there and never applied here.
    const metaError = err?.data?.error
    const metaMessage = metaError ? [metaError.message, metaError.error_data?.details].filter(Boolean).join(' -- ') : null
    throw createError({
      statusCode: 502,
      statusMessage: metaMessage
        ? `WhatsApp refused that request: ${metaMessage}`
        : 'Could not reach WhatsApp. Check your access token and Business Account ID.',
    })
  }

  const templates = (response.data ?? [])
    .filter((t) => t.status === 'APPROVED')
    .map((t) => {
      const body = t.components.find((c) => c.type === 'BODY')
      const header = t.components.find((c) => c.type === 'HEADER')
      const bodyText = body?.text ?? ''
      const variableCount = new Set(Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g)).map((m) => m[1])).size
      const buttons = t.components.find((c) => c.type === 'BUTTONS')?.buttons ?? []
      // Only URL buttons with a {{n}} placeholder take a per-recipient
      // parameter -- a static "Call us" or plain non-dynamic website button
      // doesn't need (or accept) a doc link.
      const urlButtonCount = buttons.filter((b) => b.type === 'URL' && /\{\{\d+\}\}/.test(b.url ?? '')).length
      return {
        name: t.name,
        language: t.language,
        category: t.category,
        bodyText,
        variableCount,
        urlButtonCount,
        mediaHeaderFormat: header?.format && header.format !== 'TEXT' ? header.format : null,
      }
    })

  return { templates }
})

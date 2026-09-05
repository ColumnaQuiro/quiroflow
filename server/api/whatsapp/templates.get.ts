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

  const url: string = `https://graph.facebook.com/v21.0/${account.whatsapp_business_account_id}/message_templates`
  let response: { data: MetaTemplate[] }
  try {
    response = await $fetch<{ data: MetaTemplate[] }>(url, {
      params: { fields: 'name,language,category,status,components', limit: 100 },
      headers: { Authorization: `Bearer ${account.whatsapp_access_token}` },
    })
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'Could not reach WhatsApp. Check your access token and Business Account ID.' })
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

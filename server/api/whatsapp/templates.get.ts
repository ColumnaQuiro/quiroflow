import { WhatsAppTemplatesError, fetchWhatsAppTemplates } from '~/server/utils/whatsappTemplates'

// The account's APPROVED WhatsApp templates, for the pickers (the automation
// builder among them). The Meta call itself lives in
// server/utils/whatsappTemplates.ts, shared with the automation save API,
// which also needs the templates that are not approved yet.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requirePermission(event, 'communication_config')

  try {
    const all = await fetchWhatsAppTemplates(supabase, teamMember.account_id)
    return { templates: all.filter((t) => t.status === 'APPROVED') }
  } catch (err) {
    if (err instanceof WhatsAppTemplatesError) throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    throw err
  }
})

import { serverSupabaseServiceRole } from '#supabase/server'
import { requirePermission } from '~/server/utils/requirePermission'
import { TemplateCreateError, deleteWhatsAppTemplate, whatsAppTemplateUses } from '~/server/utils/whatsappTemplateCreate'
import { WhatsAppTemplatesError, fetchWhatsAppTemplates } from '~/server/utils/whatsappTemplates'

// Deletes a WhatsApp template at Meta -- one name in one language -- from
// Settings > WhatsApp, beside Edit.
//
// Refused while something still sends it (a message chosen in Settings, an
// automation step): Meta fails every send on a deleted template, and nothing
// on screen would say why confirmations or a drip had stopped. The 409 carries
// those uses, so the dialog can name them.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requirePermission(event, 'communication_config')
  const id = getRouterParam(event, 'id') ?? ''

  // Found among THIS account's templates: the id alone could name any the token reaches.
  let existing
  try {
    existing = (await fetchWhatsAppTemplates(supabase, teamMember.account_id)).find((t) => t.id === id)
  } catch (err) {
    if (err instanceof WhatsAppTemplatesError) throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    throw err
  }
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'That template is not on this WhatsApp account any more. Refresh from Meta.' })

  const admin = serverSupabaseServiceRole(event)
  const uses = await whatsAppTemplateUses(admin, teamMember.account_id, existing)
  if (uses.length) {
    throw createError({
      statusCode: 409,
      statusMessage: `"${existing.name}" is still in use: ${uses.map((u) => u.en).join('; ')}. Choose another template there first.`,
      data: { uses },
    })
  }

  try {
    await deleteWhatsAppTemplate(admin, teamMember.account_id, existing)
  } catch (err) {
    if (err instanceof TemplateCreateError) throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    throw err
  }
  return { id, name: existing.name, language: existing.language }
})

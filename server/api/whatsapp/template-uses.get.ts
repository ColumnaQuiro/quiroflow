import { serverSupabaseServiceRole } from '#supabase/server'
import { requirePermission } from '~/server/utils/requirePermission'
import { whatsAppTemplateUses } from '~/server/utils/whatsappTemplateCreate'

// What sends a template -- a message chosen in Settings, an automation step --
// for the edit dialog. Editing an approved template sends it back to Meta's
// review, and until Meta approves it again those sends may not go out, so the
// dialog names them before the clinic presses the button.
//
// Read from this account's own settings and steps only, so the name and
// language need no check against Meta.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requirePermission(event, 'communication_config')
  const { name, language } = getQuery(event)
  if (typeof name !== 'string' || !name) throw createError({ statusCode: 400, statusMessage: 'Which template?' })
  const lang = typeof language === 'string' && language ? language : 'es'
  return { uses: await whatsAppTemplateUses(serverSupabaseServiceRole(event), teamMember.account_id, { name, language: lang }) }
})

import { serverSupabaseServiceRole } from '#supabase/server'
import { requirePermission } from '~/server/utils/requirePermission'
import { TemplateCreateError, editWhatsAppTemplate, readTemplateSubmission } from '~/server/utils/whatsappTemplateCreate'
import { WhatsAppTemplatesError, fetchWhatsAppTemplates } from '~/server/utils/whatsappTemplates'
import { headerFileProblem, templateDraftProblems } from '~/utils/whatsappTemplateDraft'

// Changes a WhatsApp template that already exists at Meta and sends the change
// for review -- the same dialog as creating one, opened on a template from
// Settings > WhatsApp or from an automation's WhatsApp step. Same body as
// POST /api/whatsapp/templates; the file is optional here, because a template
// made in QuiroFlow already has one kept.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requirePermission(event, 'communication_config')
  const id = getRouterParam(event, 'id') ?? ''
  const { draft, file, origin } = await readTemplateSubmission(event)

  const problem = templateDraftProblems(draft, { editing: true })[0] ?? (file ? headerFileProblem(draft.header, { type: file.type, size: file.data.length }) : null)
  if (problem) throw createError({ statusCode: 400, statusMessage: problem.en })

  // The template as Meta has it now, found among THIS account's: the id in the
  // URL alone would let a request name any template the token can reach.
  let existing
  try {
    existing = (await fetchWhatsAppTemplates(supabase, teamMember.account_id)).find((t) => t.id === id)
  } catch (err) {
    if (err instanceof WhatsAppTemplatesError) throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    throw err
  }
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'That template is not on this WhatsApp account any more. Refresh from Meta.' })

  try {
    const edited = await editWhatsAppTemplate(serverSupabaseServiceRole(event), teamMember.account_id, existing, draft, draft.header === 'none' ? null : file, origin)
    return { id, name: existing.name, language: existing.language, ...edited }
  } catch (err) {
    if (err instanceof TemplateCreateError) throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    throw err
  }
})

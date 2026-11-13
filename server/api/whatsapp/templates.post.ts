import { serverSupabaseServiceRole } from '#supabase/server'
import { requirePermission } from '~/server/utils/requirePermission'
import { TemplateCreateError, createWhatsAppTemplate } from '~/server/utils/whatsappTemplateCreate'
import { headerFileProblem, templateDraftProblems, type TemplateDraft } from '~/utils/whatsappTemplateDraft'

// Creates a WhatsApp message template and submits it to Meta for review --
// the "Create template" dialog in Settings > WhatsApp and the automation
// builder. Multipart: `draft` is the TemplateDraft as JSON, `file` the PDF,
// image or video that goes at the top when the draft asks for one.
//
// Same permission as reading the templates and uploading header files:
// templates are part of how the clinic's WhatsApp is configured.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requirePermission(event, 'communication_config')

  const form = await readMultipartFormData(event)
  const raw = form?.find((part) => part.name === 'draft')?.data?.toString()
  let parsed: Partial<TemplateDraft>
  try {
    parsed = raw ? JSON.parse(raw) : {}
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'The template could not be read.' })
  }
  const draft: TemplateDraft = {
    name: String(parsed.name ?? '').trim(),
    language: String(parsed.language ?? ''),
    category: parsed.category === 'MARKETING' ? 'MARKETING' : 'UTILITY',
    header: (['image', 'video', 'document'] as const).find((k) => k === parsed.header) ?? 'none',
    body: String(parsed.body ?? ''),
    examples: Array.isArray(parsed.examples) ? parsed.examples.map((e) => String(e ?? '')) : [],
    footer: String(parsed.footer ?? ''),
  }

  const filePart = form?.find((part) => part.name === 'file' && part.filename)
  const file = filePart?.data ? { data: filePart.data, type: filePart.type ?? '', filename: filePart.filename ?? 'archivo' } : null

  // The dialog checks all of this as the clinic types; this is the same check
  // for anything that reaches the endpoint another way, before a call to Meta
  // is spent on something Meta would refuse.
  const problem = templateDraftProblems(draft)[0] ?? headerFileProblem(draft.header, file ? { type: file.type, size: file.data.length } : null)
  if (problem) throw createError({ statusCode: 400, statusMessage: problem.en })

  try {
    const created = await createWhatsAppTemplate(serverSupabaseServiceRole(event), teamMember.account_id, draft, draft.header === 'none' ? null : file)
    return { id: created.id, name: draft.name, language: draft.language, status: created.status, category: created.category }
  } catch (err) {
    if (err instanceof TemplateCreateError) throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    throw err
  }
})

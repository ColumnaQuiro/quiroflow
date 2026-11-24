import { serverSupabaseServiceRole } from '#supabase/server'
import { WhatsAppTemplatesError, fetchWhatsAppTemplates } from '~/server/utils/whatsappTemplates'
import { templateMediaFiles } from '~/server/utils/whatsappTemplateMedia'
import { templateForms } from '~/server/utils/whatsappTemplateForms'
import { allTemplateSendValues } from '~/server/utils/whatsappTemplateFill'

// The account's APPROVED WhatsApp templates, for the pickers (the automation
// builder among them). The Meta call itself lives in
// server/utils/whatsappTemplates.ts, shared with the automation save API,
// which also needs the templates that are not approved yet.
//
// `inReview` is everything else -- pending, rejected, paused -- so a template
// created from QuiroFlow does not simply vanish between submitting it and
// Meta approving it.
//
// A template created in QuiroFlow with a file at the top carries
// `headerMedia`: the file the clinic uploaded with it, which an automation
// attaches by default rather than asking for it a second time; one made with
// a form button carries `form`, the QuiroFlow form that button opens; one
// QuiroFlow fills on each send carries `sendValues`, what goes in its blanks.
//
// Read too by "See leads" (leads_access): a lead from an ad form has often
// never written, so a template is the only way to reach them, and the lead
// thread's "Send template" lists them here. Changing templates stays under
// communication_config (templates.post, templates/[id]).
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireAnyPermission(event, ['communication_config', 'leads_access'])

  let all
  try {
    all = await fetchWhatsAppTemplates(supabase, teamMember.account_id)
  } catch (err) {
    if (err instanceof WhatsAppTemplatesError) throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    throw err
  }

  const admin = serverSupabaseServiceRole(event)
  const [media, forms, sendValues] = await Promise.all([
    templateMediaFiles(admin, teamMember.account_id),
    templateForms(admin, teamMember.account_id),
    allTemplateSendValues(admin, teamMember.account_id),
  ])
  const withMedia = all.map((t) => {
    const file = t.mediaHeaderFormat ? media.get(`${t.name}.${t.language}`) : undefined
    const formId = forms.get(`${t.name}.${t.language}`)
    const values = sendValues.get(`${t.name}.${t.language}`)
    return {
      ...t,
      ...(file ? { headerMedia: { type: t.mediaHeaderFormat!.toLowerCase(), storage_path: file.path, filename: file.filename } } : {}),
      ...(formId ? { form: { docTemplateId: formId } } : {}),
      ...(values ? { sendValues: values } : {}),
    }
  })

  return {
    templates: withMedia.filter((t) => t.status === 'APPROVED'),
    inReview: withMedia.filter((t) => t.status !== 'APPROVED'),
  }
})


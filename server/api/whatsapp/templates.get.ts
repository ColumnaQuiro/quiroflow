import { serverSupabaseServiceRole } from '#supabase/server'
import { WhatsAppTemplatesError, fetchWhatsAppTemplates } from '~/server/utils/whatsappTemplates'
import { templateMediaFiles } from '~/server/utils/whatsappTemplateMedia'

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
// attaches by default rather than asking for it a second time.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requirePermission(event, 'communication_config')

  let all
  try {
    all = await fetchWhatsAppTemplates(supabase, teamMember.account_id)
  } catch (err) {
    if (err instanceof WhatsAppTemplatesError) throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    throw err
  }

  const media = await templateMediaFiles(serverSupabaseServiceRole(event), teamMember.account_id)
  const withMedia = all.map((t) => {
    const file = t.mediaHeaderFormat ? media.get(`${t.name}.${t.language}`) : undefined
    return file ? { ...t, headerMedia: { type: t.mediaHeaderFormat!.toLowerCase(), storage_path: file.path, filename: file.filename } } : t
  })

  return {
    templates: withMedia.filter((t) => t.status === 'APPROVED'),
    inReview: withMedia.filter((t) => t.status !== 'APPROVED'),
  }
})


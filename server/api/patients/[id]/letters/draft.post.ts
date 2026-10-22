import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { CLINICAL_LETTER_FIELDS, letterMergeValues, loadLetterClinic } from '~/server/utils/letterData'
import { fillLetterBody, letterTokens } from '~/utils/letters'

// "New letter" on the patient record: a template filled in for this patient,
// returned as an editable draft. Nothing is saved here; the record saves the
// letter itself once the writer is done with it (patient_letters, under RLS).
//
// Anyone who can see the patient can draft one, as with the justificante.
// The chief complaint and diagnosis are filled in only for someone with
// visit_notes_access, the permission the record hides them behind;
// `clinicalOmitted` says so when the template asked for them.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember, patientId } = await requirePatientAccess(event, getRouterParam(event, 'id'))
  const accountId = teamMember.account_id
  const input = await readBody<{ templateId?: string | null; clinicId?: string | null }>(event).catch(() => null)

  let template: { name: string; body: string; show_logo: boolean } | null = null
  if (input?.templateId) {
    const { data } = await supabase.from('letter_templates').select('name, body, show_logo').eq('id', input.templateId).eq('account_id', accountId).maybeSingle()
    if (!data) throw createError({ statusCode: 404, statusMessage: 'Template not found' })
    template = data
  }

  const clinical = teamMember.is_owner || (await supabase.rpc('has_permission', { target_account_id: accountId, perm_key: 'visit_notes_access' })).data === true

  // The patient check above is the caller's; past it, every visit counts
  // (letterMergeValues says why).
  const service = serverSupabaseServiceRole<Database>(event)
  const clinic = await loadLetterClinic(service, accountId, input?.clinicId ?? null)
  const vars = await letterMergeValues(service, { accountId, patientId, clinic, clinical, authorTeamMemberId: teamMember.id })

  const source = template?.body ?? ''
  return {
    title: template?.name ?? '',
    body: fillLetterBody(source, vars),
    showLogo: template?.show_logo ?? true,
    clinicId: clinic?.id ?? null,
    clinicalOmitted: !clinical && letterTokens(source).some((key) => CLINICAL_LETTER_FIELDS.includes(key)),
  }
})

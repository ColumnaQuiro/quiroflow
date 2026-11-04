import { generateClinicalHistoryPdf, loadClinicalHistoryData } from '~/server/utils/clinicalHistory'
import { logPatientAccess } from '~/server/utils/patientAccessLog'

// Every visit note on the record as one PDF (server/utils/clinicalHistory.ts),
// from the Clinical tab. Seeing the patient is the first gate and seeing visit
// notes the second: without visit_notes_access the notes RLS would hand back
// nothing, and an empty "history" is worse than a refusal. Logged in the
// patient's access log as an export, as every PDF of the record is.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember, patientId } = await requirePatientAccess(event, getRouterParam(event, 'id'))
  if (!teamMember.is_owner) {
    const { data: allowed } = await supabase.rpc('has_permission', { target_account_id: teamMember.account_id, perm_key: 'visit_notes_access' })
    if (!allowed) throw createError({ statusCode: 403, statusMessage: 'Missing permission: visit_notes_access' })
  }

  const data = await loadClinicalHistoryData(supabase, teamMember.account_id, patientId, teamMember.id)
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })

  const lang = getQuery(event).lang === 'en' ? 'en' : 'es'
  const [pdf] = await Promise.all([
    generateClinicalHistoryPdf(data, lang),
    logPatientAccess(supabase, teamMember.account_id, 'export', patientId, { document: 'clinical_history', notes: data.notes.length }),
  ])

  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `attachment; filename="${lang === 'en' ? 'clinical-history' : 'historial-clinico'}.pdf"`)
  return pdf
})

// The posture report for one assessment (server/utils/posturePdf.ts), as a
// short-lived link rather than the bytes: the staff app opens documents in
// the system viewer from a URL, where a blob goes nowhere -- the same reason
// as patient-invoices/pdf-link.post.ts. The web opens the same link.
//
// Built fresh on every request and kept beside the assessment's photos, one
// object overwritten each time, so a corrected point is in the next report
// and deleting the assessment deletes it with the photos.
export default defineEventHandler(async (event) => {
  const assessmentId = getRouterParam(event, 'id')
  if (!assessmentId) throw createError({ statusCode: 400, statusMessage: 'Missing assessment id' })

  // The report is clinical: the permission that opens the visit notes and
  // takes the photos, and then this patient specifically.
  const { supabase, teamMember } = await requirePermission(event, 'visit_notes_access')
  const { data: row } = await supabase
    .from('posture_assessments')
    .select('patient_id')
    .eq('id', assessmentId)
    .eq('account_id', teamMember.account_id)
    .maybeSingle()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Assessment not found' })
  await requirePatientAccess(event, row.patient_id)

  const data = await loadPostureReportData(supabase, teamMember.account_id, assessmentId)
  if (!data || !data.photos.length) throw createError({ statusCode: 404, statusMessage: 'Assessment not found' })

  const pdf = await generatePostureReportPdf(data)
  const path = `${teamMember.account_id}/posture/${assessmentId}/informe.pdf`
  const { error: uploadError } = await supabase.storage.from('patient-files').upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  if (uploadError) throw createError({ statusCode: 502, statusMessage: 'Could not prepare the report' })

  const fileName = `${data.lang === 'es' ? 'informe-postural' : 'posture-report'}-${data.takenAt.slice(0, 10)}.pdf`
  const [{ data: signed, error }] = await Promise.all([
    supabase.storage.from('patient-files').createSignedUrl(path, 60 * 5),
    logPatientAccess(supabase, teamMember.account_id, 'file_downloaded', row.patient_id, { file: 'posture_report', assessment_id: assessmentId }),
  ])
  if (error || !signed) throw createError({ statusCode: 502, statusMessage: 'Could not prepare the report' })
  return { url: signed.signedUrl, fileName }
})

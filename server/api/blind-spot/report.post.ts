// The Blind Spot report for one test session (server/utils/blindSpotPdf.ts),
// as a short-lived link rather than the bytes -- the same shape as the
// posture report, so the staff app could open it in the system viewer too.
//
// Built fresh on every request and kept as one object per session, overwritten
// each time, so a corrected note is in the next report.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ sessionId?: string }>(event)
  const sessionId = body?.sessionId
  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) throw createError({ statusCode: 400, statusMessage: 'Missing test session' })

  // Reading what the Blind Spot tab shows: "See progress" or "See visit
  // notes", the account having Blind Spot, and then this patient specifically.
  const { supabase, teamMember } = await requireBlindSpot(event)
  const { data: row } = await supabase
    .from('blind_spot_tests')
    .select('patient_id')
    .eq('session_id', sessionId)
    .eq('account_id', teamMember.account_id)
    .limit(1)
    .maybeSingle()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Test not found' })
  await requirePatientAccess(event, row.patient_id)

  const data = await loadBlindSpotReportData(supabase, teamMember.account_id, sessionId)
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Test not found' })

  const pdf = await generateBlindSpotReportPdf(data)
  const path = `${teamMember.account_id}/blind-spot/${sessionId}/informe.pdf`
  const { error: uploadError } = await supabase.storage.from('patient-files').upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  if (uploadError) throw createError({ statusCode: 502, statusMessage: 'Could not prepare the report' })

  const fileName = `${data.lang === 'es' ? 'informe-punto-ciego' : 'blind-spot-report'}-${data.testedAt.slice(0, 10)}.pdf`
  const [{ data: signed, error }] = await Promise.all([
    supabase.storage.from('patient-files').createSignedUrl(path, 60 * 5),
    logPatientAccess(supabase, teamMember.account_id, 'file_downloaded', row.patient_id, { file: 'blind_spot_report', session_id: sessionId }),
  ])
  if (error || !signed) throw createError({ statusCode: 502, statusMessage: 'Could not prepare the report' })
  return { url: signed.signedUrl, fileName }
})

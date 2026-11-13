import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// The comparison of two posture assessments of one patient
// (server/utils/postureComparePdf.ts), as a short-lived link for the same
// reason as posture/[id]/report: the staff app opens documents from a URL.
// Body: { withId } -- the other assessment; which is earlier is worked out
// from their dates, not from which one is in the path.
export default defineEventHandler(async (event) => {
  const assessmentId = getRouterParam(event, 'id')
  const withId = (await readBody<{ withId?: unknown }>(event))?.withId
  if (!assessmentId || typeof withId !== 'string' || !withId) throw createError({ statusCode: 400, statusMessage: 'Two assessments are needed' })

  // Clinical, like the report: the permission that opens the visit notes,
  // and then this patient specifically.
  const { supabase, teamMember } = await requirePermission(event, 'visit_notes_access')
  const { data: rows } = await supabase.from('posture_assessments').select('id, patient_id').in('id', [assessmentId, withId]).eq('account_id', teamMember.account_id)
  if (rows?.length !== 2 || rows[0]!.patient_id !== rows[1]!.patient_id) throw createError({ statusCode: 404, statusMessage: 'Assessment not found' })
  const patientId = rows[0]!.patient_id
  await requirePatientAccess(event, patientId)

  const data = await loadPostureCompareData(supabase, teamMember.account_id, assessmentId, withId)
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Assessment not found' })

  const fileName = postureCompareFileName(data)
  const pdf = await generatePostureComparePdf(data)
  const [url] = await Promise.all([
    storePostureComparison(serverSupabaseServiceRole<Database>(event), teamMember.account_id, pdf, fileName),
    logPatientAccess(supabase, teamMember.account_id, 'file_downloaded', patientId, { file: 'posture_comparison', assessment_ids: [assessmentId, withId] }),
  ])
  if (!url) throw createError({ statusCode: 502, statusMessage: 'Could not prepare the report' })
  return { url, fileName }
})

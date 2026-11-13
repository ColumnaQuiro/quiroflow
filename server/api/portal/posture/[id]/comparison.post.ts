import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// A patient's own comparison of two posture assessments
// (server/utils/postureComparePdf.ts) -- the patient-side twin of
// api/posture/[id]/comparison. Body: { withId }, the other assessment.
//
// The authorization IS the read: it runs as the patient, so the "patients
// view own shared posture_assessments" policy decides whether BOTH rows come
// back. One that was never shared, or is someone else's, is simply not there
// and the answer is 404. Only then does the service role build the PDF, which
// needs the photos and the clinic's details a patient cannot read directly.
export default defineEventHandler(async (event) => {
  const assessmentId = getRouterParam(event, 'id')
  const withId = (await readBody<{ withId?: unknown }>(event))?.withId
  if (!assessmentId || typeof withId !== 'string' || !withId) throw createError({ statusCode: 400, statusMessage: 'Two assessments are needed' })

  const { supabase } = await requireAuthedUser(event)
  const { data: rows } = await supabase.from('posture_assessments').select('id, account_id, patient_id').in('id', [assessmentId, withId]).eq('shared_with_patient', true)
  if (rows?.length !== 2 || rows[0]!.patient_id !== rows[1]!.patient_id || rows[0]!.account_id !== rows[1]!.account_id) throw createError({ statusCode: 404, statusMessage: 'Assessment not found' })

  const service = serverSupabaseServiceRole<Database>(event)
  const data = await loadPostureCompareData(service, rows[0]!.account_id, assessmentId, withId)
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Assessment not found' })

  const url = await storePostureComparison(service, rows[0]!.account_id, await generatePostureComparePdf(data), postureCompareFileName(data))
  if (!url) throw createError({ statusCode: 502, statusMessage: 'Could not prepare the report' })
  return { url }
})

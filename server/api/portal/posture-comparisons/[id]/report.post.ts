import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// The PDF of a comparison the practitioner sent the patient
// (posture_comparisons), with their comment in it.
//
// The authorization IS the read: it runs as the patient, so the "patients
// view own shared posture_comparisons" policy decides whether the row comes
// back. The row is the permission for its two assessments, shared one by one
// or not, so only then does the service role read them and build the PDF.
export default defineEventHandler(async (event) => {
  const comparisonId = getRouterParam(event, 'id')
  if (!comparisonId) throw createError({ statusCode: 400, statusMessage: 'Missing comparison id' })

  const { supabase } = await requireAuthedUser(event)
  const { data: row } = await supabase.from('posture_comparisons').select('account_id, before_assessment_id, after_assessment_id').eq('id', comparisonId).eq('shared_with_patient', true).maybeSingle()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Comparison not found' })

  const service = serverSupabaseServiceRole<Database>(event)
  const data = await loadPostureCompareData(service, row.account_id, row.before_assessment_id, row.after_assessment_id, 'shared')
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Comparison not found' })

  const url = await storePostureComparison(service, row.account_id, await generatePostureComparePdf(data), postureCompareFileName(data))
  if (!url) throw createError({ statusCode: 502, statusMessage: 'Could not prepare the report' })
  return { url }
})

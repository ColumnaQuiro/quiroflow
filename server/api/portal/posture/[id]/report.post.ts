import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// A patient's own posture report (server/utils/posturePdf.ts), for an
// assessment their practitioner shared -- the patient-side twin of
// api/posture/[id]/report, as patient-invoices/pdf-link is of the staff
// invoice PDF.
//
// The authorization IS the read: it runs as the patient, so the "patients
// view own shared posture_assessments" policy decides whether the row comes
// back at all. Only then does the service role build the report, which needs
// the photos and the clinic's details a patient cannot read directly.
export default defineEventHandler(async (event) => {
  const assessmentId = getRouterParam(event, 'id')
  if (!assessmentId) throw createError({ statusCode: 400, statusMessage: 'Missing assessment id' })

  const { supabase } = await requireAuthedUser(event)
  const { data: row } = await supabase.from('posture_assessments').select('id, account_id').eq('id', assessmentId).eq('shared_with_patient', true).maybeSingle()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Assessment not found' })

  const service = serverSupabaseServiceRole<Database>(event)
  const data = await loadPostureReportData(service, row.account_id, assessmentId)
  if (!data || !data.photos.length) throw createError({ statusCode: 404, statusMessage: 'Assessment not found' })

  const pdf = await generatePostureReportPdf(data)
  const path = `${row.account_id}/posture/${assessmentId}/informe.pdf`
  const { error: uploadError } = await service.storage.from('patient-files').upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  if (uploadError) throw createError({ statusCode: 502, statusMessage: 'Could not prepare the report' })

  const { data: signed, error } = await service.storage.from('patient-files').createSignedUrl(path, 60 * 5)
  if (error || !signed) throw createError({ statusCode: 502, statusMessage: 'Could not prepare the report' })
  return { url: signed.signedUrl }
})

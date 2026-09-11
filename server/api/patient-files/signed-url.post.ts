import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// A patient downloading a file the clinic shared with them.
//
// Signing a storage URL needs SELECT on storage.objects, and every
// patient-files storage policy is is_account_member() -- staff only. Rather
// than add a patient storage policy that would have to re-derive "is this
// file shared with this patient" from the object path, this signs with the
// service role after asking the question in the one place that already
// knows the answer.
//
// The authorization IS the read below: it runs as the patient, so the
// "patients view own custom patient_files" policy (0162) decides. A file
// belonging to someone else, or one left at visibility 'generic', returns
// no row and this 404s. Nothing here re-implements that rule, so the two
// cannot drift apart.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ fileId?: string }>(event)
  if (!body?.fileId) {
    throw createError({ statusCode: 400, statusMessage: 'fileId is required' })
  }

  const { supabase } = await requireAuthedUser(event)

  const { data: file } = await supabase.from('patient_files').select('id, file_name, storage_path').eq('id', body.fileId).maybeSingle()
  if (!file?.storage_path) {
    throw createError({ statusCode: 404, statusMessage: 'File not found' })
  }

  const serviceSupabase = serverSupabaseServiceRole<Database>(event)
  const { data: signed, error } = await serviceSupabase.storage
    .from('patient-files')
    .createSignedUrl(file.storage_path, 60 * 5, { download: file.file_name })
  if (error || !signed) {
    throw createError({ statusCode: 502, statusMessage: 'Could not prepare the download' })
  }

  return { url: signed.signedUrl, fileName: file.file_name }
})

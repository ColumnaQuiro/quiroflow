// Called fire-and-forget right after a patient file finishes uploading
// (components/patients/FilesTab.vue) -- the upload itself goes straight
// from the browser to Storage (so a 15MB file never has to pass through a
// serverless function's request-body limit), and this endpoint's own
// payload is just a row id, so it isn't subject to that limit either. Runs
// under the calling staff member's own session (requireActiveAccount), not
// a service role -- the "patient-files" bucket's own storage policy already
// lets any account member read/write within their account's folder, so
// there's no need for elevated access here.
//
// "Compress" is now three things, all in processStoredPatientFile: the
// re-encode, a 2000 px cap on a photo's long edge, and the small thumbnail
// the Files grid shows instead of the whole file. Every way a file arrives
// calls this -- the web and mobile uploads, Import > Files, Quirocitas.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireActiveAccount(event)
  const body = await readBody<{ fileId: string }>(event)
  if (!body?.fileId) throw createError({ statusCode: 400, statusMessage: 'fileId is required' })

  const { data: file } = await supabase
    .from('patient_files')
    .select('id, storage_path, file_type, size_bytes, compressed_at, thumb_path')
    .eq('id', body.fileId)
    .eq('account_id', teamMember.account_id)
    .maybeSingle()
  if (!file || !file.storage_path) throw createError({ statusCode: 404, statusMessage: 'File not found' })
  if (file.compressed_at) return { compressed: false, reason: 'already compressed' }

  let outcome
  try {
    outcome = await processStoredPatientFile(supabase, { ...file, storage_path: file.storage_path }, { write: true })
  } catch (e: any) {
    const what = e?.message === 'download failed' ? 'Could not download file to compress' : 'Could not save the compressed file'
    throw createError({ statusCode: 502, statusMessage: what })
  }

  return { compressed: outcome.compressed, thumbnail: outcome.thumbnail, originalSize: outcome.originalSize, newSize: outcome.newSize }
})

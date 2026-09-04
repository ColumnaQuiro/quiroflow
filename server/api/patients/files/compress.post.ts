// Called fire-and-forget right after a patient file finishes uploading
// (components/patients/FilesTab.vue) -- the upload itself goes straight
// from the browser to Storage (so a 15MB file never has to pass through a
// serverless function's request-body limit), and this endpoint's own
// payload is just a row id, so it isn't subject to that limit either. Runs
// under the calling staff member's own session (requireActiveAccount), not
// a service role -- the "patient-files" bucket's own storage policy already
// lets any account member read/write within their account's folder, so
// there's no need for elevated access here.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireActiveAccount(event)
  const body = await readBody<{ fileId: string }>(event)
  if (!body?.fileId) throw createError({ statusCode: 400, statusMessage: 'fileId is required' })

  const { data: file } = await supabase
    .from('patient_files')
    .select('id, storage_path, file_type, size_bytes, compressed_at')
    .eq('id', body.fileId)
    .eq('account_id', teamMember.account_id)
    .maybeSingle()
  if (!file || !file.storage_path) throw createError({ statusCode: 404, statusMessage: 'File not found' })
  if (file.compressed_at) return { compressed: false, reason: 'already compressed' }

  const { data: downloaded, error: downloadError } = await supabase.storage.from('patient-files').download(file.storage_path)
  if (downloadError || !downloaded) throw createError({ statusCode: 502, statusMessage: 'Could not download file to compress' })

  const originalBuffer = Buffer.from(await downloaded.arrayBuffer())
  const { buffer: outputBuffer, changed } = await compressPatientFile(originalBuffer, file.file_type)

  if (changed) {
    const { error: uploadError } = await supabase.storage
      .from('patient-files')
      .upload(file.storage_path, outputBuffer, { contentType: file.file_type ?? undefined, upsert: true })
    if (uploadError) throw createError({ statusCode: 502, statusMessage: 'Could not save the compressed file' })
  }

  await supabase.from('patient_files').update({ compressed_at: new Date().toISOString(), ...(changed ? { size_bytes: outputBuffer.length } : {}) }).eq('id', file.id)

  return { compressed: changed, originalSize: originalBuffer.length, newSize: changed ? outputBuffer.length : originalBuffer.length }
})

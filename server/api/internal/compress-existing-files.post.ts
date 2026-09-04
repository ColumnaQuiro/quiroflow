// Self-serve batch pass over already-uploaded patient files -- gated
// behind the same 'data_admin' permission as Settings > Migrate Attachments,
// the other bulk file-maintenance tool in this app. Deliberately processes
// one bounded batch per call rather than looping over everything in a
// single request: with thousands of files to get through, one request
// trying to do all of them would run into the serverless function's own
// execution-time limit long before finishing. The caller (Settings >
// Compress Files) is expected to call this repeatedly until `remaining`
// hits 0, showing live progress as it goes.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requirePermission(event, 'data_admin')
  const body = await readBody<{ limit?: number }>(event).catch(() => ({ limit: undefined }))
  const limit = Math.min(Math.max(body?.limit ?? 10, 1), 25)

  const { data: batch } = await supabase
    .from('patient_files')
    .select('id, storage_path, file_type, size_bytes')
    .eq('account_id', teamMember.account_id)
    .is('compressed_at', null)
    .not('storage_path', 'is', null)
    .order('created_at', { ascending: true })
    .limit(limit)

  const results: { fileId: string; compressed: boolean; originalSize: number; newSize: number; error?: string }[] = []

  for (const file of batch ?? []) {
    try {
      const { data: downloaded, error: downloadError } = await supabase.storage.from('patient-files').download(file.storage_path!)
      if (downloadError || !downloaded) throw new Error('download failed')

      const originalBuffer = Buffer.from(await downloaded.arrayBuffer())
      const { buffer: outputBuffer, changed } = await compressPatientFile(originalBuffer, file.file_type)

      if (changed) {
        const { error: uploadError } = await supabase.storage
          .from('patient-files')
          .upload(file.storage_path!, outputBuffer, { contentType: file.file_type ?? undefined, upsert: true })
        if (uploadError) throw new Error('upload failed')
      }

      await supabase
        .from('patient_files')
        .update({ compressed_at: new Date().toISOString(), ...(changed ? { size_bytes: outputBuffer.length } : {}) })
        .eq('id', file.id)

      results.push({ fileId: file.id, compressed: changed, originalSize: originalBuffer.length, newSize: changed ? outputBuffer.length : originalBuffer.length })
    } catch (e: any) {
      // One bad file (corrupt download, a format sharp can't touch) doesn't
      // stop the batch -- mark it compressed_at anyway so it isn't retried
      // forever, and report it so it's visible rather than silently skipped.
      await supabase.from('patient_files').update({ compressed_at: new Date().toISOString() }).eq('id', file.id)
      results.push({ fileId: file.id, compressed: false, originalSize: file.size_bytes ?? 0, newSize: file.size_bytes ?? 0, error: e?.message ?? 'unknown error' })
    }
  }

  const { count: remaining } = await supabase
    .from('patient_files')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', teamMember.account_id)
    .is('compressed_at', null)
    .not('storage_path', 'is', null)

  return { results, remaining: remaining ?? 0 }
})

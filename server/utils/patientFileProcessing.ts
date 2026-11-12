import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../types/database.types'
import { patientFileThumbPath } from '../../utils/patientFileStorage'
import { compressPatientFile, makePatientFileThumbnail } from './compressPatientFile'

// One stored patient file through compression, the 2000 px resize and its
// grid thumbnail. Shared by the upload hook (/api/patients/files/compress)
// and the batch pass (/api/internal/compress-existing-files) so the two
// cannot drift apart on what "processed" means.
//
// It overwrites the original in storage, so the order is what makes it safe
// to stop anywhere:
//   1. the thumbnail, a new object nothing points at yet;
//   2. the original, replaced in one upsert (storage swaps the object whole);
//   3. the row -- size, thumb_path and the markers -- last.
// A run killed between 2 and 3 leaves a smaller file with an unmarked row;
// the next pass sees a photo already at size and leaves its pixels alone.

export interface StoredPatientFile {
  id: string
  storage_path: string
  file_type: string | null
  size_bytes: number | null
  thumb_path: string | null
}

export interface ProcessOptions {
  /** False = work everything out and write nothing (the backfill's dry run). */
  write: boolean
  /** The backfill over already-compressed files: resize and thumbnail only. */
  resizeOnly?: boolean
}

export interface ProcessOutcome {
  fileId: string
  originalSize: number
  newSize: number
  /** The original was (or, in a dry run, would be) replaced by a smaller one. */
  compressed: boolean
  /** A thumbnail was (or would be) stored. */
  thumbnail: boolean
  thumbBytes: number
  /** An image by its type that sharp could not read. Left exactly as it was. */
  undecodable: boolean
}

export async function processStoredPatientFile(supabase: SupabaseClient<Database>, file: StoredPatientFile, options: ProcessOptions): Promise<ProcessOutcome> {
  const bucket = supabase.storage.from('patient-files')
  const { data: downloaded, error: downloadError } = await bucket.download(file.storage_path)
  if (downloadError || !downloaded) throw new Error('download failed')

  const original = Buffer.from(await downloaded.arrayBuffer())
  const { buffer: output, changed } = await compressPatientFile(original, file.file_type, { resizeOnly: options.resizeOnly })

  const isImage = !!file.file_type?.startsWith('image/')
  // From the output, not the original: it is the smaller decode, and it is
  // what the grid's card will open.
  const made = isImage && !file.thumb_path ? await makePatientFileThumbnail(output, file.file_type) : { thumb: null, decoded: true }
  const thumbPath = patientFileThumbPath(file.storage_path)

  let thumbStored = false
  if (options.write) {
    if (made.thumb) {
      const { error } = await bucket.upload(thumbPath, made.thumb, { contentType: 'image/jpeg', upsert: true })
      // A thumbnail that did not store is not a failed file: the grid falls
      // back to the file itself, and the next pass tries again.
      thumbStored = !error
    }
    if (changed) {
      const { error: uploadError } = await bucket.upload(file.storage_path, output, { contentType: file.file_type ?? undefined, upsert: true })
      if (uploadError) throw new Error('upload failed')
    }
    const now = new Date().toISOString()
    const { error: rowError } = await supabase
      .from('patient_files')
      .update({
        resized_at: now,
        ...(options.resizeOnly ? {} : { compressed_at: now }),
        ...(changed ? { size_bytes: output.length } : {}),
        ...(thumbStored ? { thumb_path: thumbPath } : {}),
      })
      .eq('id', file.id)
    if (rowError) throw new Error('row update failed')
  }

  return {
    fileId: file.id,
    originalSize: original.length,
    newSize: changed ? output.length : original.length,
    compressed: changed,
    thumbnail: options.write ? thumbStored : !!made.thumb,
    thumbBytes: made.thumb && (thumbStored || !options.write) ? made.thumb.length : 0,
    undecodable: isImage && !made.decoded && !changed && !file.thumb_path,
  }
}

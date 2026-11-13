// The one-off pass over every clinic's stored files, run by QuiroFlow.
//
// Since v1.115.0 a file is compressed, capped at 2000 px and given its grid
// thumbnail as it arrives -- uploads in the web app and the mobile app, and
// both importers, all go through /api/patients/files/compress. What that
// leaves is what each clinic already had: on 13 Nov 2026, 4.2 GB of images in
// three accounts that had never been resized, and 970 PDFs never compressed.
// compress-existing-files can only work through the account of whoever calls
// it, so clearing that backlog meant asking each owner to press a button for
// something that is free to them and invisible. This does the same work for
// all of them at once, from the platform account.
//
// The same processing as the two modes of compress-existing-files, chosen
// per file: one that has never been compressed gets everything; one that was
// compressed before the cap existed gets the resize and thumbnail only, so
// its pixels are not re-encoded a second time for nothing.
//
// DRY RUN unless the body says `write: true`. When it writes it overwrites
// originals, in every clinic, and Storage keeps no previous version: do not
// run it for real before the files have been copied somewhere that does.
//
// One bounded batch per call, like its sibling: the caller loops, passing
// `nextAfter` back as `after`, until `done`. A file that fails is not marked;
// the cursor carries this run past it and a later run tries it again.
import { processStoredPatientFile, type ProcessOutcome } from '../../utils/patientFileProcessing'

// A sync function is cut off at 10 s on Netlify's base limit.
const TIME_BUDGET_MS = 6_000
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Body = { limit?: number; write?: boolean; after?: string; accountId?: string }

export default defineEventHandler(async (event) => {
  // Owners of the platform account: the only "QuiroFlow staff" there is.
  const { admin } = await requireVerifactuPlatformOwner(event)
  const body = await readBody<Body>(event).catch(() => ({}) as Body)
  const started = Date.now()
  const outOfTime = () => Date.now() - started > TIME_BUDGET_MS

  const limit = Math.min(Math.max(body?.limit ?? 5, 1), 25)
  const write = body?.write === true
  const after = typeof body?.after === 'string' && UUID.test(body.after) ? body.after : null
  const accountId = typeof body?.accountId === 'string' && UUID.test(body.accountId) ? body.accountId : null

  // Never compressed, or an image compressed before the cap and thumbnails.
  const pending = () => {
    const q = admin
      .from('patient_files')
      .select('id, account_id, storage_path, file_type, size_bytes, thumb_path, compressed_at', { count: 'exact' })
      .not('storage_path', 'is', null)
      .or(`compressed_at.is.null,and(resized_at.is.null,file_type.in.(${IMAGE_TYPES.map((t) => `"${t}"`).join(',')}))`)
    return accountId ? q.eq('account_id', accountId) : q
  }

  // Keyset on the id: a dry run marks nothing, so it needs a cursor to move at
  // all, and a writing run needs one to get past a file that keeps failing.
  const { data: batch, error: batchError } = await (after ? pending().gt('id', after) : pending()).order('id', { ascending: true }).limit(limit)
  if (batchError) throw createError({ statusCode: 500, statusMessage: batchError.message })

  const results: (ProcessOutcome & { error?: string })[] = []
  let lastId = after
  for (const file of batch ?? []) {
    if (results.length > 0 && outOfTime()) break
    lastId = file.id
    try {
      results.push(await processStoredPatientFile(admin, { ...file, storage_path: file.storage_path! }, { write, resizeOnly: !!file.compressed_at }))
    } catch (e: any) {
      results.push({ fileId: file.id, originalSize: file.size_bytes ?? 0, newSize: file.size_bytes ?? 0, compressed: false, thumbnail: false, thumbBytes: 0, undecodable: false, error: e?.message ?? 'unknown error' })
    }
  }

  const ok = results.filter((r) => !r.error)
  const bytesBefore = ok.reduce((n, r) => n + r.originalSize, 0)
  const bytesAfter = ok.reduce((n, r) => n + r.newSize, 0)
  const { count: remaining } = await pending().limit(1)

  // Totals only: no file id, name or path leaves here, since the caller is
  // looking at other clinics' records.
  return {
    dryRun: !write,
    processed: results.length,
    changed: ok.filter((r) => r.compressed).length,
    thumbnails: ok.filter((r) => r.thumbnail).length,
    undecodable: ok.filter((r) => r.undecodable).length,
    failed: results.length - ok.length,
    bytesBefore,
    bytesAfter,
    bytesSaved: bytesBefore - bytesAfter,
    thumbBytes: ok.reduce((n, r) => n + r.thumbBytes, 0),
    // Pass back as `after` for the next call of this run.
    nextAfter: lastId,
    // Reached the end of the list (as opposed to the batch or the clock).
    done: results.length === (batch ?? []).length && (batch ?? []).length < limit,
    // Files still waiting, across the accounts asked for. Does not move in a dry run.
    remaining: remaining ?? 0,
  }
})

// Self-serve batch pass over already-uploaded patient files -- gated
// behind the same 'data_admin' permission as Settings > Migrate Attachments,
// the other bulk file-maintenance tool in this app. Deliberately processes
// one bounded batch per call rather than looping over everything in a
// single request: with thousands of files to get through, one request
// trying to do all of them would run into the serverless function's own
// execution-time limit long before finishing. The caller is expected to call
// this repeatedly, showing live progress as it goes.
//
// Two modes.
//
// `compress` (the default, and what Settings > Files calls): every file that
// has never been through compression (compressed_at is null). It always
// writes, and answers { results, remaining } as it always has.
//
// `resize` is the backfill for the photos that were compressed BEFORE the
// 2000 px cap and the grid thumbnails existed -- 3,457 JPEGs, 4.5 GB, on
// 11 Nov 2026. Images only: the query never selects a PDF or a video, and
// compressPatientFile's resizeOnly returns anything else untouched. It is a
// DRY RUN unless the body says `write: true`: it downloads and processes each
// image to report what it would save, and stores nothing. It overwrites
// originals when it does write, so:
//   - each file is marked (resized_at) only after its own writes succeeded,
//     which makes a stopped run resumable from wherever it stopped;
//   - a photo already at size is not re-encoded, so a file caught between
//     "stored" and "marked" loses nothing on the second pass;
//   - an image sharp cannot read (HEIC) is left as it was and marked, so it
//     is not downloaded again on every run;
//   - a download or upload that failed is NOT marked. `nextAfter` carries the
//     caller past it for this run, and the next run tries it again.
import { processStoredPatientFile, type ProcessOutcome } from '../../utils/patientFileProcessing'

// A sync function is cut off at 10 s on Netlify's base limit. Stop taking new
// files well before that; the ones not reached are simply in the next call.
const TIME_BUDGET_MS = 6_000
const BACKFILL_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

type Body = { limit?: number; mode?: 'compress' | 'resize'; write?: boolean; after?: string }

export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireSettingsPermission(event, 'data_admin')
  const body = await readBody<Body>(event).catch(() => ({}) as Body)
  const started = Date.now()
  const outOfTime = () => Date.now() - started > TIME_BUDGET_MS

  if (body?.mode === 'resize') {
    const limit = Math.min(Math.max(body.limit ?? 5, 1), 25)
    const write = body.write === true
    const after = typeof body.after === 'string' && /^[0-9a-f-]{36}$/i.test(body.after) ? body.after : null

    const pending = () =>
      supabase
        .from('patient_files')
        .select('id, storage_path, file_type, size_bytes, thumb_path', { count: 'exact' })
        .eq('account_id', teamMember.account_id)
        .is('resized_at', null)
        .not('storage_path', 'is', null)
        .in('file_type', BACKFILL_IMAGE_TYPES)

    // Keyset on the id: a dry run marks nothing, so it needs a cursor to move
    // at all, and a writing run needs one to get past a file that keeps failing.
    // (Filters before order/limit: the builder takes them in that order.)
    const { data: batch, error: batchError } = await (after ? pending().gt('id', after) : pending()).order('id', { ascending: true }).limit(limit)
    if (batchError) throw createError({ statusCode: 500, statusMessage: batchError.message })

    const results: (ProcessOutcome & { error?: string })[] = []
    let lastId = after
    for (const file of batch ?? []) {
      if (results.length > 0 && outOfTime()) break
      lastId = file.id
      try {
        const outcome = await processStoredPatientFile(supabase, { ...file, storage_path: file.storage_path! }, { write, resizeOnly: true })
        results.push(outcome)
      } catch (e: any) {
        results.push({ fileId: file.id, originalSize: file.size_bytes ?? 0, newSize: file.size_bytes ?? 0, compressed: false, thumbnail: false, thumbBytes: 0, undecodable: false, error: e?.message ?? 'unknown error' })
      }
    }

    const ok = results.filter((r) => !r.error)
    const bytesBefore = ok.reduce((n, r) => n + r.originalSize, 0)
    const bytesAfter = ok.reduce((n, r) => n + r.newSize, 0)
    const { count: remaining } = await pending().limit(1)

    return {
      mode: 'resize' as const,
      dryRun: !write,
      processed: results.length,
      resized: ok.filter((r) => r.compressed).length,
      thumbnails: ok.filter((r) => r.thumbnail).length,
      undecodable: ok.filter((r) => r.undecodable).length,
      failed: results.length - ok.length,
      bytesBefore,
      bytesAfter,
      bytesSaved: bytesBefore - bytesAfter,
      // What the new thumbnails add back; small, but it is not nothing.
      thumbBytes: ok.reduce((n, r) => n + r.thumbBytes, 0),
      results,
      // Pass back as `after` for the next call of this run.
      nextAfter: lastId,
      // Reached the end of the list (as opposed to the batch or the clock).
      done: results.length === (batch ?? []).length && (batch ?? []).length < limit,
      // Images not yet marked, account-wide. Does not move in a dry run.
      remaining: remaining ?? 0,
    }
  }

  const limit = Math.min(Math.max(body?.limit ?? 10, 1), 25)

  const { data: batch } = await supabase
    .from('patient_files')
    .select('id, storage_path, file_type, size_bytes, thumb_path')
    .eq('account_id', teamMember.account_id)
    .is('compressed_at', null)
    .not('storage_path', 'is', null)
    .order('created_at', { ascending: true })
    .limit(limit)

  const results: { fileId: string; compressed: boolean; originalSize: number; newSize: number; error?: string }[] = []

  for (const file of batch ?? []) {
    if (results.length > 0 && outOfTime()) break
    try {
      const outcome = await processStoredPatientFile(supabase, { ...file, storage_path: file.storage_path! }, { write: true })
      results.push({ fileId: file.id, compressed: outcome.compressed, originalSize: outcome.originalSize, newSize: outcome.newSize })
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

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '../../types/database.types'
import { PracticeHubFileTooLarge, type PracticeHubLargeCopy } from '../../utils/practicehubImport/types'
import { practiceHubS3Target, refusePracticeHubS3 } from './practicehubFiles'

// Copying one PracticeHub file too big to read whole (PRACTICEHUB_LARGE_FILE_BYTES)
// from its S3 link into Storage, a piece at a time, over as many slices as it
// takes.
//
// Horizon's sync on 25-26 Nov 2026 had a 342 MB zip first in its queue. The
// ordinary copy reads a file into memory, then uploads it: every slice that
// tried took the function down before it could save anything, and the next
// slice started on the same zip. Here no more than one piece is ever held:
//
// - the bytes come from S3 by range (`Range: bytes=a-b`, which S3 serves on
//   a pre-signed link), and
// - they go to Storage through its resumable upload (TUS), which keeps what
//   it has received between requests and says how far it got.
//
// Between slices all that has to be remembered is the upload's URL, which
// is kept in import_snapshots beside the rest of the job's copy of
// PracticeHub (key `upload:<file id>`). The next slice asks Storage how far
// the upload got, not the row, so a slice cut off mid-piece loses that piece
// and nothing else. Storage forgets an unfinished upload after a day; the
// copy then starts again from the beginning.

/**
 * Storage's resumable upload takes pieces of exactly this size, all but the
 * last ("must be set to 6MB (for now)" in Supabase's own docs).
 */
export const LARGE_COPY_CHUNK_BYTES = 6 * 1024 * 1024

/**
 * One request's time, each way. A slice stops starting pieces at its own
 * deadline and lets the one in flight finish, so this is how far past the
 * deadline a slice can run: two requests short of where the function is cut
 * off. 6 MB in 5 s is 1.2 MB/s; S3 to the function and the function to
 * Storage, both in eu-west-1, are many times that.
 */
export const LARGE_COPY_REQUEST_TIMEOUT_MS = 5_000

const BUCKET = 'patient-files'
const SOURCE = 'practicehub'

/** What is remembered between calls for one file. */
export interface LargeCopyState {
  uploadUrl: string
  storagePath: string
  total: number
}

export interface LargeCopyDeps {
  fetch: typeof globalThis.fetch
  /** The project's Storage API, e.g. https://<ref>.supabase.co/storage/v1 */
  storageUrl: string
  /** The service-role key. */
  key: string
  state: {
    get(phId: string): Promise<LargeCopyState | null>
    set(phId: string, state: LargeCopyState): Promise<void>
    drop(phId: string): Promise<void>
  }
  timeoutMs?: number
}

const isTimeout = (e: unknown) => (e as { name?: string } | null)?.name === 'TimeoutError'
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

/**
 * Copies as much of one file as there is time for. `{ done: true }` once
 * Storage holds all of it; otherwise `moved` is the bytes added this call and
 * the caller calls again later with the same file.
 *
 * A request that runs out of time is not a failure: it ends the call as
 * unfinished, and the next call asks Storage where it got to. Throws
 * PracticeHubLinkExpired (S3's link lapsed: what is uploaded is kept),
 * PracticeHubFileTooLarge (Storage will not take a file that size) and an
 * Error for any other refusal.
 */
export async function copyLargePracticeHubFile(
  deps: LargeCopyDeps,
  file: PracticeHubLargeCopy,
  shouldStop: () => boolean,
): Promise<{ done: true } | { done: false; moved: number }> {
  const phId = String(file.phId)
  const timeout = deps.timeoutMs ?? LARGE_COPY_REQUEST_TIMEOUT_MS
  const auth = { authorization: `Bearer ${deps.key}`, apikey: deps.key, 'tus-resumable': '1.0.0' }
  const source = practiceHubS3Target(file.url)
  let moved = 0

  /** One piece from S3, and the file's full size from its Content-Range. */
  const piece = async (from: number, total: number | null): Promise<{ bytes: Uint8Array; total: number }> => {
    const to = (total === null ? from + LARGE_COPY_CHUNK_BYTES : Math.min(from + LARGE_COPY_CHUNK_BYTES, total)) - 1
    const res = await deps.fetch(source, { redirect: 'error', headers: { range: `bytes=${from}-${to}` }, signal: AbortSignal.timeout(timeout) })
    await refusePracticeHubS3(res)
    // 200 is the whole file, ignoring the range: reading it is the very
    // thing this exists to avoid.
    if (res.status !== 206) {
      await res.body?.cancel().catch(() => {})
      throw new Error(`PracticeHub's file server ignored the byte range (HTTP ${res.status})`)
    }
    const size = Number(/\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')?.[1])
    if (!Number.isFinite(size) || size <= 0) throw new Error('PracticeHub\'s file server did not say how big the file is')
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.length !== Math.min(to, size - 1) - from + 1) throw new Error('PracticeHub\'s file server sent a piece of the wrong size')
    return { bytes, total: size }
  }

  /** How far Storage has got with an upload; null when it no longer knows it. */
  const offsetOf = async (uploadUrl: string): Promise<number | null> => {
    const res = await deps.fetch(uploadUrl, { method: 'HEAD', headers: auth, signal: AbortSignal.timeout(timeout) })
    if (res.status === 404 || res.status === 410) return null
    if (!res.ok) throw new Error(`Storage did not say how far the upload got (HTTP ${res.status})`)
    const offset = Number(res.headers.get('upload-offset'))
    return Number.isFinite(offset) ? offset : null
  }

  try {
    let state = await deps.state.get(phId)
    // A path that changed (the patient was merged since) is a different object.
    if (state && state.storagePath !== file.storagePath) state = null
    let offset = state ? await offsetOf(state.uploadUrl) : null
    if (offset === null) state = null

    let first: Uint8Array | null = null
    if (!state) {
      if (shouldStop()) return { done: false, moved }
      const head = await piece(0, null)
      first = head.bytes
      const created = await deps.fetch(`${deps.storageUrl}/upload/resumable`, {
        method: 'POST',
        headers: {
          ...auth,
          'upload-length': String(head.total),
          'upload-metadata': `bucketName ${b64(BUCKET)},objectName ${b64(file.storagePath)},contentType ${b64(file.contentType)},cacheControl ${b64('3600')}`,
          'x-upsert': 'true',
        },
        signal: AbortSignal.timeout(timeout),
      })
      if (created.status === 413) throw new PracticeHubFileTooLarge(head.total)
      if (created.status !== 201) {
        const why = await created.text().catch(() => '')
        // Storage words its size refusal more than one way.
        if (/maximum allowed size|too large|exceed/i.test(why)) throw new PracticeHubFileTooLarge(head.total)
        throw new Error(`Storage refused the upload (HTTP ${created.status})${why ? `: ${why.slice(0, 200)}` : ''}`)
      }
      const location = created.headers.get('location')
      if (!location) throw new Error('Storage opened an upload without saying where')
      state = { uploadUrl: new URL(location, `${deps.storageUrl}/upload/resumable`).toString(), storagePath: file.storagePath, total: head.total }
      await deps.state.set(phId, state)
      offset = 0
    }

    while (offset! < state.total) {
      if (shouldStop()) return { done: false, moved }
      const bytes = offset === 0 && first ? first : (await piece(offset!, state.total)).bytes
      first = null
      const res = await deps.fetch(state.uploadUrl, {
        method: 'PATCH',
        headers: { ...auth, 'upload-offset': String(offset), 'content-type': 'application/offset+octet-stream' },
        body: bytes,
        signal: AbortSignal.timeout(timeout),
      })
      if (res.status === 409) {
        // Storage has more (or less) than we thought: a piece from a slice
        // that was cut off landed after all. Ask, and carry on from there.
        const now = await offsetOf(state.uploadUrl)
        if (now === null) {
          await deps.state.drop(phId)
          return { done: false, moved }
        }
        offset = now
        continue
      }
      if (res.status === 404 || res.status === 410) {
        // Storage has forgotten the upload: start again next call.
        await deps.state.drop(phId)
        return { done: false, moved }
      }
      if (res.status === 413) throw new PracticeHubFileTooLarge(state.total)
      if (!res.ok) throw new Error(`Storage refused part of the upload (HTTP ${res.status})`)
      const next = Number(res.headers.get('upload-offset'))
      if (!Number.isFinite(next) || next <= offset!) throw new Error('Storage did not take the piece it was sent')
      moved += next - offset!
      offset = next
    }

    await deps.state.drop(phId)
    return { done: true }
  } catch (e) {
    if (isTimeout(e)) return { done: false, moved }
    throw e
  }
}

/** copyLargePracticeHubFile against this project's Storage, remembering uploads in import_snapshots. */
export function practiceHubLargeCopier(admin: SupabaseClient<Database>, accountId: string, config: { url: string; key: string }) {
  const key = (phId: string) => `upload:${phId}`
  const deps: LargeCopyDeps = {
    fetch: (input, init) => globalThis.fetch(input, init),
    storageUrl: `${config.url.replace(/\/+$/, '')}/storage/v1`,
    key: config.key,
    state: {
      async get(phId) {
        const { data, error } = await admin.from('import_snapshots').select('data').eq('account_id', accountId).eq('source', SOURCE).eq('key', key(phId)).maybeSingle()
        if (error) throw new Error(`import_snapshots: ${error.message}`)
        return (data?.data ?? null) as unknown as LargeCopyState | null
      },
      async set(phId, state) {
        const { error } = await admin
          .from('import_snapshots')
          .upsert({ account_id: accountId, source: SOURCE, key: key(phId), data: state as unknown as Json, updated_at: new Date().toISOString() }, { onConflict: 'account_id,source,key' })
        if (error) throw new Error(`import_snapshots: ${error.message}`)
      },
      async drop(phId) {
        const { error } = await admin.from('import_snapshots').delete().eq('account_id', accountId).eq('source', SOURCE).eq('key', key(phId))
        if (error) throw new Error(`import_snapshots: ${error.message}`)
      },
    },
  }
  return (file: PracticeHubLargeCopy, shouldStop: () => boolean) => copyLargePracticeHubFile(deps, file, shouldStop)
}

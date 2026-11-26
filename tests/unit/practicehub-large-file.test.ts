import { describe, expect, it } from 'vitest'
import { copyLargePracticeHubFile, LARGE_COPY_CHUNK_BYTES, type LargeCopyDeps, type LargeCopyState } from '../../server/utils/practicehubLargeFile'
import { PracticeHubFileTooLarge, PracticeHubLinkExpired } from '../../utils/practicehubImport/types'

// The piece-by-piece copy of a PracticeHub file too big to hold in memory,
// against an S3 that serves byte ranges and a Storage that speaks the
// resumable-upload protocol, both kept in memory.

const MB = 1024 * 1024
const LINK = 'https://phub-production.s3.amazonaws.com/2085/export.zip?X-Amz-Signature=x'
const STORAGE = 'https://ref.supabase.co/storage/v1'
const FILE = { phId: 510, url: LINK, storagePath: 'acc/p1/510-export.zip', contentType: 'application/zip' }

function source(size: number) {
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) % 251
  return bytes
}

interface Upload { length: number; received: Uint8Array; offset: number; metadata: string; upsert: string | null }

function world(file: Uint8Array, opts: { limit?: number; ignoreRange?: boolean; expireLinkAfter?: number } = {}) {
  const uploads = new Map<string, Upload>()
  const state = new Map<string, LargeCopyState>()
  const log: string[] = []
  let rangeReads = 0
  let nextId = 1
  let dropNextPatchAnswer = false

  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    const method = init.method ?? 'GET'
    const headers = new Headers(init.headers)
    if (url.startsWith('https://phub-production.s3.amazonaws.com')) {
      rangeReads++
      if (opts.expireLinkAfter !== undefined && rangeReads > opts.expireLinkAfter) {
        return new Response('<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>', { status: 403 })
      }
      if (opts.ignoreRange) return new Response(file, { status: 200 })
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(headers.get('range') ?? '')!
      const from = Number(a)
      const to = Math.min(Number(b), file.length - 1)
      log.push(`GET ${from}-${to}`)
      return new Response(file.slice(from, to + 1), { status: 206, headers: { 'content-range': `bytes ${from}-${to}/${file.length}` } })
    }
    expect(headers.get('authorization')).toBe('Bearer service-key')
    expect(headers.get('tus-resumable')).toBe('1.0.0')
    if (method === 'POST' && url === `${STORAGE}/upload/resumable`) {
      const length = Number(headers.get('upload-length'))
      if (opts.limit !== undefined && length > opts.limit) return new Response('{"message":"The object exceeded the maximum allowed size"}', { status: 413 })
      const id = `u${nextId++}`
      uploads.set(id, { length, received: new Uint8Array(length), offset: 0, metadata: headers.get('upload-metadata') ?? '', upsert: headers.get('x-upsert') })
      log.push(`POST ${length}`)
      return new Response(null, { status: 201, headers: { location: `${STORAGE}/upload/resumable/${id}` } })
    }
    const id = url.split('/').at(-1)!
    const up = uploads.get(id)
    if (!up) return new Response(null, { status: 404 })
    if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'upload-offset': String(up.offset), 'upload-length': String(up.length) } })
    if (method === 'PATCH') {
      const at = Number(headers.get('upload-offset'))
      if (at !== up.offset) return new Response(null, { status: 409 })
      const body = new Uint8Array(init.body as Uint8Array)
      const last = at + body.length === up.length
      // What Storage insists on: 6 MB pieces, all but the last.
      if (!last && body.length !== LARGE_COPY_CHUNK_BYTES) return new Response('chunk size', { status: 400 })
      up.received.set(body, at)
      up.offset += body.length
      log.push(`PATCH ${at}+${body.length}`)
      if (dropNextPatchAnswer) {
        dropNextPatchAnswer = false
        const e = new Error('timed out')
        e.name = 'TimeoutError'
        throw e
      }
      return new Response(null, { status: 204, headers: { 'upload-offset': String(up.offset) } })
    }
    throw new Error(`unexpected ${method} ${url}`)
  }

  const deps: LargeCopyDeps = {
    fetch,
    storageUrl: STORAGE,
    key: 'service-key',
    state: {
      get: async (id) => state.get(id) ?? null,
      set: async (id, s) => { state.set(id, s) },
      drop: async (id) => { state.delete(id) },
    },
  }
  return { deps, uploads, state, log, loseNextPatchAnswer: () => { dropNextPatchAnswer = true }, rangeReads: () => rangeReads }
}

/** A shouldStop that answers "go on" `n` times, then "stop". */
const after = (n: number) => { let seen = 0; return () => seen++ >= n }

describe('copying a large PracticeHub file in pieces', () => {
  it('copies it all over several calls, 6 MB at a time, and forgets the upload once done', async () => {
    const file = source(20 * MB + 123)
    const w = world(file)

    // First call: opens the upload and sends two pieces, then is told to stop.
    // (Its first check is before opening the upload, so `after(3)` lets two through.)
    const first = await copyLargePracticeHubFile(w.deps, FILE, after(3))
    expect(first).toEqual({ done: false, moved: 2 * LARGE_COPY_CHUNK_BYTES })
    expect(w.state.get('510')).toMatchObject({ storagePath: FILE.storagePath, total: file.length })

    // Next slice: asks Storage where it got to and carries on.
    expect(await copyLargePracticeHubFile(w.deps, FILE, () => false)).toEqual({ done: true })
    const [up] = [...w.uploads.values()]
    expect(w.uploads.size).toBe(1)
    expect(up!.offset).toBe(file.length)
    expect(Buffer.from(up!.received).equals(Buffer.from(file))).toBe(true)
    expect(up!.upsert).toBe('true')
    expect(Buffer.from(up!.metadata.split(',').find((m) => m.startsWith('objectName '))!.split(' ')[1]!, 'base64').toString()).toBe(FILE.storagePath)
    expect(w.state.has('510')).toBe(false)
    // Never more than one piece read at a time.
    expect(w.log.filter((l) => l.startsWith('GET')).every((l) => {
      const [a, b] = l.slice(4).split('-').map(Number)
      return b! - a! + 1 <= LARGE_COPY_CHUNK_BYTES
    })).toBe(true)
  })

  it('a piece whose answer was lost is not sent twice: Storage is asked how far it got', async () => {
    const file = source(13 * MB)
    const w = world(file)
    w.loseNextPatchAnswer()
    // The first piece lands but its answer times out: unfinished, not failed.
    expect(await copyLargePracticeHubFile(w.deps, FILE, () => false)).toEqual({ done: false, moved: 0 })
    expect(await copyLargePracticeHubFile(w.deps, FILE, () => false)).toEqual({ done: true })
    expect(w.log.filter((l) => l.startsWith('PATCH'))).toEqual([`PATCH 0+${LARGE_COPY_CHUNK_BYTES}`, `PATCH ${LARGE_COPY_CHUNK_BYTES}+${LARGE_COPY_CHUNK_BYTES}`, `PATCH ${2 * LARGE_COPY_CHUNK_BYTES}+${13 * MB - 2 * LARGE_COPY_CHUNK_BYTES}`])
    expect(Buffer.from([...w.uploads.values()][0]!.received).equals(Buffer.from(file))).toBe(true)
  })

  it('starts again when Storage has forgotten the upload', async () => {
    const file = source(8 * MB)
    const w = world(file)
    w.state.set('510', { uploadUrl: `${STORAGE}/upload/resumable/gone`, storagePath: FILE.storagePath, total: file.length })
    expect(await copyLargePracticeHubFile(w.deps, FILE, () => false)).toEqual({ done: true })
    expect(w.log.filter((l) => l.startsWith('POST'))).toEqual([`POST ${file.length}`])
  })

  it('a file above Storage\'s limit says so', async () => {
    const w = world(source(10 * MB), { limit: 8 * MB })
    await expect(copyLargePracticeHubFile(w.deps, FILE, () => false)).rejects.toBeInstanceOf(PracticeHubFileTooLarge)
    expect(w.state.size).toBe(0)
  })

  it('an expired link is PracticeHubLinkExpired, and what was uploaded is kept for the fresh link', async () => {
    const file = source(20 * MB)
    const w = world(file, { expireLinkAfter: 2 })
    await expect(copyLargePracticeHubFile(w.deps, FILE, () => false)).rejects.toBeInstanceOf(PracticeHubLinkExpired)
    const [up] = [...w.uploads.values()]
    expect(up!.offset).toBe(2 * LARGE_COPY_CHUNK_BYTES)
    expect(w.state.has('510')).toBe(true)
  })

  it('refuses a server that ignores the range rather than reading the whole file', async () => {
    const w = world(source(10 * MB), { ignoreRange: true })
    await expect(copyLargePracticeHubFile(w.deps, FILE, () => false)).rejects.toThrow(/ignored the byte range/)
    expect(w.uploads.size).toBe(0)
  })

  it('follows only PracticeHub\'s S3 links', async () => {
    const w = world(source(MB))
    await expect(copyLargePracticeHubFile(w.deps, { ...FILE, url: 'http://169.254.169.254/latest/meta-data' }, () => false)).rejects.toThrow(/S3/)
    expect(w.rangeReads()).toBe(0)
  })
})

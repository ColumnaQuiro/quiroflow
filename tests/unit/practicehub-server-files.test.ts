import { afterEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import {
  planFileAttachments,
  practiceHubFileName,
  practiceHubFileStoragePath,
  practiceHubFileTriage,
  type PracticeHubFile,
} from '../../utils/practicehubImport/files'
import { planPracticeHubProfilePhotos } from '../../utils/practicehubImport/photos'
import { PracticeHubLinkExpired, type PracticeHubFileServices, type PracticeHubSnapshot } from '../../utils/practicehubImport/types'
import {
  fetchPracticeHubFile,
  PracticeHubFileDownloadFailed,
  PracticeHubFileUrlRefused,
  shrinkPracticeHubPhoto,
} from '../../server/utils/practicehubFiles'

// The two PracticeHub import steps that copy bytes -- profile photos and file
// attachments -- as the server runs them, against a database and a Storage
// kept in memory, with downloads answered by a fake. The people are invented.

type Row = Record<string, unknown>

function fakeSupabase(tables: Record<string, Row[]>) {
  const uploads: { bucket: string; path: string; contentType?: string; upsert?: boolean; size: number }[] = []
  const from = (table: string) => {
    const rows = () => (tables[table] ??= [])
    const q = { op: 'select', values: undefined as unknown, filters: [] as [string, string, unknown][], range: null as [number, number] | null, count: false }
    const match = (r: Row) => q.filters.every(([kind, col, v]) =>
      kind === 'eq' ? r[col] === v
        : kind === 'is' ? (r[col] ?? null) === v
          : kind === 'not-null' ? r[col] != null
            : String(r[col] ?? '').startsWith(String(v).replace(/%$/, '')))
    const run = () => {
      if (q.op === 'insert') {
        const added = ([] as Row[]).concat(q.values as Row[]).map((v, i) => ({ id: `${table}-${rows().length + i + 1}`, ...v }))
        rows().push(...added)
        return { data: added, error: null }
      }
      if (q.op === 'update') {
        const hit = rows().filter(match)
        for (const r of hit) Object.assign(r, q.values)
        return { data: hit, error: null }
      }
      const found = rows().filter(match)
      const page = q.range ? found.slice(q.range[0], q.range[1] + 1) : found
      return { data: page, error: null, count: q.count ? found.length : null }
    }
    const filter = (kind: string) => (col: string, v: unknown) => { q.filters.push([kind, col, v]); return b }
    const one = (strict: boolean) => Promise.resolve().then(() => {
      const res = run() as { data: Row[] }
      if (res.data.length > 1) return { data: null, error: { message: 'more than one row' } }
      if (strict && !res.data.length) return { data: null, error: { message: 'no rows' } }
      return { data: res.data[0] ?? null, error: null }
    })
    const b: Record<string, unknown> = {
      select: (_c?: string, opts?: { count?: string }) => { if (opts?.count) q.count = true; return b },
      order: () => b,
      insert: (v: unknown) => { q.op = 'insert'; q.values = v; return b },
      update: (v: unknown) => { q.op = 'update'; q.values = v; return b },
      eq: filter('eq'),
      is: filter('is'),
      like: filter('like'),
      not: (col: string, op: string, v: unknown) => { if (op !== 'is' || v !== null) throw new Error('not'); q.filters.push(['not-null', col, null]); return b },
      range: (a: number, z: number) => { q.range = [a, z]; return b },
      maybeSingle: () => one(false),
      single: () => one(true),
      then: (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, no),
    }
    return b
  }
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, bytes: Uint8Array, opts: { contentType?: string; upsert?: boolean }) => {
        uploads.push({ bucket, path, contentType: opts.contentType, upsert: opts.upsert, size: bytes.length })
        return { data: { path }, error: null }
      },
    }),
  }
  return { client: { from, storage }, uploads }
}

const ACCOUNT = 'acc'
const OTHER = 'other-acc'
const t = (en: string) => en
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])
const link = (name: string) => `https://phub-production.s3.amazonaws.com/2085/${name}?X-Amz-Signature=x`

function fakeFiles(answer: (url: string) => Uint8Array | Error = () => JPEG) {
  const fetched: string[] = []
  const compressed: string[] = []
  const services: PracticeHubFileServices = {
    async fetch(url) {
      fetched.push(url)
      const a = answer(url)
      if (a instanceof Error) throw a
      return { bytes: a, contentType: 'application/octet-stream' }
    },
    async compressFile(fileId) { compressed.push(fileId) },
    async shrinkPhoto(bytes) { return bytes[0] === 0xff ? { bytes: JPEG, contentType: 'image/jpeg' } : null },
  }
  return { services, fetched, compressed }
}

const phFile = (id: number, patient_id: number | null, over: Partial<PracticeHubFile> = {}): PracticeHubFile => ({
  id, patient_id, size: 2048, file_name: `scan-${id}.pdf`, entity_type: 'patient', file_type: null, description: null,
  mime_type: 'application/pdf', url: link(`file-${id}`), created: '2026-03-01T10:00:00Z', ...over,
})

function snapshot(files: PracticeHubFile[] = []): PracticeHubSnapshot {
  return {
    readAt: '2026-11-18T10:00:00Z',
    baseUrl: 'https://demo.practicehub.io',
    lists: {
      '/patients': [
        { id: 11, patient_number: '1001', first_name: 'Ana', last_name: 'Prueba', profile_image: link('photo-11') },
        { id: 12, patient_number: '1002', first_name: 'Bruno', last_name: 'Ejemplo', profile_image: link('photo-12') },
        { id: 13, patient_number: '1003', first_name: 'Carla', last_name: 'Inventada', profile_image: link('photo-13') },
        { id: 14, patient_number: '1004', first_name: 'Dario', last_name: 'Ficticio', profile_image: null },
      ],
      '/files': files,
    },
  }
}

function clinic(): Record<string, Row[]> {
  return {
    patients: [
      { id: 'p1', account_id: ACCOUNT, external_reference: '1001', photo_storage_path: null },
      { id: 'p2', account_id: ACCOUNT, external_reference: '1002', photo_storage_path: 'acc/p2/taken-here.jpg' },
      // Another clinic's patient with the same Patient Number: never matched.
      { id: 'x3', account_id: OTHER, external_reference: '1003', photo_storage_path: null },
      { id: 'p4', account_id: ACCOUNT, external_reference: '1004', photo_storage_path: null },
    ],
    patient_files: [
      // Another clinic's import of a file with the same PracticeHub id: not "here".
      { id: 'xf', account_id: OTHER, external_reference: '501', storage_path: 'other-acc/x3/501-scan.pdf' },
    ],
  }
}

const ctxFor = (client: unknown, files: PracticeHubFileServices | null) =>
  ({ supabase: client as never, accountId: ACCOUNT, clinicId: 'c1', defaultPhoneCountry: 'ES', t, files })

describe('which PracticeHub files to bring', () => {
  const phPatients = [{ id: 11, patient_number: '1001' }, { id: 12, patient_number: '1002' }]
  const ours = [{ id: 'p1', external_reference: '1001' }]

  it('counts every reason a file is not brought on its own', () => {
    const triage = practiceHubFileTriage(
      [
        phFile(1, 11),
        phFile(2, 11, { entity_type: 'report' }),
        phFile(3, 11, { url: null }),
        phFile(4, 12), // in PracticeHub, not here
        phFile(5, 99), // patient deleted in PracticeHub
        phFile(6, 11), // stored already
        phFile(7, 11), // a placeholder with no bytes yet: brought
      ],
      phPatients,
      ours,
      [{ external_reference: '6', storage_path: 'acc/p1/6-scan.pdf' }, { external_reference: '7', storage_path: null }],
    )
    expect(triage.queue.map((q) => [q.ph.id, q.patientId])).toEqual([[1, 'p1'], [7, 'p1']])
    expect(triage).toMatchObject({ alreadyHere: 1, notPatientFiles: 1, noDownloadUrl: 1, noPatientMatch: 1, patientDeletedInPh: 1, unmatchedPhPatients: [12] })
  })

  it('names a file by PracticeHub id, in a key Storage accepts', () => {
    expect(practiceHubFileName({ id: 9, file_name: '  ' })).toBe('practicehub-9')
    expect(practiceHubFileStoragePath('acc', 'p1', { id: 9, file_name: 'Radiografía columna ñ.pdf' })).toBe('acc/p1/9-Radiografia_columna_n.pdf')
  })
})

describe('the File attachments step on the server', () => {
  const files = () => [phFile(501, 11), phFile(502, 11), phFile(503, 13), phFile(504, 14)]

  it('plans only from this account, and stores every file with it', async () => {
    const tables = clinic()
    // A placeholder the CSV importer made for 502: filled in, not duplicated.
    tables.patient_files!.push({ id: 'ph502', account_id: ACCOUNT, patient_id: 'p1', external_reference: '502', storage_path: null })
    const { client, uploads } = fakeSupabase(tables)
    const { services, compressed } = fakeFiles()
    const plan = await planFileAttachments(ctxFor(client, services), snapshot(files()))
    // 503's patient number belongs to another clinic here.
    expect(plan.total).toBe(3)
    expect(plan.stats.find((s) => s.label === 'No patient here')!.value).toBe('1')

    const done: number[] = []
    expect(await plan.apply((n) => done.push(n), () => false)).toEqual({ written: 3, errors: [] })
    expect(done.at(-1)).toBe(3)
    expect(uploads.map((u) => [u.bucket, u.path, u.contentType, u.upsert])).toEqual(expect.arrayContaining([
      ['patient-files', 'acc/p1/501-scan-501.pdf', 'application/pdf', true],
      ['patient-files', 'acc/p1/502-scan-502.pdf', 'application/pdf', true],
      ['patient-files', 'acc/p4/504-scan-504.pdf', 'application/pdf', true],
    ]))
    const mine = tables.patient_files!.filter((f) => f.account_id === ACCOUNT)
    expect(mine.map((f) => [f.external_reference, f.patient_id, f.storage_path]).sort()).toEqual([
      ['501', 'p1', 'acc/p1/501-scan-501.pdf'],
      ['502', 'p1', 'acc/p1/502-scan-502.pdf'],
      ['504', 'p4', 'acc/p4/504-scan-504.pdf'],
    ])
    expect(mine.find((f) => f.external_reference === '501')).toMatchObject({ file_name: 'scan-501.pdf', file_type: 'application/pdf', size_bytes: 2048, created_at: '2026-03-01T10:00:00Z' })
    expect(tables.patient_files!.find((f) => f.id === 'xf')!.storage_path).toBe('other-acc/x3/501-scan.pdf')
    expect(compressed.sort()).toEqual(mine.map((f) => f.id).sort())

    const again = await planFileAttachments(ctxFor(client, services), snapshot(files()))
    expect(again.total).toBe(0)
  })

  it('stops starting files when the slice says stop, and the next slice brings the rest', async () => {
    const tables = clinic()
    const { client } = fakeSupabase(tables)
    const { services, fetched } = fakeFiles()
    const plan = await planFileAttachments(ctxFor(client, services), snapshot(files()))
    let checks = 0
    const first = await plan.apply(() => {}, () => ++checks > 1)
    expect(first.written).toBe(1)
    expect(fetched).toHaveLength(1)

    const next = await planFileAttachments(ctxFor(client, services), snapshot(files()))
    expect(next.total).toBe(2)
    expect((await next.apply(() => {}, () => false)).written).toBe(2)
  })

  it('an expired link stops the step without counting that file as failed or done', async () => {
    const tables = clinic()
    const { client } = fakeSupabase(tables)
    const { services, fetched } = fakeFiles((url) => (url.includes('file-502') ? new PracticeHubLinkExpired() : JPEG))
    // Three at a time: 501, 502 and 504 start together; 505 and 506 would be next.
    const plan = await planFileAttachments(ctxFor(client, services), snapshot([...files(), phFile(505, 11), phFile(506, 11)]))
    const done: number[] = []
    const result = await plan.apply((n) => done.push(n), () => false)
    expect(result).toEqual({ written: 2, errors: [], linksExpired: true })
    // The two in flight finish; nothing new starts; 502 is not done.
    expect(fetched.filter((u) => /file-50[56]/.test(u))).toEqual([])
    expect(done).toEqual([1, 2])
    expect(tables.patient_files!.some((f) => f.external_reference === '502')).toBe(false)
  })

  it('a file that fails is an error, and the others carry on', async () => {
    const tables = clinic()
    const { client } = fakeSupabase(tables)
    const { services } = fakeFiles((url) => (url.includes('file-501') ? new Error('PracticeHub file download failed (HTTP 500)') : JPEG))
    const result = await (await planFileAttachments(ctxFor(client, services), snapshot(files()))).apply(() => {}, () => false)
    expect(result).toEqual({ written: 2, errors: ['scan-501.pdf: PracticeHub file download failed (HTTP 500)'] })
  })

  it('in a preview, plans and writes nothing', async () => {
    const tables = clinic()
    const { client, uploads } = fakeSupabase(tables)
    const plan = await planFileAttachments(ctxFor(client, null), snapshot(files()))
    expect(plan.total).toBe(3)
    const result = await plan.apply(() => {}, () => false)
    expect(result.written).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(uploads).toHaveLength(0)
  })
})

describe('the Profile photos step on the server', () => {
  it('brings photos only for this account’s patients who have none, and leaves a photo taken here alone', async () => {
    const tables = clinic()
    const { client, uploads } = fakeSupabase(tables)
    const { services, fetched } = fakeFiles()
    const plan = await planPracticeHubProfilePhotos(ctxFor(client, services), snapshot())
    // p1 only: p2 has a photo here, 1003 is another clinic's, 1004 has none in PracticeHub.
    expect(plan.total).toBe(1)
    expect(plan.rows).toEqual([{ patient: 'Ana Prueba', number: '1001' }])

    expect(await plan.apply(() => {}, () => false)).toEqual({ written: 1, errors: [] })
    expect(fetched).toEqual([link('photo-11')])
    expect(uploads).toEqual([{ bucket: 'patient-photos', path: 'acc/p1/practicehub.jpg', contentType: 'image/jpeg', upsert: true, size: JPEG.length }])
    expect(tables.patients!.map((p) => p.photo_storage_path)).toEqual(['acc/p1/practicehub.jpg', 'acc/p2/taken-here.jpg', null, null])

    expect((await planPracticeHubProfilePhotos(ctxFor(client, services), snapshot())).total).toBe(0)
  })

  it('counts a photo that is not a picture, and stores nothing for it', async () => {
    const tables = clinic()
    const { client, uploads } = fakeSupabase(tables)
    const { services } = fakeFiles(() => PDF)
    const result = await (await planPracticeHubProfilePhotos(ctxFor(client, services), snapshot())).apply(() => {}, () => false)
    expect(result.written).toBe(0)
    expect(result.errors).toEqual([expect.stringContaining('1 patients have something other than a picture')])
    expect(uploads).toHaveLength(0)
    expect(tables.patients!.find((p) => p.id === 'p1')!.photo_storage_path).toBeNull()
  })

  it('never overwrites a photo taken here between the plan and the write', async () => {
    const tables = clinic()
    const { client } = fakeSupabase(tables)
    const plan = await planPracticeHubProfilePhotos(ctxFor(client, fakeFiles().services), snapshot())
    tables.patients!.find((p) => p.id === 'p1')!.photo_storage_path = 'acc/p1/just-taken.jpg'
    expect((await plan.apply(() => {}, () => false)).written).toBe(0)
    expect(tables.patients!.find((p) => p.id === 'p1')!.photo_storage_path).toBe('acc/p1/just-taken.jpg')
  })

  it('an expired link says so, with no error', async () => {
    const { client } = fakeSupabase(clinic())
    const { services } = fakeFiles(() => new PracticeHubLinkExpired())
    const result = await (await planPracticeHubProfilePhotos(ctxFor(client, services), snapshot())).apply(() => {}, () => false)
    expect(result).toEqual({ written: 0, errors: [], linksExpired: true })
  })

  it('a failed photo does not fail the step', async () => {
    const { client } = fakeSupabase(clinic())
    const { services } = fakeFiles(() => new Error('socket hang up'))
    const result = await (await planPracticeHubProfilePhotos(ctxFor(client, services), snapshot())).apply(() => {}, () => false)
    expect(result.written).toBe(0)
    expect(result.errors).toEqual(['Profile photos not copied: 1 (socket hang up). Run this step again to retry them.'])
  })
})

describe('downloading a PracticeHub file', () => {
  afterEach(() => vi.unstubAllGlobals())
  const answer = (status: number, body: BodyInit | null = '', headers: Record<string, string> = {}) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, headers })))

  it('follows only https links on amazonaws.com', async () => {
    answer(200, 'x')
    for (const url of ['not a url', 'http://phub-production.s3.amazonaws.com/x', 'https://evil-amazonaws.com/x', 'https://amazonaws.com.attacker.net/x', 'http://169.254.169.254/latest/meta-data/', 'file:///etc/passwd']) {
      await expect(fetchPracticeHubFile(url), url).rejects.toBeInstanceOf(PracticeHubFileUrlRefused)
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns the bytes and their type, without following redirects', async () => {
    answer(200, new Uint8Array([1, 2, 3]), { 'content-type': 'application/pdf' })
    const file = await fetchPracticeHubFile(link('a'), { timeoutMs: 15_000 })
    expect([...file.bytes]).toEqual([1, 2, 3])
    expect(file.contentType).toBe('application/pdf')
    expect(vi.mocked(fetch).mock.calls[0]![1]).toMatchObject({ redirect: 'error' })
  })

  it('tells an expired link from a file S3 refuses for another reason', async () => {
    answer(403, '<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>')
    await expect(fetchPracticeHubFile(link('a'))).rejects.toBeInstanceOf(PracticeHubLinkExpired)
    answer(403, '')
    await expect(fetchPracticeHubFile(link('a'))).rejects.toBeInstanceOf(PracticeHubLinkExpired)
    // What S3 says for an object that is not there: reading the list again would not help.
    answer(403, '<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>')
    await expect(fetchPracticeHubFile(link('a'))).rejects.toMatchObject({ status: 403 })
    answer(500)
    await expect(fetchPracticeHubFile(link('a'))).rejects.toEqual(new PracticeHubFileDownloadFailed(500))
  })
})

describe('shrinking a profile photo', () => {
  it('makes a JPEG whose short side is 256, upright, never larger', async () => {
    const png = await sharp({ create: { width: 1200, height: 800, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 0.5 } } }).png().toBuffer()
    const out = await shrinkPracticeHubPhoto(new Uint8Array(png))
    expect(out!.contentType).toBe('image/jpeg')
    expect(await sharp(Buffer.from(out!.bytes)).metadata()).toMatchObject({ format: 'jpeg', width: 384, height: 256 })

    // Stored on its side with an orientation tag, as phones do.
    const sideways = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#808080' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer()
    const upright = await shrinkPracticeHubPhoto(new Uint8Array(sideways))
    expect(await sharp(Buffer.from(upright!.bytes)).metadata()).toMatchObject({ width: 256, height: 341 })
  })

  it('leaves a small photo as it was when re-encoding would not help', async () => {
    const small = new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: '#fff' } }).jpeg({ quality: 40 }).toBuffer())
    expect((await shrinkPracticeHubPhoto(small))!.bytes).toBe(small)
  })

  it('is null for something that is not a picture', async () => {
    expect(await shrinkPracticeHubPhoto(PDF)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { finishPracticeHubRead, loadPracticeHubPassList, loadPracticeHubSnapshot, savePracticeHubPage } from '../../server/utils/practicehubSnapshotStore'
import type { PracticeHubListPath } from '../../utils/practicehubImport/types'

// Loading the copy read from PracticeHub out of import_snapshots, against a
// table kept in memory. What matters is what a step's slice fetches: the
// whole copy of a large clinic (77 MB, 1,191 pages) was more than a slice
// could load and still plan, so a step loads only its own lists.

interface Stored { account_id: string; source: string; key: string; data: unknown }

/**
 * Text compared the way production's en_US collation does it, near enough:
 * punctuation is ignored until everything else is equal. A key-range bound
 * that only works in byte order (`< '…:/appointments:~'`) found none of a
 * real clinic's 334 pages, and a fake table comparing bytes passed it.
 */
const collate = (a: string, b: string) => {
  const strip = (s: string) => s.replace(/[^a-z0-9]/gi, '')
  const [x, y] = [strip(a), strip(b)]
  if (x !== y) return x < y ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

function fakeTable() {
  const rows: Stored[] = []
  /** Every key a select handed back, in the order it did. */
  const fetched: string[] = []
  const from = () => {
    const q = { op: 'select', values: [] as Stored[], filters: [] as ((r: Stored) => boolean)[], single: false, limit: Infinity, ordered: false }
    const run = () => {
      let hit = rows.filter((r) => q.filters.every((f) => f(r)))
      if (q.op === 'upsert') {
        for (const v of q.values) {
          const i = rows.findIndex((r) => r.account_id === v.account_id && r.source === v.source && r.key === v.key)
          if (i >= 0) rows[i] = v; else rows.push(v)
        }
        return { data: null, error: null }
      }
      if (q.op === 'delete') {
        for (const r of hit) rows.splice(rows.indexOf(r), 1)
        return { data: null, error: null }
      }
      if (q.ordered) hit = [...hit].sort((a, b) => collate(a.key, b.key))
      hit = hit.slice(0, q.limit)
      if (q.single) return { data: hit[0] ?? null, error: null }
      fetched.push(...hit.map((r) => r.key))
      return { data: hit, error: null }
    }
    const likes = (v: string) => (r: Stored) => r.key.startsWith(v.replace(/%$/, ''))
    const b: Record<string, unknown> = {
      select: () => b,
      upsert: (v: Stored | Stored[]) => { q.op = 'upsert'; q.values = Array.isArray(v) ? v : [v]; return b },
      delete: () => { q.op = 'delete'; return b },
      eq: (col: keyof Stored, v: unknown) => { q.filters.push((r) => r[col] === v); return b },
      lt: (col: 'key', v: string) => { q.filters.push((r) => collate(r[col], v) < 0); return b },
      gt: (col: 'key', v: string) => { q.filters.push((r) => collate(r[col], v) > 0); return b },
      gte: (col: 'key', v: string) => { q.filters.push((r) => collate(r[col], v) >= 0); return b },
      like: (_col: 'key', v: string) => { q.filters.push(likes(v)); return b },
      not: (_col: 'key', _op: 'like', v: string) => { const f = likes(v); q.filters.push((r) => !f(r)); return b },
      order: () => { q.ordered = true; return b },
      limit: (n: number) => { q.limit = n; return b },
      maybeSingle: () => { q.single = true; return b },
      then: (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, no),
    }
    return b
  }
  return { admin: { from } as never, rows, fetched }
}

const ACCOUNT = 'acc'
const PASS = 'pass-1'

/** Saves `pages` pages of `path` under PASS, page n holding ids (n-1)*perPage+1 onwards. */
async function savePages(t: ReturnType<typeof fakeTable>, path: string, pages: number, perPage = 3, firstPage = 1) {
  for (let page = firstPage; page < firstPage + pages; page++) {
    const rows = Array.from({ length: perPage }, (_, i) => ({ id: (page - 1) * perPage + i + 1, path }))
    await savePracticeHubPage(t.admin, ACCOUNT, PASS, path, page, rows)
  }
}

async function finish(t: ReturnType<typeof fakeTable>, pages: Partial<Record<PracticeHubListPath, number>>) {
  await finishPracticeHubRead(t.admin, ACCOUNT, { readAt: '2026-11-25T10:00:00Z', baseUrl: 'https://x.practicehub.io', pass: PASS, pages })
}

const ids = (rows: unknown[] | undefined) => (rows ?? []).map((r) => (r as { id: number }).id)

describe('the PracticeHub copy in import_snapshots', () => {
  it('loads only the lists a step asks for, and leaves the rest out so they cannot be mistaken for empty', async () => {
    const t = fakeTable()
    await savePages(t, '/patients', 2)
    await savePages(t, '/patient_packages', 2)
    await savePages(t, '/v3/patients', 2)
    await savePages(t, '/appointments', 3)
    await savePages(t, '/custom_form_responses', 4)
    await finish(t, { '/patients': 2, '/patient_packages': 2, '/v3/patients': 2, '/appointments': 3, '/custom_form_responses': 4 })

    const snapshot = await loadPracticeHubSnapshot(t.admin, ACCOUNT, ['/appointments', '/patients'])
    expect(Object.keys(snapshot!.lists).sort()).toEqual(['/appointments', '/patients'])
    expect(ids(snapshot!.lists['/patients'])).toEqual([1, 2, 3, 4, 5, 6])
    expect(ids(snapshot!.lists['/appointments'])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    // Neither a list whose name starts the same nor one it was not asked for.
    expect(t.fetched.length).toBe(5)
    expect(t.fetched.every((key) => key.includes(':/appointments:') || key.includes(':/patients:'))).toBe(true)
  })

  it('still loads the whole copy when no lists are named', async () => {
    const t = fakeTable()
    await savePages(t, '/patients', 1)
    await savePages(t, '/appointments', 1)
    await finish(t, { '/patients': 1, '/appointments': 1, '/payments': 0 })
    const snapshot = await loadPracticeHubSnapshot(t.admin, ACCOUNT)
    expect(Object.keys(snapshot!.lists).sort()).toEqual(['/appointments', '/patients', '/payments'])
    expect(snapshot!.lists['/payments']).toEqual([])
  })

  it('reads every page of a long list, past each request and past a page numbered beyond the count', async () => {
    const t = fakeTable()
    await savePages(t, '/appointments', 34)
    // A page the count does not cover is still the list's: never dropped.
    await savePages(t, '/appointments', 1, 3, 120)
    await finish(t, { '/appointments': 34 })
    const snapshot = await loadPracticeHubSnapshot(t.admin, ACCOUNT, ['/appointments'])
    const got = ids(snapshot!.lists['/appointments'])
    expect(got).toHaveLength(35 * 3)
    expect(got.slice(0, 6)).toEqual([1, 2, 3, 4, 5, 6])
    expect(new Set(got).size).toBe(got.length)
    // Each page once.
    expect(new Set(t.fetched).size).toBe(t.fetched.length)
  })

  it('keeps one record per id, the later page winning, as fetchAll does', async () => {
    const t = fakeTable()
    await savePracticeHubPage(t.admin, ACCOUNT, PASS, '/invoices', 1, [{ id: 7, total: 10 }, { id: 8, total: 20 }])
    await savePracticeHubPage(t.admin, ACCOUNT, PASS, '/invoices', 2, [{ id: 7, total: 15 }, { note: 'no id' }])
    await finish(t, { '/invoices': 2 })
    const snapshot = await loadPracticeHubSnapshot(t.admin, ACCOUNT, ['/invoices'])
    expect(snapshot!.lists['/invoices']).toEqual([{ id: 7, total: 15 }, { id: 8, total: 20 }, { note: 'no id' }])
  })

  it('keeps the later page winning when the pages come back in different requests', async () => {
    const t = fakeTable()
    await savePracticeHubPage(t.admin, ACCOUNT, PASS, '/invoices', 1, [{ id: 7, total: 10 }])
    await savePages(t, '/payments', 1)
    for (let page = 2; page <= 24; page++) await savePracticeHubPage(t.admin, ACCOUNT, PASS, '/invoices', page, [{ id: 100 + page }])
    await savePracticeHubPage(t.admin, ACCOUNT, PASS, '/invoices', 25, [{ id: 7, total: 99 }])
    await finish(t, { '/invoices': 25 })
    const snapshot = await loadPracticeHubSnapshot(t.admin, ACCOUNT, ['/invoices'])
    expect(snapshot!.lists['/invoices']).toContainEqual({ id: 7, total: 99 })
    expect(snapshot!.lists['/invoices']).toHaveLength(24)
  })

  it('refuses a copy whose pages of a requested list have gone', async () => {
    const t = fakeTable()
    await savePages(t, '/patients', 1)
    await finish(t, { '/patients': 1, '/appointments': 3 })
    await expect(loadPracticeHubSnapshot(t.admin, ACCOUNT, ['/appointments'])).rejects.toThrow('the pages of /appointments are missing')
    // A list the step does not need is not looked at, broken or not.
    expect(ids((await loadPracticeHubSnapshot(t.admin, ACCOUNT, ['/patients']))!.lists['/patients'])).toEqual([1, 2, 3])
  })

  it('loads a fresh link list read under a pass of its own', async () => {
    const t = fakeTable()
    for (let page = 1; page <= 23; page++) await savePracticeHubPage(t.admin, ACCOUNT, 'links-9', '/files', page, [{ id: page }])
    await savePracticeHubPage(t.admin, ACCOUNT, 'links-9', '/files_other', 1, [{ id: 999 }])
    expect(ids(await loadPracticeHubPassList(t.admin, ACCOUNT, 'links-9', '/files'))).toEqual(Array.from({ length: 23 }, (_, i) => i + 1))
  })

  it('is null before PracticeHub has been read in full', async () => {
    expect(await loadPracticeHubSnapshot(fakeTable().admin, ACCOUNT, ['/patients'])).toBeNull()
  })
})

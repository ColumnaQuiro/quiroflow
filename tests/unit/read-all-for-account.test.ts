import { describe, it, expect } from 'vitest'
import { readAllForAccount, uuidSliceStarts, PRACTICEHUB_PAGE } from '../../utils/practicehubImport/appointments'

// readAllForAccount against a table kept in memory that answers the PostgREST
// calls it makes, and records each one: what matters is that every row comes
// back once, in id order, and that a large table is never read by offset.

type Row = { id: string; account_id: string; external_reference: string | null; n: number }
type Call = { range: [number, number] | null; limit: number | null; rows: number }

const hex = (n: number, width: number) => n.toString(16).padStart(width, '0')
/** A uuid whose first eight digits are `head`, so a test decides where it falls. */
const uuid = (head: number, tail: number) => `${hex(head, 8)}-0000-4000-8000-${hex(tail, 12)}`

function fakeSupabase(rows: Row[], opts: { count?: boolean } = {}) {
  const calls: Call[] = []
  const from = () => {
    const q = { tests: [] as ((r: Row) => boolean)[], range: null as [number, number] | null, limit: null as number | null, count: false }
    const where = (test: (r: Row) => boolean) => { q.tests.push(test); return b }
    const b: Record<string, unknown> = {
      select: (_c: string, o?: { count?: string }) => { q.count = !!o?.count; return b },
      eq: (col: keyof Row, v: unknown) => where((r) => r[col] === v),
      like: (col: keyof Row, v: string) => where((r) => String(r[col] ?? '').startsWith(v.replace(/%$/, ''))),
      gte: (col: keyof Row, v: string) => where((r) => String(r[col]) >= v),
      gt: (col: keyof Row, v: string) => where((r) => String(r[col]) > v),
      lt: (col: keyof Row, v: string) => where((r) => String(r[col]) < v),
      order: () => b,
      range: (a: number, z: number) => { q.range = [a, z]; return b },
      limit: (n: number) => { q.limit = n; return b },
      then: (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve().then(() => {
        const found = rows.filter((r) => q.tests.every((t) => t(r))).sort((x, y) => (x.id < y.id ? -1 : 1))
        // PostgREST never returns more than 1,000 rows, asked or not.
        const page = (q.range ? found.slice(q.range[0], q.range[1] + 1) : found.slice(0, q.limit ?? 1000)).slice(0, 1000)
        calls.push({ range: q.range, limit: q.limit, rows: page.length })
        return { data: page.map((r) => ({ ...r })), error: null, count: q.count && opts.count !== false ? found.length : null }
      }).then(ok, no),
    }
    return b
  }
  return { client: { from } as never, calls }
}

/** `size` rows of the account spread evenly over the id space, plus another clinic's in between. */
function spread(size: number): Row[] {
  const step = Math.floor(2 ** 32 / size)
  return Array.from({ length: size }, (_, i) => [
    { id: uuid(i * step, i), account_id: 'acc', external_reference: i % 2 ? `PH-${i}` : null, n: i },
    { id: uuid(i * step + 1, i), account_id: 'other', external_reference: `PH-x${i}`, n: -1 },
  ]).flat()
}

describe('readAllForAccount', () => {
  it('reads a table that fits in a page with one request', async () => {
    const { client, calls } = fakeSupabase(spread(300))
    const rows = await readAllForAccount<Row>(client, 'acc', 'appointments', 'id, n')
    expect(rows.map((r) => r.n)).toEqual(Array.from({ length: 300 }, (_, i) => i))
    expect(calls).toHaveLength(1)
  })

  it('reads a large table by slices of the id space, never by offset', async () => {
    const { client, calls } = fakeSupabase(spread(6500))
    const rows = await readAllForAccount<Row>(client, 'acc', 'appointments', 'id, n')
    expect(rows.map((r) => r.n)).toEqual(Array.from({ length: 6500 }, (_, i) => i))
    // Only the first page is positional; after it nothing skips rows to reach its own.
    expect(calls.filter((c) => c.range).map((c) => c.range)).toEqual([[0, PRACTICEHUB_PAGE - 1]])
    // About a page per slice: no more requests than a few over what offset paging made.
    expect(calls.length).toBeLessThanOrEqual(12)
  })

  it('continues a slice that holds more than a page, so skewed ids lose nothing', async () => {
    // Every id in the first sixteenth of the space.
    const rows = Array.from({ length: 3200 }, (_, i) => ({ id: uuid(i, i), account_id: 'acc', external_reference: null, n: i }))
    const { client } = fakeSupabase(rows)
    const read = await readAllForAccount<Row>(client, 'acc', 'appointments', 'id, n')
    expect(read.map((r) => r.n)).toEqual(Array.from({ length: 3200 }, (_, i) => i))
  })

  it('applies the caller\'s filter to every slice', async () => {
    const { client } = fakeSupabase(spread(5000))
    const rows = await readAllForAccount<Row>(client, 'acc', 'appointments', 'id, n', (q) => q.like('external_reference', 'PH-%'))
    expect(rows).toHaveLength(2500)
    expect(rows.every((r) => r.n % 2 === 1)).toBe(true)
  })

  it('does not hand back the id it added to page by', async () => {
    const { client } = fakeSupabase(spread(2500))
    const rows = await readAllForAccount<Record<string, unknown>>(client, 'acc', 'appointments', 'external_reference')
    expect(rows).toHaveLength(2500)
    expect(rows.some((r) => 'id' in r)).toBe(false)
  })

  it('falls back to offset pages when ids are not uuids or no count comes back', async () => {
    const numbered = Array.from({ length: 2500 }, (_, i) => ({ id: hex(i, 6), account_id: 'acc', external_reference: null, n: i }))
    const a = fakeSupabase(numbered)
    expect((await readAllForAccount<Row>(a.client, 'acc', 'ai_usage', 'id, n')).map((r) => r.n)).toEqual(numbered.map((r) => r.n))
    expect(a.calls.every((c) => c.range)).toBe(true)
    const b = fakeSupabase(spread(2500), { count: false })
    expect(await readAllForAccount<Row>(b.client, 'acc', 'appointments', 'id, n')).toHaveLength(2500)
    expect(b.calls.every((c) => c.range)).toBe(true)
  })

  it('cuts the uuid space into equal slices', () => {
    expect(uuidSliceStarts(4)).toEqual(['00000000', '40000000', '80000000', 'c0000000'].map((h) => `${h}-0000-0000-0000-000000000000`))
  })
})

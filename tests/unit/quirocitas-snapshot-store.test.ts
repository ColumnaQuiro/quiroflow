import { describe, expect, it } from 'vitest'
import { loadLedgerPartial, loadQuirocitasMeta, saveLedgerPartial, saveQuirocitasMeta, type QuirocitasMeta } from '../../server/utils/quirocitasSnapshotStore'
import type { QuirocitasLedgerRow } from '../../utils/quirocitasPages'

// How the copy read from Quirocitas is laid out in import_snapshots, against
// a table kept in memory. What matters is the size of each write: a clinic's
// whole cash ledger in one row was one 12 MB request, and the API refused it.

interface Stored { account_id: string; source: string; key: string; data: unknown }

function fakeTable() {
  const rows: Stored[] = []
  /** Rows of the largest single write, to show nothing is sent whole. */
  let largestWrite = 0
  const from = () => {
    const q = { op: 'select', values: [] as Stored[], filters: [] as ((r: Stored) => boolean)[], single: false }
    const run = () => {
      const hit = rows.filter((r) => q.filters.every((f) => f(r)))
      if (q.op === 'upsert') {
        for (const v of q.values) {
          largestWrite = Math.max(largestWrite, Array.isArray(v.data) ? v.data.length : ((v.data as { ledger?: unknown[] })?.ledger?.length ?? 0))
          const i = rows.findIndex((r) => r.account_id === v.account_id && r.source === v.source && r.key === v.key)
          if (i >= 0) rows[i] = v; else rows.push(v)
        }
        return { data: null, error: null }
      }
      if (q.op === 'delete') {
        for (const r of hit) rows.splice(rows.indexOf(r), 1)
        return { data: null, error: null }
      }
      return { data: q.single ? hit[0] ?? null : hit, error: null }
    }
    const b: Record<string, unknown> = {
      select: () => b,
      upsert: (v: Stored[]) => { q.op = 'upsert'; q.values = v; return b },
      delete: () => { q.op = 'delete'; return b },
      eq: (col: keyof Stored, v: unknown) => { q.filters.push((r) => r[col] === v); return b },
      in: (col: keyof Stored, v: unknown[]) => { q.filters.push((r) => v.includes(r[col])); return b },
      like: (col: keyof Stored, v: string) => { q.filters.push((r) => String(r[col]).startsWith(v.replace(/%$/, ''))); return b },
      maybeSingle: () => { q.single = true; return b },
      then: (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, no),
    }
    return b
  }
  return { admin: { from } as never, rows, keys: () => rows.map((r) => r.key).sort(), largestWrite: () => largestWrite }
}

const ACCOUNT = 'acc'
const ledger = (n: number): QuirocitasLedgerRow[] => Array.from({ length: n }, (_, i) => ({
  month: '2026-10', date: '05-10-2026', name: `Paciente ${i}`, note: '', isNew: false, usedBono: false,
  cash: i, card: null, transfer: null, debt: null, value: i, citaId: String(i), bonoPaymentId: null,
}))
const meta = (rows: QuirocitasLedgerRow[]): QuirocitasMeta => ({ baseUrl: '', readAt: '2026-11-17T12:00:00Z', bonoTypes: [], failed: {}, ledger: rows, ledgerMonths: [] })

describe('the Quirocitas copy in import_snapshots', () => {
  it('keeps a long cash ledger in pieces, and gives it back whole and in order', async () => {
    const t = fakeTable()
    await saveQuirocitasMeta(t.admin, ACCOUNT, meta(ledger(9500)))
    expect(t.keys()).toEqual(['ledger:0', 'ledger:1', 'ledger:2', 'meta'])
    expect(t.largestWrite()).toBeLessThanOrEqual(4000)
    const back = await loadQuirocitasMeta(t.admin, ACCOUNT)
    expect(back!.ledger).toHaveLength(9500)
    expect(back!.ledger.map((r) => r.citaId)).toEqual(ledger(9500).map((r) => r.citaId))
    expect(back).not.toHaveProperty('ledgerChunks')
  })

  it('clears the pieces when a new read empties the ledger', async () => {
    const t = fakeTable()
    await saveQuirocitasMeta(t.admin, ACCOUNT, meta(ledger(9500)))
    await saveQuirocitasMeta(t.admin, ACCOUNT, meta([]))
    expect(t.keys()).toEqual(['meta'])
    expect((await loadQuirocitasMeta(t.admin, ACCOUNT))!.ledger).toEqual([])
  })

  it('still reads a copy saved with its ledger inline', async () => {
    const t = fakeTable()
    t.rows.push({ account_id: ACCOUNT, source: 'quirocitas', key: 'meta', data: meta(ledger(3)) })
    expect((await loadQuirocitasMeta(t.admin, ACCOUNT))!.ledger).toHaveLength(3)
  })

  it('refuses a ledger with a piece missing rather than pass off a shorter one', async () => {
    const t = fakeTable()
    await saveQuirocitasMeta(t.admin, ACCOUNT, meta(ledger(9500)))
    t.rows.splice(t.rows.findIndex((r) => r.key === 'ledger:1'), 1)
    await expect(loadQuirocitasMeta(t.admin, ACCOUNT)).rejects.toThrow('ledger:1 is missing')
  })

  it('keeps the ledger walked so far the same way, apart from the finished one', async () => {
    const t = fakeTable()
    await saveQuirocitasMeta(t.admin, ACCOUNT, meta([]))
    await saveLedgerPartial(t.admin, ACCOUNT, { ledger: ledger(4500), months: [], earliest: '2013-02' })
    expect(t.keys()).toEqual(['ledger_partial', 'meta', 'partial:0', 'partial:1'])
    const back = await loadLedgerPartial(t.admin, ACCOUNT)
    expect(back).toMatchObject({ earliest: '2013-02' })
    expect(back!.ledger).toHaveLength(4500)
    await saveLedgerPartial(t.admin, ACCOUNT, null)
    expect(t.keys()).toEqual(['meta'])
    expect(await loadLedgerPartial(t.admin, ACCOUNT)).toBeNull()
  })
})

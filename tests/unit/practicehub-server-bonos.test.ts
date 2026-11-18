import { describe, expect, it } from 'vitest'
import {
  balanceDisagreesWithPrice,
  owedCentsFor,
  paidNotConsumedCentsFor,
  planBonos,
  planPracticeHubBonos,
  syncFor,
  type LocalBono,
  type PHPatient,
  type PHPatientPackage,
  type PracticeHubBonosInput,
} from '../../utils/practicehubImport/bonos'
import type { PracticeHubSnapshot } from '../../utils/practicehubImport/types'

// The PracticeHub Bonos step: its rules as a pure function (the one copy the
// browser screen and the server job share), and the server planner against a
// database kept in memory. The people and clinics are invented.

const ACCOUNT = 'acc'
const OTHER = 'other-acc'
const t = (en: string) => en

function pkg(over: Partial<PHPatientPackage> & { id: number }): PHPatientPackage {
  return {
    patient_id: null,
    subscribed_patients: [{ patient_id: 1 }],
    name: 'Bono 10',
    package_type: null,
    active: 1,
    visits: 10,
    visits_left: 8,
    free_visits: 0,
    price: 400,
    balance: 320,
    owing: null,
    package_balance: 0,
    created: '2026-09-01T10:00:00Z',
    ...over,
  }
}

const phPatients: PHPatient[] = [
  { id: 1, patient_number: '1001', email: 'ana@demo.test', first_name: 'Ana', last_name: 'Demo' },
  { id: 2, patient_number: '1002', email: 'family@demo.test', first_name: 'Beto', last_name: 'Demo' },
  { id: 3, patient_number: '1003', email: 'family@demo.test', first_name: 'Carla', last_name: 'Demo' },
  { id: 4, patient_number: '1004', email: null, first_name: 'Dario', last_name: 'Nadie' },
]

const ourPatients: PracticeHubBonosInput['ourPatients'] = [
  { id: 'p1', external_reference: '1001', email: 'ana@demo.test', first_name: 'Ana', last_name: 'Demo' },
  { id: 'p2', external_reference: '1002', email: 'family@demo.test', first_name: 'Beto', last_name: 'Demo' },
  { id: 'p3', external_reference: '1003', email: 'family@demo.test', first_name: 'Carla', last_name: 'Demo' },
]

type Purchase = PracticeHubBonosInput['purchases'][number]
function purchase(over: Partial<Purchase> & { id: string }): Purchase {
  return {
    patient_id: 'p1',
    purchased_at: '2026-09-01T00:00:00+00:00',
    external_reference: null,
    invoice_id: null,
    package_name: 'Bono 10',
    price_cents: 40000,
    sessions_used: 2,
    sessions_total: 10,
    owed_cents: 0,
    is_closed: false,
    charged_at_purchase: false,
    ...over,
  }
}

function input(over: Partial<PracticeHubBonosInput> = {}): PracticeHubBonosInput {
  return { phPatients, phPackages: [], ourPatients, purchases: [], sessionPurchaseIds: [], shares: [], scheduledPurchaseIds: [], credits: [], ...over }
}

describe('the pure helpers', () => {
  it('reads what is owed and what was paid from PracticeHub', () => {
    expect(owedCentsFor(pkg({ id: 1, package_balance: -240 }))).toBe(24000)
    expect(owedCentsFor(pkg({ id: 1, package_balance: 0 }))).toBe(0)
    // balance + package_balance = paid - consumed, never below zero.
    expect(paidNotConsumedCentsFor(pkg({ id: 1, balance: 440, package_balance: -240 }))).toBe(20000)
    expect(paidNotConsumedCentsFor(pkg({ id: 1, balance: -40, package_balance: 0 }))).toBe(0)
  })

  it('flags a live bono whose stated balance falls short of its sessions, and nothing else', () => {
    // 10 left at 20 each is 200; PracticeHub states 160.
    expect(balanceDisagreesWithPrice(pkg({ id: 1, visits: 12, visits_left: 10, price: 240, balance: 160 }))).toEqual({ statedBalance: 160, impliedBalance: 200 })
    // One session OVER is PracticeHub counting before decrementing: not flagged.
    expect(balanceDisagreesWithPrice(pkg({ id: 1, visits: 10, visits_left: 5, price: 460, balance: 276 }))).toBeNull()
    // A few euros under is rounding.
    expect(balanceDisagreesWithPrice(pkg({ id: 1, visits: 10, visits_left: 5, price: 400, balance: 196 }))).toBeNull()
    // Closed: its price can no longer charge anything.
    expect(balanceDisagreesWithPrice(pkg({ id: 1, active: 0, visits: 12, visits_left: 10, price: 240, balance: 160 }))).toBeNull()
  })

  it('only ever raises sessions used', () => {
    const local: LocalBono = { id: 'b', patientId: 'p1', packageName: 'Bono 10', priceCents: 40000, sessionsUsed: 5, sessionsTotal: 10, purchasedAt: '', reference: null, visitRows: 0, hasInvoice: false, owedCents: 0, isClosed: false, chargedAtPurchase: false }
    expect(syncFor(local, 10, 7, 40000)).toEqual({ counterSync: { sessionsUsed: 7 }, usedAheadOfPracticeHub: false })
    expect(syncFor(local, 10, 3, 40000)).toEqual({ counterSync: null, usedAheadOfPracticeHub: true })
    expect(syncFor(local, 12, 5, 48000)).toEqual({ counterSync: { sessionsTotal: 12, priceCents: 48000 }, usedAheadOfPracticeHub: false })
  })
})

describe('planPracticeHubBonos', () => {
  it('adds a new bono and names each unmatched patient once, with every bono they were skipped on', () => {
    const plan = planPracticeHubBonos(input({
      phPackages: [
        pkg({ id: 10 }),
        pkg({ id: 11, subscribed_patients: [{ patient_id: 4 }], name: 'Bono 5' }),
        pkg({ id: 12, subscribed_patients: [{ patient_id: 4 }], name: 'Bono 12' }),
      ],
    }))
    expect(plan.candidates).toHaveLength(1)
    expect(plan.candidates[0]).toMatchObject({ phPackageId: 10, patientId: 'p1', repairOnly: false, sessionsTotal: 10, sessionsUsed: 2, priceCents: 40000, isActive: true })
    expect([...plan.unmatchedPatients.values()]).toEqual([{ number: '1004', name: 'Dario Nadie', bonos: ['Bono 5', 'Bono 12'] }])
  })

  it('falls back to email only when the address is one person on both sides', () => {
    const patients = [{ ...ourPatients[0]!, external_reference: 'DNI-123' }, ourPatients[1]!, ourPatients[2]!]
    const plan = planPracticeHubBonos(input({ ourPatients: patients, phPackages: [pkg({ id: 10 }), pkg({ id: 11, subscribed_patients: [{ patient_id: 2 }] })] }))
    // Ana matches by her unique email; Beto by his number.
    expect(plan.candidates.map((c) => c.patientId)).toEqual(['p1', 'p2'])
    // A shared family inbox never decides who a bono belongs to.
    const noNumbers = ourPatients.map((p) => ({ ...p, external_reference: null }))
    const shared = planPracticeHubBonos(input({ ourPatients: noNumbers, phPackages: [pkg({ id: 11, subscribed_patients: [{ patient_id: 2 }] })] }))
    expect(shared.candidates).toEqual([])
    expect(shared.unmatchedPatients.size).toBe(1)
  })

  it('leaves out a cancelled bono, PracticeHub duplicates and an active bono with nothing left', () => {
    const plan = planPracticeHubBonos(input({
      phPackages: [
        // Deactivated, untouched, nothing paid: void.
        pkg({ id: 20, active: 0, visits: 12, visits_left: 12, price: 528, balance: 528, package_balance: -528 }),
        // Same name, price and day: the untouched one is PracticeHub's copy.
        pkg({ id: 21, visits_left: 10, balance: 400, package_balance: -400, created: '2026-08-01T09:00:00Z' }),
        pkg({ id: 22, visits_left: 6, balance: 240, created: '2026-08-01T09:05:00Z' }),
        // Active, used up, paid, nobody sharing.
        pkg({ id: 23, name: 'Bono 5', visits: 5, visits_left: 0, balance: 0, package_balance: 0 }),
      ],
    }))
    expect(plan.voidBonos.map((v) => v.phPackageId)).toEqual([20])
    expect(plan.phDuplicateBonos).toEqual([expect.objectContaining({ phPackageId: 21, owedCents: 40000 })])
    expect(plan.skippedNoValue).toBe(1)
    expect(plan.candidates.map((c) => c.phPackageId)).toEqual([22])
  })

  it('finds nothing to do for a bono already here and in line', () => {
    const plan = planPracticeHubBonos(input({
      phPackages: [pkg({ id: 10 })],
      purchases: [purchase({ id: 'b1', external_reference: 'PH-package-10' })],
    }))
    expect(plan.candidates).toEqual([])
    expect(plan.unmatchedLocalBonos).toEqual([])
  })

  it('claims an unreferenced row by patient and day, and inserts the second bono of that day', () => {
    const plan = planPracticeHubBonos(input({
      phPackages: [pkg({ id: 10 }), pkg({ id: 11, name: 'Bono 5', visits: 5, visits_left: 5, price: 200, balance: 200, created: '2026-09-01T10:01:00Z' })],
      purchases: [purchase({ id: 'b1' })],
    }))
    expect(plan.candidates.map((c) => [c.phPackageId, c.existingPurchaseId, c.needsReferenceStamp, c.repairOnly])).toEqual([
      [10, 'b1', true, true],
      [11, null, false, false],
    ])
  })

  it('never lowers sessions used, and says when this side is ahead', () => {
    const plan = planPracticeHubBonos(input({
      phPackages: [pkg({ id: 10, visits_left: 8, package_balance: -100 })],
      purchases: [purchase({ id: 'b1', external_reference: 'PH-package-10', sessions_used: 4 })],
    }))
    expect(plan.candidates[0]).toMatchObject({ counterSync: null, usedAheadOfPracticeHub: true, owedCents: 10000 })
  })

  it('stamps closed and charged-at-purchase on a bono already here', () => {
    const plan = planPracticeHubBonos(input({
      // free_visits 9 of 10 with 1 left: PracticeHub invoiced it all at purchase.
      phPackages: [pkg({ id: 10, active: 0, visits_left: 1, free_visits: 9 })],
      purchases: [purchase({ id: 'b1', external_reference: 'PH-package-10', sessions_used: 9 })],
    }))
    expect(plan.candidates[0]).toMatchObject({ needsClosedStamp: true, needsChargeStamp: true, chargedAtPurchase: true, owedCents: 0 })
  })

  it('adds only the household members a shared bono is missing', () => {
    const plan = planPracticeHubBonos(input({
      phPackages: [pkg({ id: 10, subscribed_patients: [{ patient_id: 1 }, { patient_id: 2 }, { patient_id: 3 }] })],
      purchases: [purchase({ id: 'b1', external_reference: 'PH-package-10' })],
      shares: [{ package_purchase_id: 'b1', patient_id: 'p2' }],
    }))
    expect(plan.candidates[0]!.sharedWith).toEqual([{ id: 'p3', name: 'Carla Demo' }])
  })

  it('removes the empty copy of a bono recorded twice here, keeping the one with visits and moving its reference', () => {
    const rows = [
      purchase({ id: 'used', sessions_used: 2 }),
      purchase({ id: 'empty', external_reference: 'PH-package-10', sessions_used: 0 }),
    ]
    const plan = planPracticeHubBonos(input({ phPackages: [pkg({ id: 10 })], purchases: rows, sessionPurchaseIds: ['used', 'used'] }))
    expect(plan.duplicateMerges).toEqual([expect.objectContaining({ survivorId: 'used', discardId: 'empty', referenceToMove: 'PH-package-10', survivorVisits: 2 })])
    // A row carrying an instalment plan is never removed, however empty.
    const scheduled = planPracticeHubBonos(input({ phPackages: [pkg({ id: 10 })], purchases: rows, sessionPurchaseIds: ['used'], scheduledPurchaseIds: ['empty'] }))
    expect(scheduled.duplicateMerges).toEqual([])
  })

  it('lists a row here that no PracticeHub bono claims, and touches nothing', () => {
    const plan = planPracticeHubBonos(input({ purchases: [purchase({ id: 'sold-here', purchased_at: '2026-10-02T17:31:00+00:00' })] }))
    expect(plan.candidates).toEqual([])
    expect(plan.unmatchedLocalBonos.map((u) => [u.patientName, u.bono.id])).toEqual([['Ana Demo', 'sold-here']])
  })
})

// --- the server planner, against a database in memory --------------------------------

type Row = Record<string, unknown>
interface Call { table: string; op: string; filters: [string, string, unknown][]; values?: unknown }

function fakeSupabase(tables: Record<string, Row[]>, settleSteps: number[] = []) {
  const calls: Call[] = []
  const rpcs: { fn: string; args: unknown }[] = []
  let ids = 0
  const from = (table: string) => {
    const rows = () => (tables[table] ??= [])
    const q = { op: 'select', values: undefined as unknown, filters: [] as [string, string, unknown][], range: null as [number, number] | null, single: false }
    const match = (r: Row) => q.filters.every(([kind, col, v]) =>
      kind === 'eq' ? r[col] === v
        : kind === 'is' ? (r[col] ?? null) === v
          : kind === 'notnull' ? r[col] != null
            : String(r[col] ?? '').startsWith(String(v).replace(/%$/, '')))
    const run = () => {
      calls.push({ table, op: q.op, filters: q.filters, values: q.values })
      if (q.op === 'insert') {
        const added = ([] as Row[]).concat(q.values as Row | Row[]).map((v) => ({ id: `${table}-${++ids}`, ...v }))
        rows().push(...added)
        return { data: q.single ? added[0] : added, error: null }
      }
      if (q.op === 'update') {
        const hit = rows().filter(match)
        for (const r of hit) Object.assign(r, q.values)
        return { data: hit, error: null }
      }
      if (q.op === 'delete') {
        const keep = rows().filter((r) => !match(r))
        tables[table] = keep
        return { data: null, error: null }
      }
      const found = rows().filter(match)
      const page = q.range ? found.slice(q.range[0], q.range[1] + 1) : found
      return { data: q.single ? page[0] ?? null : page, error: null }
    }
    const filter = (kind: string) => (col: string, v: unknown) => { q.filters.push([kind, col, v]); return b }
    const b: Record<string, unknown> = {
      select: () => b,
      order: () => b,
      insert: (v: unknown) => { q.op = 'insert'; q.values = v; return b },
      update: (v: unknown) => { q.op = 'update'; q.values = v; return b },
      delete: () => { q.op = 'delete'; return b },
      eq: filter('eq'),
      is: filter('is'),
      not: (col: string) => filter('notnull')(col, null),
      like: filter('like'),
      range: (a: number, z: number) => { q.range = [a, z]; return b },
      single: () => { q.single = true; return b },
      then: (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, no),
    }
    return b
  }
  const rpc = async (fn: string, args: unknown) => {
    rpcs.push({ fn, args })
    calls.push({ table: `rpc:${fn}`, op: 'rpc', filters: [] })
    return { data: settleSteps.shift() ?? 0, error: null }
  }
  return { client: { from, rpc }, calls, rpcs }
}

function snapshotOf(packages: PHPatientPackage[]): PracticeHubSnapshot {
  return { readAt: '2026-11-18T08:00:00Z', baseUrl: 'https://demo.example', lists: { '/patients': phPatients, '/patient_packages': packages } }
}

function database(): Record<string, Row[]> {
  return {
    patients: [
      ...ourPatients.map((p) => ({ account_id: ACCOUNT, ...p })),
      // Another clinic's patient with the same PracticeHub number. Read
      // without the account filter, it would take Ana's bonos.
      { id: 'x1', account_id: OTHER, external_reference: '1001', email: 'ana@demo.test', first_name: 'Ana', last_name: 'Otra' },
    ],
    package_purchases: [
      { account_id: ACCOUNT, ...purchase({ id: 'b-old', external_reference: 'PH-package-30', sessions_used: 6 }) },
      // Another clinic's bono under the same reference.
      { account_id: OTHER, ...purchase({ id: 'x-b', patient_id: 'x1', external_reference: 'PH-package-10' }) },
    ],
    package_sessions: [],
    package_purchase_shares: [],
    payment_schedules: [],
    account_credits: [],
  }
}

const packages = () => [
  pkg({ id: 10, subscribed_patients: [{ patient_id: 1 }, { patient_id: 2 }] }),
  // Already here with 6 used; PracticeHub now says 4 used and is 12 at 480.
  pkg({ id: 30, visits: 12, visits_left: 8, price: 480, balance: 320 }),
]

describe('planBonos on the server', () => {
  const ctx = (client: unknown) => ({ supabase: client as never, accountId: ACCOUNT, clinicId: null, defaultPhoneCountry: 'ES', t, files: null })

  it('reads only this account, writes account_id on every row, never lowers a counter, and settles last', async () => {
    const tables = database()
    const { client, calls, rpcs } = fakeSupabase(tables)
    const plan = await planBonos(ctx(client), snapshotOf(packages()))

    for (const c of calls.filter((x) => x.op === 'select')) expect(c.filters).toContainEqual(['eq', 'account_id', ACCOUNT])
    expect(plan.total).toBe(2 + 1)
    expect(plan.stats.find((s) => s.label === 'New bonos')?.value).toBe('1')

    const result = await plan.apply(() => {}, () => false)
    expect(result).toEqual({ written: 2, errors: [] })

    const mine = tables.package_purchases!.filter((r) => r.account_id === ACCOUNT)
    expect(mine.find((r) => r.external_reference === 'PH-package-10')).toMatchObject({ patient_id: 'p1', sessions_used: 2, sessions_total: 10, charged_at_purchase: false, is_closed: false })
    // 6 used here stays 6; total and price follow PracticeHub.
    expect(mine.find((r) => r.id === 'b-old')).toMatchObject({ sessions_used: 6, sessions_total: 12, price_cents: 48000 })
    expect(tables.package_purchases!.find((r) => r.id === 'x-b')).toMatchObject({ account_id: OTHER, sessions_used: 2 })
    expect(tables.package_purchase_shares).toEqual([expect.objectContaining({ account_id: ACCOUNT, patient_id: 'p2' })])
    for (const c of calls.filter((x) => x.op === 'insert')) {
      for (const v of ([] as Row[]).concat(c.values as Row)) expect(v.account_id).toBe(ACCOUNT)
    }
    for (const c of calls.filter((x) => x.op === 'update' || x.op === 'delete')) expect(c.filters).toContainEqual(['eq', 'account_id', ACCOUNT])

    // Settling is the last thing it does, for this account.
    expect(calls[calls.length - 1]!.table).toBe('rpc:settle_imported_invoices')
    expect(rpcs).toEqual([{ fn: 'settle_imported_invoices', args: { p_account_id: ACCOUNT, p_limit: 2000 } }])
  })

  it('writes nothing the second time', async () => {
    const tables = database()
    const first = fakeSupabase(tables)
    await (await planBonos(ctx(first.client), snapshotOf(packages()))).apply(() => {}, () => false)
    const again = fakeSupabase(tables)
    const plan = await planBonos(ctx(again.client), snapshotOf(packages()))
    // The bono used ahead of PracticeHub is still only reported.
    expect(plan.total).toBe(1)
    expect(plan.rows).toEqual([])
    const result = await plan.apply(() => {}, () => false)
    expect(result).toEqual({ written: 0, errors: [] })
    expect(again.calls.filter((c) => c.op === 'insert' || c.op === 'update' || c.op === 'delete')).toEqual([])
  })

  it('settles on the next slice when a slice stops after writing the shares', async () => {
    const tables = database()
    const first = fakeSupabase(tables)
    const plan = await planBonos(ctx(first.client), snapshotOf(packages()))
    // Stop once both bonos are written: the settle comes after them.
    let units = 0
    const result = await plan.apply((n) => { units = n }, () => units >= 2)
    expect(result.written).toBe(2)
    expect(first.rpcs).toEqual([])
    expect(tables.package_purchase_shares).toHaveLength(1)

    // The next slice has no shares left to write, and settles all the same.
    const next = fakeSupabase(tables, [2000, 7])
    await (await planBonos(ctx(next.client), snapshotOf(packages()))).apply(() => {}, () => false)
    expect(next.rpcs).toHaveLength(2)
  })

  it('removes a duplicate here before it writes, and repoints the bono at the row kept', async () => {
    const tables = database()
    tables.package_purchases = [
      { account_id: ACCOUNT, ...purchase({ id: 'used', sessions_used: 2 }) },
      { account_id: ACCOUNT, ...purchase({ id: 'empty', external_reference: 'PH-package-10', sessions_used: 0, owed_cents: null }) },
    ]
    tables.package_sessions = [{ id: 's1', account_id: ACCOUNT, package_purchase_id: 'used' }, { id: 's2', account_id: OTHER, package_purchase_id: 'empty' }]
    const { client } = fakeSupabase(tables)
    const plan = await planBonos(ctx(client), snapshotOf([pkg({ id: 10, package_balance: -50 })]))
    const result = await plan.apply(() => {}, () => false)
    expect(result.errors).toEqual([])
    expect(tables.package_purchases).toEqual([expect.objectContaining({ id: 'used', external_reference: 'PH-package-10', owed_cents: 5000 })])
  })
})

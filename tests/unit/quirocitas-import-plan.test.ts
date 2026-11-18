import { describe, expect, it } from 'vitest'
import { quirocitasImporter } from '../../utils/quirocitasImport'
import type { QuirocitasSnapshot } from '../../utils/quirocitasRows'

// What the Appointments step does to appointments that are ALREADY here,
// against a database kept in memory: only the handful of PostgREST calls the
// importer makes, answered from plain arrays. The people are invented.

type Row = Record<string, unknown>

function fakeSupabase(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const rows = () => (tables[table] ??= [])
    const q = { op: 'select', values: undefined as unknown, filters: [] as [string, string, unknown][], range: null as [number, number] | null, single: false }
    const match = (r: Row) => q.filters.every(([kind, col, v]) =>
      kind === 'eq' ? r[col] === v
        : kind === 'is' ? (r[col] ?? null) === v
          : kind === 'in' ? (v as Set<unknown>).has(r[col])
            : String(r[col] ?? '').startsWith(String(v).replace(/%$/, '')))
    const run = () => {
      if (q.op === 'insert') {
        const added = ([] as Row[]).concat(q.values as Row | Row[]).map((v, i) => ({ id: `${table}-${rows().length + i + 1}`, ...v }))
        rows().push(...added)
        return { data: q.single ? added[0] : added, error: null }
      }
      if (q.op === 'update') {
        const hit = rows().filter(match)
        for (const r of hit) Object.assign(r, q.values)
        return { data: hit, error: null }
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
      eq: filter('eq'),
      is: filter('is'),
      in: (col: string, v: unknown[]) => filter('in')(col, new Set(v)),
      like: filter('like'),
      range: (a: number, z: number) => { q.range = [a, z]; return b },
      maybeSingle: () => { q.single = true; return b },
      single: () => { q.single = true; return b },
      then: (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, no),
    }
    return b
  }
  return { from }
}

const ACCOUNT = 'acc'
const t = (en: string) => en

// One patient with three appointments in Quirocitas, all with "Dra. Demo":
// one that took place and two still to come.
function snapshot(chiro = 'Dra. Demo'): QuirocitasSnapshot {
  const appointments = [
    { id: '5001', date: '05-10-2026', time: '15:45', type: 'Ajuste', chiro, status: 'pasado' },
    { id: '5003', date: '09-11-2026', time: '10:00', type: 'Ajuste', chiro, status: 'futuro' },
    { id: '5004', date: '16-11-2026', time: '10:00', type: 'Ajuste', chiro, status: 'futuro' },
  ]
  return {
    baseUrl: '', readAt: '', bonoTypes: [], failed: {}, ledger: [], ledgerMonths: [],
    patients: {
      101: {
        list: { id: '101', name: 'Laura Demo Prueba', phones: [] },
        ficha: {
          id: '101', name: 'Laura Demo Prueba', nif: '', birthDate: '', address: '', postcode: '', city: '', occupation: '', gender: '', language: '', email: '', phones: [],
          preferredPhone: null, chiro, notes: '', referralSource: '', consentRgpd: false, noMailings: false, messages: '', inactive: '', company: null, hasPhoto: false, plans: [], family: [],
          appointments, visits: [], bonos: [], invoiceLinks: [],
        },
        history: { generalNotes: '', visits: [], segments: [], tests: [], biomechanics: { segments: [], fields: {} }, anamnesis: {} },
        invoices: [],
        techniques: {},
      },
    },
  }
}

function clinic(team: Row[], appointments: Row[]): Record<string, Row[]> {
  return {
    clinics: [{ id: 'clinic', timezone: 'Europe/Madrid' }],
    team_members: team.map((m) => ({ account_id: ACCOUNT, deleted_at: null, is_practitioner: true, ...m })),
    patients: [{ id: 'p1', account_id: ACCOUNT, external_reference: 'QC-101' }],
    appointment_types: [{ id: 'ajuste', account_id: ACCOUNT, name: 'Ajuste', duration_minutes: 15 }],
    appointments: appointments.map((a) => ({ account_id: ACCOUNT, patient_id: 'p1', checked_in_at: null, rescheduled: false, practitioner_id: null, note: null, deleted_at: null, ...a })),
  }
}

async function runAppointments(tables: Record<string, Row[]>, s: QuirocitasSnapshot) {
  const importer = quirocitasImporter({ supabase: fakeSupabase(tables) as never, accountId: ACCOUNT, clinicId: 'clinic', t, fetchFile: async () => ({}), compressFile: async () => {} })
  const plan = await importer.plan('appointments', s)
  const result = await plan.apply(() => {}, () => false)
  return { plan, result }
}

describe('the Appointments step, run again', () => {
  // Imported before the chiropractor was matched: here, on nobody's tab.
  const here = () => [
    { id: 'a1', external_reference: 'QC-5001', status: 'completed', starts_at: '2026-10-05T13:45:00.000Z', ends_at: '2026-10-05T14:00:00.000Z' },
    { id: 'a3', external_reference: 'QC-5003', status: 'booked', starts_at: '2026-11-09T09:00:00.000Z', ends_at: '2026-11-09T09:15:00.000Z' },
  ]

  it('gives appointments already here their practitioner, once the name is matched', async () => {
    const tables = clinic([{ id: 'demo', full_name: 'Dra. Demo Prueba' }], here())
    const { plan, result } = await runAppointments(tables, snapshot())
    expect(plan.total).toBe(3)
    expect(result).toEqual({ written: 3, errors: [] })
    expect(tables.appointments!.map((a) => [a.external_reference, a.practitioner_id])).toEqual([['QC-5001', 'demo'], ['QC-5003', 'demo'], ['QC-5004', 'demo']])
    expect(plan.warnings).toEqual([])
  })

  it('leaves a practitioner chosen in QuiroFlow alone', async () => {
    const mine = here()
    Object.assign(mine[0]!, { practitioner_id: 'someone-else' })
    const tables = clinic([{ id: 'demo', full_name: 'Dra. Demo Prueba' }], mine)
    await runAppointments(tables, snapshot())
    expect(tables.appointments!.find((a) => a.id === 'a1')!.practitioner_id).toBe('someone-else')
  })

  it('gives a clinic whose Quirocitas names nobody its only practitioner', async () => {
    const tables = clinic([{ id: 'emma', full_name: 'Emma Demo' }, { id: 'desk', full_name: 'Recepción', is_practitioner: false }], here())
    await runAppointments(tables, snapshot(''))
    expect(tables.appointments!.map((a) => a.practitioner_id)).toEqual(['emma', 'emma', 'emma'])
  })

  it('says so when it cannot tell who an appointment is with', async () => {
    // Named, and not on the team.
    const unknown = clinic([{ id: 'emma', full_name: 'Emma Demo' }], here())
    const named = await runAppointments(unknown, snapshot())
    expect(unknown.appointments!.map((a) => a.practitioner_id)).toEqual([null, null, null])
    expect(named.plan.warnings.join(' ')).toContain('2 upcoming appointments are with Dra. Demo')
    // Not named, and more than one it could be.
    const two = clinic([{ id: 'emma', full_name: 'Emma Demo' }, { id: 'otto', full_name: 'Otto Demo' }], here())
    const blank = await runAppointments(two, snapshot(''))
    expect(two.appointments!.map((a) => a.practitioner_id)).toEqual([null, null, null])
    expect(blank.plan.warnings.join(' ')).toContain('does not say which chiropractor')
  })

  it('moves an appointment whole when Quirocitas moved it', async () => {
    // Booked for 08:00 here, now 10:00 (09:00 UTC) there. Only the start
    // used to be written, so it was left ending before it began.
    const moved = here()
    Object.assign(moved[1]!, { starts_at: '2026-11-09T07:00:00.000Z', ends_at: '2026-11-09T07:30:00.000Z' })
    const tables = clinic([{ id: 'demo', full_name: 'Dra. Demo Prueba' }], moved)
    await runAppointments(tables, snapshot())
    expect(tables.appointments!.find((a) => a.id === 'a3')).toMatchObject({ starts_at: '2026-11-09T09:00:00.000Z', ends_at: '2026-11-09T09:30:00.000Z', practitioner_id: 'demo' })
  })

  it('repairs one an earlier run left ending before it begins', async () => {
    const broken = here()
    Object.assign(broken[1]!, { ends_at: '2026-11-09T07:15:00.000Z' })
    const tables = clinic([{ id: 'demo', full_name: 'Dra. Demo Prueba' }], broken)
    await runAppointments(tables, snapshot())
    expect(tables.appointments!.find((a) => a.id === 'a3')).toMatchObject({ starts_at: '2026-11-09T09:00:00.000Z', ends_at: '2026-11-09T09:15:00.000Z' })
  })
})

// A copy from a pass that read everyone, in which Quirocitas has stopped
// listing cita 5003: cancelled there after it was imported, so it is gone from
// the search list and the record's visit list has an entry for it instead,
// with no id.
function afterCancelling(entry: 'cancelacion' | 'cambio' | null = 'cancelacion', reason = 'Viaje'): QuirocitasSnapshot {
  const s = snapshot()
  const r = s.patients[101]!
  r.ficha.appointments = r.ficha.appointments.filter((a) => a.id !== '5003')
  if (entry) r.ficha.visits = [{ date: '09-11-2026', time: '10:00', type: 'Cancelación', chiro: 'Dra. Demo', paid: 0, bono: false, reason, status: entry }]
  r.readAt = '2026-11-17T08:05:00.000Z'
  return { ...s, passStartedAt: '2026-11-17T08:00:00.000Z', version: 2, listTotal: 1, ledgerMonths: [{ month: '2026-11', rows: 0, printed: { cash: null, card: null, transfer: null }, summed: { cash: 0, card: 0, transfer: 0 } }] }
}

describe('an appointment cancelled in Quirocitas after it was imported', () => {
  const team = [{ id: 'demo', full_name: 'Dra. Demo Prueba' }]
  const here = (booked: Row = {}) => [
    { id: 'a1', external_reference: 'QC-5001', status: 'completed', starts_at: '2026-10-05T13:45:00.000Z', ends_at: '2026-10-05T14:00:00.000Z', practitioner_id: 'demo' },
    { id: 'a3', external_reference: 'QC-5003', status: 'booked', starts_at: '2026-11-09T09:00:00.000Z', ends_at: '2026-11-09T09:15:00.000Z', practitioner_id: 'demo', ...booked },
    { id: 'a4', external_reference: 'QC-5004', status: 'booked', starts_at: '2026-11-16T09:00:00.000Z', ends_at: '2026-11-16T09:15:00.000Z', practitioner_id: 'demo' },
  ]
  const at0900 = (tables: Record<string, Row[]>) => tables.appointments!.filter((a) => a.starts_at === '2026-11-09T09:00:00.000Z')
  const statuses = (tables: Record<string, Row[]>) => Object.fromEntries(tables.appointments!.map((a) => [a.external_reference, a.status]))

  it('is cancelled here, as the one row for that time', async () => {
    const tables = clinic(team, here())
    const { plan, result } = await runAppointments(tables, afterCancelling())
    expect(result).toEqual({ written: 1, errors: [] })
    expect(statuses(tables)).toEqual({ 'QC-5001': 'completed', 'QC-5003': 'cancelled', 'QC-5004': 'booked' })
    // The reason Quirocitas gives comes with it, since its own row does not.
    expect(at0900(tables)).toEqual([expect.objectContaining({ id: 'a3', status: 'cancelled', rescheduled: false, note: 'Viaje' })])
    expect(plan.total).toBe(1)
    expect(plan.stats.find((x) => x.label === 'Cancelled in Quirocitas')?.value).toBe('1')
    expect(plan.warnings.join(' ')).toContain('1 appointments still booked here are no longer in Quirocitas')
    expect(plan.rows[0]).toMatchObject({ status: 'Booked → Cancelled', note: 'Viaje' })
  })

  it('stays one row when the step runs again', async () => {
    const tables = clinic(team, here())
    await runAppointments(tables, afterCancelling())
    const again = await runAppointments(tables, afterCancelling())
    expect(again.plan.total).toBe(0)
    expect(again.plan.warnings).toEqual([])
    expect(at0900(tables)).toHaveLength(1)
  })

  it('is marked as moved when Quirocitas moved it, and keeps a note written here', async () => {
    const tables = clinic(team, here({ note: 'Trae la resonancia' }))
    await runAppointments(tables, afterCancelling('cambio'))
    expect(at0900(tables)).toEqual([expect.objectContaining({ id: 'a3', status: 'cancelled', rescheduled: true, note: 'Trae la resonancia' })])
  })

  it('is cancelled when Quirocitas lists nothing in its place either', async () => {
    const tables = clinic(team, here())
    await runAppointments(tables, afterCancelling(null))
    expect(at0900(tables)).toEqual([expect.objectContaining({ id: 'a3', status: 'cancelled' })])
  })

  it('does not gain a third row where an earlier run already wrote the cancelled one', async () => {
    const tables = clinic(team, [...here(), { id: 'a9', external_reference: 'QC-101-202611091000-1', status: 'cancelled', starts_at: '2026-11-09T09:00:00.000Z', ends_at: '2026-11-09T09:15:00.000Z' }])
    await runAppointments(tables, afterCancelling())
    expect(at0900(tables).map((a) => [a.id, a.status])).toEqual([['a3', 'cancelled'], ['a9', 'cancelled']])
  })

  it('is not written a second time when the desk already cancelled it here', async () => {
    const tables = clinic(team, here({ status: 'cancelled' }))
    const { plan } = await runAppointments(tables, afterCancelling())
    expect(plan.total).toBe(0)
    expect(at0900(tables)).toHaveLength(1)
  })

  it('still writes a cancellation nothing here stands for', async () => {
    // Two cancellations at that time in Quirocitas, one appointment here.
    const s = afterCancelling()
    s.patients[101]!.ficha.visits.push({ ...s.patients[101]!.ficha.visits[0]!, reason: 'Otra' })
    const tables = clinic(team, here())
    await runAppointments(tables, s)
    await runAppointments(tables, s)
    expect(at0900(tables).map((a) => [a.external_reference, a.status])).toEqual([['QC-5003', 'cancelled'], ['QC-101-202611091000-1', 'cancelled']])
  })

  it('is left alone once QuiroFlow has moved it or checked the patient in', async () => {
    for (const acted of [{ rescheduled: true, starts_at: '2026-11-10T09:00:00.000Z', ends_at: '2026-11-10T09:15:00.000Z' }, { checked_in_at: '2026-11-09T08:58:00.000Z' }]) {
      const tables = clinic(team, here(acted))
      const { plan } = await runAppointments(tables, afterCancelling(null))
      expect(statuses(tables)['QC-5003']).toBe('booked')
      expect(plan.stats.find((x) => x.label === 'Kept as QuiroFlow has them')?.value).toBe('1')
      expect(plan.stats.some((x) => x.label === 'Cancelled in Quirocitas')).toBe(false)
    }
  })

  it('is left alone when someone acts on it between the preview and the write', async () => {
    const tables = clinic(team, here())
    const importer = quirocitasImporter({ supabase: fakeSupabase(tables) as never, accountId: ACCOUNT, clinicId: 'clinic', t, fetchFile: async () => ({}), compressFile: async () => {} })
    const plan = await importer.plan('appointments', afterCancelling(null))
    Object.assign(tables.appointments!.find((a) => a.id === 'a3')!, { checked_in_at: '2026-11-09T08:58:00.000Z' })
    expect(await plan.apply(() => {}, () => false)).toEqual({ written: 0, errors: [] })
    expect(statuses(tables)['QC-5003']).toBe('booked')
  })

  it('is left alone unless its patient was read in a pass that read everyone', async () => {
    const untouched = async (s: QuirocitasSnapshot, tables = clinic(team, here())) => {
      const { plan } = await runAppointments(tables, s)
      expect(statuses(tables)['QC-5003']).toBe('booked')
      expect(plan.stats.some((x) => x.label === 'Cancelled in Quirocitas')).toBe(false)
    }
    // The read stopped part way: no ledger yet.
    await untouched({ ...afterCancelling(null), ledgerMonths: [] })
    // Their record could not be read this time; the copy holds an earlier one.
    await untouched({ ...afterCancelling(null), failed: { 101: 'timeout' } })
    const stale = afterCancelling(null)
    stale.patients[101]!.readAt = '2026-11-16T08:05:00.000Z'
    await untouched(stale)
    // A copy from before passes were recorded.
    await untouched({ ...afterCancelling(null), passStartedAt: undefined })
    // Someone else's appointment, whose record is not in the copy at all.
    const other = clinic(team, here({ patient_id: 'p2' }))
    other.patients!.push({ id: 'p2', account_id: ACCOUNT, external_reference: 'QC-102' })
    await untouched(afterCancelling(null), other)
  })

  it('is cancelled from a pass that read everyone and could not read the ledger', async () => {
    const tables = clinic(team, here())
    await runAppointments(tables, { ...afterCancelling(null), ledgerMonths: [], ledgerError: 'Quirocitas did not show a month of the cash ledger.' })
    expect(statuses(tables)['QC-5003']).toBe('cancelled')
  })

  it('is left alone when its cita is now on another record', async () => {
    const s = afterCancelling(null)
    s.patients[102] = { ...s.patients[101]!, list: { id: '102', name: 'Marc Demo Prueba', phones: [] }, ficha: { ...s.patients[101]!.ficha, id: '102', appointments: [{ id: '5003', date: '09-11-2026', time: '10:00', type: 'Ajuste', chiro: 'Dra. Demo', status: 'futuro' }] } }
    const tables = clinic(team, here())
    await runAppointments(tables, s)
    expect(statuses(tables)['QC-5003']).toBe('booked')
  })

  it('cancels nothing from a record that came back with no appointment list', async () => {
    const s = afterCancelling(null)
    s.patients[101]!.ficha.appointments = []
    const tables = clinic(team, here())
    const { plan } = await runAppointments(tables, s)
    expect(statuses(tables)).toEqual({ 'QC-5001': 'completed', 'QC-5003': 'booked', 'QC-5004': 'booked' })
    expect(plan.warnings.join(' ')).toContain('showed no appointment list for 1 patients')
  })
})

describe('a clinic imported before its chiropractor was matched', () => {
  it('assigns tens of thousands of appointments without the plan slowing to a stop', async () => {
    // Every one of a large clinic's appointments was already here with no
    // practitioner. Grouping them copied the list once per appointment, which
    // took longer than a slice has: the step planned, ran out of time before
    // its first write, and was given up as having made no progress.
    const N = 30_000
    const s = snapshot()
    const at = (i: number) => new Date(Date.UTC(2020, 0, 1, 8, 0) + i * 30 * 60000)
    const two = (n: number) => String(n).padStart(2, '0')
    s.patients[101]!.ficha.appointments = Array.from({ length: N }, (_, i) => {
      const d = at(i)
      return { id: String(10_000 + i), date: `${two(d.getUTCDate())}-${two(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`, time: `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`, type: 'Ajuste', chiro: 'Dra. Demo', status: 'pasado' }
    })
    const tables = clinic([{ id: 'demo', full_name: 'Dra. Demo Prueba' }], [])
    // Stored as the importer itself would have stored them, so nothing else differs.
    const first = await runAppointments(tables, s)
    expect(first.result.written).toBe(N)
    for (const a of tables.appointments!) a.practitioner_id = null

    const started = Date.now()
    const { plan, result } = await runAppointments(tables, s)
    expect(plan.total).toBe(N)
    expect(result).toEqual({ written: N, errors: [] })
    expect(tables.appointments!.every((a) => a.practitioner_id === 'demo')).toBe(true)
    // Seconds at the very most, on a busy machine; the copying took minutes.
    expect(Date.now() - started).toBeLessThan(8000)
  }, 30_000)
})

describe('the Payments step', () => {
  // A visit paid in cash on a page whose rows carry no visit id.
  const paidVisit = { month: '2026-10', date: '05-10-2026', name: 'Laura Demo Prueba', note: '', isNew: false, usedBono: false, cash: 40, card: null, transfer: null, debt: null, value: 40, citaId: null, bonoPaymentId: null }
  const withLedger = (summedCash: number): QuirocitasSnapshot => ({
    ...snapshot(),
    ledger: [paidVisit],
    ledgerMonths: [{ month: '2026-10', rows: 1, printed: { cash: 40, card: 0, transfer: null }, summed: { cash: summedCash, card: 0, transfer: 0 } }],
  })
  const tables = (): Record<string, Row[]> => ({
    ...clinic([], [{ id: 'a1', external_reference: 'QC-5001', starts_at: '2026-10-05T13:45:00Z', ends_at: '2026-10-05T14:00:00Z', status: 'completed' }]),
    payment_methods: ['cash', 'card', 'transfer'].map((key) => ({ account_id: ACCOUNT, key })),
  })
  const runLedger = async (tbl: Record<string, Row[]>, s: QuirocitasSnapshot) => {
    const importer = quirocitasImporter({ supabase: fakeSupabase(tbl) as never, accountId: ACCOUNT, clinicId: 'clinic', t, fetchFile: async () => ({}), compressFile: async () => {} })
    const plan = await importer.plan('ledger', s)
    return { plan, result: await plan.apply(() => {}, () => false) }
  }

  it('writes nothing from a cash ledger whose months do not add up to what Quirocitas printed', async () => {
    // Read with its columns in the wrong place, one clinic's ledger was
    // planned in full and only warned about.
    const tbl = tables()
    const { plan, result } = await runLedger(tbl, withLedger(0))
    expect(plan.warnings.join(' ')).toContain('Nothing will be written')
    expect(result.written).toBe(0)
    expect(result.errors[0]).toContain('do not add up')
    expect(tbl.payments ?? []).toEqual([])
    expect(tbl.invoices ?? []).toEqual([])
  })

  it('writes the visit and its payment once the month adds up, finding the visit by its day', async () => {
    const tbl = tables()
    const { result } = await runLedger(tbl, withLedger(40))
    expect(result.errors).toEqual([])
    expect(tbl.invoices).toEqual([expect.objectContaining({ appointment_id: 'a1', total_cents: 4000, status: 'paid', external_reference: 'QC-inv-5001' })])
    expect(tbl.payments).toEqual([expect.objectContaining({ amount_cents: 4000, method: 'cash', external_reference: 'QC-pay-5001-cash', invoice_id: 'invoices-1' })])
  })
})

describe('the Bonos step, run again', () => {
  // One bono on two records: bought by one, used by both.
  const bono = { id: '900', name: 'Bono 12', remaining: 4, expires: '01-10-2027', owed: 0, paid: 450, status: 'presente' }
  const withHolders = (): QuirocitasSnapshot => {
    const s = snapshot()
    s.patients[101]!.ficha.bonos = [bono]
    s.patients[102] = {
      ...structuredClone(s.patients[101]!),
      list: { id: '102', name: 'Hugo Demo Prueba', phones: [] },
      ficha: { ...structuredClone(s.patients[101]!.ficha), id: '102', name: 'Hugo Demo Prueba', appointments: [], bonos: [bono] },
    }
    return s
  }
  const tables = (): Record<string, Row[]> => ({
    ...clinic([], []),
    patients: [
      { id: 'p1', account_id: ACCOUNT, external_reference: 'QC-101' },
      { id: 'p2', account_id: ACCOUNT, external_reference: 'QC-102' },
    ],
    // Created on a pass that had read only the first record, so nobody was linked.
    package_purchases: [{ id: 'bono-1', account_id: ACCOUNT, patient_id: 'p1', external_reference: 'QC-bono-900', sessions_used: 8, is_closed: false, owed_cents: 0 }],
    package_purchase_shares: [],
  })
  const runBonos = async (tbl: Record<string, Row[]>) => {
    const importer = quirocitasImporter({ supabase: fakeSupabase(tbl) as never, accountId: ACCOUNT, clinicId: 'clinic', t, fetchFile: async () => ({}), compressFile: async () => {} })
    const plan = await importer.plan('bonos', withHolders())
    return plan.apply(() => {}, () => false)
  }

  it('links a holder read on a later pass to the bono already here', async () => {
    const tbl = tables()
    const result = await runBonos(tbl)
    expect(result.errors).toEqual([])
    expect(tbl.package_purchase_shares).toEqual([expect.objectContaining({ package_purchase_id: 'bono-1', patient_id: 'p2' })])
    expect(tbl.package_purchases).toHaveLength(1)
  })

  it('links them once, however many times it runs', async () => {
    const tbl = tables()
    await runBonos(tbl)
    await runBonos(tbl)
    expect(tbl.package_purchase_shares).toHaveLength(1)
  })
})

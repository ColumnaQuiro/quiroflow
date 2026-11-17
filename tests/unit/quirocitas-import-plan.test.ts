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
          : kind === 'in' ? (v as unknown[]).includes(r[col])
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
      in: filter('in'),
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
    appointments: appointments.map((a) => ({ account_id: ACCOUNT, checked_in_at: null, rescheduled: false, practitioner_id: null, ...a })),
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

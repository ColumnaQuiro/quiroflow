import { describe, expect, it } from 'vitest'
import {
  appointmentFieldUpdate,
  byExactName,
  planAppointments,
  planPracticeHubAppointmentRows,
  practiceHubAppointmentStatus,
  practiceHubTypeMatches,
  type AppointmentHereRow,
} from '../../utils/practicehubImport/appointments'
import { hexColor, isWorthBringing, planAppointmentTypes, practiceHubTypeCandidates } from '../../utils/practicehubImport/appointmentTypes'
import type { PracticeHubImportContext, PracticeHubSnapshot } from '../../utils/practicehubImport/types'

// The PracticeHub Appointments and Appointment types steps as the server runs
// them: the pure rules first, then each planner against a database kept in
// memory (only the PostgREST calls the planners make, answered from plain
// arrays). The people and clinics are invented.

type Row = Record<string, unknown>

function fakeSupabase(tables: Record<string, Row[]>) {
  let seq = 0
  const from = (table: string) => {
    const rows = () => (tables[table] ??= [])
    const q = { op: 'select', values: undefined as unknown, filters: [] as [string, string, unknown][], range: null as [number, number] | null, single: false, count: false }
    const match = (r: Row) => q.filters.every(([kind, col, v]) =>
      kind === 'eq' ? r[col] === v
        : kind === 'is' ? (r[col] ?? null) === v
          : kind === 'notnull' ? (r[col] ?? null) !== null
            : kind === 'in' ? (v as Set<unknown>).has(r[col])
              : true)
    const run = () => {
      if (q.op === 'insert') {
        const added = ([] as Row[]).concat(q.values as Row | Row[]).map((v) => ({ id: `${table}-${++seq}`, ...v }))
        rows().push(...added)
        return { data: q.single ? added[0] : added, error: null }
      }
      if (q.op === 'update') {
        const hit = rows().filter(match)
        for (const r of hit) Object.assign(r, q.values)
        return { data: hit, error: null, count: q.count ? hit.length : null }
      }
      const found = rows().filter(match)
      const page = q.range ? found.slice(q.range[0], q.range[1] + 1) : found
      return { data: q.single ? page[0] ?? null : page, error: null, count: null }
    }
    const filter = (kind: string) => (col: string, v: unknown) => { q.filters.push([kind, col, v]); return b }
    const b: Record<string, unknown> = {
      select: () => b,
      order: () => b,
      insert: (v: unknown) => { q.op = 'insert'; q.values = v; return b },
      update: (v: unknown, opts?: { count?: string }) => { q.op = 'update'; q.values = v; q.count = !!opts?.count; return b },
      eq: filter('eq'),
      is: filter('is'),
      not: (col: string) => { q.filters.push(['notnull', col, null]); return b },
      in: (col: string, v: unknown[]) => filter('in')(col, new Set(v)),
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
const CLINIC = 'clinic-1'
const TZ = 'Europe/Madrid'
const t = (en: string) => en
// Madrid wall-clock times, as PracticeHub gives them. September is UTC+2.
const madrid = (local: string) => new Date(`${local.replace(' ', 'T')}:00+02:00`).toISOString()

function ctxFor(tables: Record<string, Row[]>, clinicId: string | null = CLINIC): PracticeHubImportContext {
  return { supabase: fakeSupabase(tables) as never, accountId: ACCOUNT, clinicId, defaultPhoneCountry: 'ES', t, files: null }
}

const noop = () => {}
const never = () => false

// --- the rules shared with the browser importer ---------------------------------------

describe('PracticeHub appointment rules', () => {
  it("maps PracticeHub's statuses to QuiroFlow's", () => {
    expect(practiceHubAppointmentStatus('Processed')).to.equal('completed')
    expect(practiceHubAppointmentStatus(' cancelled ')).to.equal('cancelled')
    expect(practiceHubAppointmentStatus('missed')).to.equal('no_show')
    expect(practiceHubAppointmentStatus('pending')).to.equal('booked')
    expect(practiceHubAppointmentStatus('arrived')).to.equal('booked')
  })

  it('compares times as instants and never clears a value PracticeHub leaves blank', () => {
    const here = { starts_at: '2026-09-09T08:00:00+00:00', ends_at: '2026-09-09T08:15:00+00:00', status: 'booked', practitioner_id: 'tm-1', practitioner_name: 'Ana Demo', appointment_type_id: 'type-1' }
    const { updates, diff } = appointmentFieldUpdate(here, {
      starts_at: '2026-09-09T08:00:00.000Z',
      ends_at: '2026-09-09T08:30:00.000Z',
      status: 'booked',
      practitioner_id: null,
      practitioner_name: 'Ana Demo',
      appointment_type_id: null,
    }, (_f, v) => String(v))
    expect(updates).to.deep.equal({ ends_at: '2026-09-09T08:30:00.000Z' })
    expect(diff.map((d) => d.field)).to.deep.equal(['ends_at'])
  })

  it('pre-selects the same name, ignoring case and spaces, and the first of two', () => {
    const named = byExactName([{ id: 'a', name: ' Ajuste ' }, { id: 'b', name: 'ajuste' }], (x) => x.name)
    expect(named('AJUSTE')?.id).to.equal('a')
    expect(named('Informe')).to.equal(undefined)
    expect(named('')).to.equal(undefined)
  })
})

// --- planning rows ------------------------------------------------------------------------

const here = (id: string, over: Partial<AppointmentHereRow> = {}): AppointmentHereRow => ({
  id,
  external_reference: null,
  patient_id: 'pat-1',
  clinic_id: CLINIC,
  starts_at: madrid('2026-09-09 10:00'),
  ends_at: madrid('2026-09-09 10:15'),
  status: 'booked',
  rescheduled: false,
  checked_in_at: null,
  practitioner_id: null,
  practitioner_name: null,
  appointment_type_id: null,
  room_id: null,
  ...over,
})
const phRow = (id: string, start: string, end: string, over: Record<string, string> = {}) => ({
  'Internal Appt ID': id,
  'Patient Number': '77',
  'Start': start,
  'End': end,
  'Practitioner': 'Ana Demo',
  'Appointment Type': 'Ajuste',
  'Status': 'Pending',
  'Note': '',
  ...over,
})
const plan = (rows: Record<string, string>[], existing: AppointmentHereRow[]) => planPracticeHubAppointmentRows({
  rows,
  patientByRef: new Map([['77', 'pat-1']]),
  existing,
  accountId: ACCOUNT,
  clinicId: CLINIC,
  timeZone: TZ,
  practitionerIdFor: (n) => (n === 'Ana Demo' ? 'tm-1' : null),
  typeIdFor: () => null,
})

describe('Planning PracticeHub appointments against the ones here', () => {
  it("inserts a new one at the clinic's wall clock, linked by name, with no type when none matches", () => {
    const p = plan([phRow('9500', '2026-09-09 10:00:00', '2026-09-09 10:15:00')], [])
    expect(p.inserts).to.have.length(1)
    expect(p.inserts[0]!.appointment).to.include({
      account_id: ACCOUNT,
      clinic_id: CLINIC,
      patient_id: 'pat-1',
      practitioner_id: 'tm-1',
      practitioner_name: 'Ana Demo',
      appointment_type_id: null,
      starts_at: '2026-09-09T08:00:00.000Z',
      status: 'booked',
      external_reference: '9500',
    })
  })

  it('keeps a practitioner not on the team as a name only', () => {
    const p = plan([phRow('9500', '2026-09-09 10:00:00', '2026-09-09 10:15:00', { Practitioner: 'Otro Demo' })], [])
    expect(p.inserts[0]!.appointment).to.include({ practitioner_id: null, practitioner_name: 'Otro Demo' })
  })

  it('skips a visit whose patient is not here, and one with no readable date', () => {
    const p = plan([
      phRow('9500', '2026-09-09 10:00:00', '2026-09-09 10:15:00', { 'Patient Number': '99' }),
      phRow('9501', 'not a date', '2026-09-09 10:15:00'),
    ], [])
    expect(p.skippedNoPatient).to.equal(1)
    expect(p.skippedInvalidDate).to.equal(1)
    expect(p.inserts).to.have.length(0)
  })

  it('leaves alone a visit that has not changed', () => {
    const p = plan([phRow('9500', '2026-09-09 10:00:00', '2026-09-09 10:15:00')], [here('a', { external_reference: '9500', practitioner_id: 'tm-1', practitioner_name: 'Ana Demo' })])
    expect(p.updates).to.have.length(0)
    expect(p.skippedUnchanged).to.equal(1)
  })

  it('moves a visit QuiroFlow has not touched', () => {
    const p = plan([phRow('9500', '2026-09-09 11:00:00', '2026-09-09 11:15:00')], [here('a', { external_reference: '9500', practitioner_id: 'tm-1', practitioner_name: 'Ana Demo' })])
    expect(p.updates).to.have.length(1)
    expect(p.updates[0]!.updates).to.deep.equal({ starts_at: madrid('2026-09-09 11:00'), ends_at: madrid('2026-09-09 11:15') })
  })

  it("keeps QuiroFlow's version of a visit completed here", () => {
    const p = plan([phRow('9500', '2026-09-02 10:00:00', '2026-09-02 10:15:00')], [here('a', { external_reference: '9500', status: 'completed' })])
    expect(p.updates).to.have.length(0)
    expect(p.kept).to.have.length(1)
    expect(p.kept[0]!.reason).to.equal('outcome_here')
  })

  it("keeps everything about a visit moved in QuiroFlow, even its practitioner", () => {
    const p = plan([phRow('9500', '2026-09-09 10:00:00', '2026-09-09 10:15:00')], [here('a', { external_reference: '9500', rescheduled: true })])
    expect(p.updates).to.have.length(0)
    expect(p.kept[0]!.reason).to.equal('moved_here')
  })

  it('lets a re-created PracticeHub appointment adopt the visit here that day', () => {
    const p = plan([phRow('9876', '2026-09-09 10:30:00', '2026-09-09 10:45:00', { Status: 'Processed' })], [here('a', { status: 'completed' })])
    expect(p.inserts).to.have.length(0)
    expect(p.updates).to.have.length(1)
    expect(p.updates[0]!.adopted).to.equal(true)
    // Completed here, and PracticeHub would move it: QuiroFlow's version
    // stands whole, but the visit still takes the new id.
    expect(p.updates[0]!.updates).to.deep.equal({ external_reference: '9876' })
    expect(p.kept[0]!.reason).to.equal('outcome_here')
  })

  it('holds back a row when several visits that day could be it', () => {
    const p = plan([phRow('9876', '2026-09-09 13:00:00', '2026-09-09 13:15:00')], [
      here('a', { starts_at: madrid('2026-09-09 10:00'), ends_at: madrid('2026-09-09 10:15') }),
      here('b', { starts_at: madrid('2026-09-09 17:00'), ends_at: madrid('2026-09-09 17:15') }),
    ])
    expect(p.inserts).to.have.length(0)
    expect(p.updates).to.have.length(0)
    expect(p.held.map((h) => h.reason)).to.deep.equal(['several'])
  })
})

// --- the Appointments planner, end to end ------------------------------------------------

function snapshot(appointments: Row[], over: Partial<PracticeHubSnapshot['lists']> = {}): PracticeHubSnapshot {
  return {
    readAt: '',
    baseUrl: '',
    lists: {
      '/practitioners': [{ id: 1, first_name: 'Ana', last_name: 'Demo' }],
      '/appointment_types': [{ id: 10, name: 'Ajuste' }, { id: 11, name: 'Informe Quiropractico', active: 1 }, { id: 12, name: 'Vieja', active: 0 }],
      '/patients': [{ id: 500, patient_number: 77 }],
      '/appointments': appointments,
      ...over,
    },
  }
}

function clinicTables(): Record<string, Row[]> {
  return {
    clinics: [{ id: CLINIC, account_id: ACCOUNT, timezone: TZ }],
    team_members: [{ id: 'tm-1', account_id: ACCOUNT, full_name: 'Ana Demo', deleted_at: null }],
    appointment_types: [],
    patients: [{ id: 'pat-1', account_id: ACCOUNT, external_reference: '77' }],
    appointments: [],
    visit_notes: [],
  }
}

describe('planAppointments', () => {
  it('imports, notes and, run again, finds nothing left to write', async () => {
    const tables = clinicTables()
    // Another clinic's visit with the same PracticeHub id is not this one.
    tables.appointments!.push({ id: 'other', account_id: 'other-acc', external_reference: '9500', patient_id: 'pat-x', clinic_id: 'c-x', starts_at: madrid('2026-09-09 10:00'), ends_at: madrid('2026-09-09 10:15'), status: 'booked', rescheduled: false, checked_in_at: null })
    const snap = snapshot([
      { id: 9500, patient_id: 500, practitioner_id: 1, appointment_type_id: 10, start: '2026-09-09 10:00:00', end: '2026-09-09 10:15:00', status: 'pending', note: '<p>Dolor lumbar</p>' },
      { id: 9501, patient_id: 999, practitioner_id: 1, appointment_type_id: 10, start: '2026-09-10 10:00:00', end: '2026-09-10 10:15:00', status: 'pending' },
    ])
    const first = await planAppointments(ctxFor(tables), snap)
    expect(first.total).to.equal(1)
    expect(first.warnings.some((w) => w.includes('not imported yet'))).to.equal(true)
    expect(first.warnings.some((w) => w.includes('Ajuste'))).to.equal(true)
    // A preview never writes.
    expect(tables.appointments).to.have.length(1)

    const res = await first.apply(noop, never)
    expect(res).to.deep.equal({ written: 1, errors: [] })
    const mine = tables.appointments!.filter((a) => a.account_id === ACCOUNT)
    expect(mine).to.have.length(1)
    expect(mine[0]).to.include({ clinic_id: CLINIC, patient_id: 'pat-1', practitioner_id: 'tm-1', external_reference: '9500', starts_at: '2026-09-09T08:00:00.000Z' })
    expect(tables.visit_notes).to.deep.equal([{ id: tables.visit_notes![0]!.id, account_id: ACCOUNT, appointment_id: mine[0]!.id, body: 'Dolor lumbar' }])

    const second = await planAppointments(ctxFor(tables), snap)
    expect(second.total).to.equal(0)
  })

  it('adds a visit note on an update only when the visit has none', async () => {
    const tables = clinicTables()
    tables.appointments!.push(
      { id: 'a', account_id: ACCOUNT, external_reference: '9500', patient_id: 'pat-1', clinic_id: CLINIC, starts_at: madrid('2026-09-09 09:00'), ends_at: madrid('2026-09-09 09:15'), status: 'booked', rescheduled: false, checked_in_at: null, practitioner_id: 'tm-1', practitioner_name: 'Ana Demo', appointment_type_id: null },
      { id: 'b', account_id: ACCOUNT, external_reference: '9501', patient_id: 'pat-1', clinic_id: CLINIC, starts_at: madrid('2026-09-10 09:00'), ends_at: madrid('2026-09-10 09:15'), status: 'booked', rescheduled: false, checked_in_at: null, practitioner_id: 'tm-1', practitioner_name: 'Ana Demo', appointment_type_id: null },
    )
    tables.visit_notes!.push({ id: 'n1', account_id: ACCOUNT, appointment_id: 'b', body: 'Escrita aquí' })
    const snap = snapshot([
      { id: 9500, patient_id: 500, practitioner_id: 1, start: '2026-09-09 10:00:00', end: '2026-09-09 10:15:00', status: 'pending', note: 'Desde PracticeHub' },
      { id: 9501, patient_id: 500, practitioner_id: 1, start: '2026-09-10 10:00:00', end: '2026-09-10 10:15:00', status: 'pending', note: 'Desde PracticeHub' },
    ])
    const p = await planAppointments(ctxFor(tables), snap)
    const res = await p.apply(noop, never)
    expect(res.written).to.equal(2)
    expect(tables.visit_notes!.filter((n) => n.appointment_id === 'a').map((n) => n.body)).to.deep.equal(['Desde PracticeHub'])
    expect(tables.visit_notes!.filter((n) => n.appointment_id === 'b').map((n) => n.body)).to.deep.equal(['Escrita aquí'])
  })

  it("brings each visit's room from PracticeHub, only into a room this clinic has, and fills a blank only", async () => {
    const tables = clinicTables()
    tables.calendar_resources = [
      { id: 'room-1', account_id: ACCOUNT, clinic_id: CLINIC, name: '1' },
      { id: 'room-2', account_id: ACCOUNT, clinic_id: CLINIC, name: 'Camilla 2' },
      // Another clinic's room of the same name is never this one.
      { id: 'room-x', account_id: ACCOUNT, clinic_id: 'clinic-2', name: '3' },
    ]
    tables.appointments!.push(
      // Already imported with no room: takes PracticeHub's.
      { id: 'a', account_id: ACCOUNT, external_reference: '9600', patient_id: 'pat-1', clinic_id: CLINIC, starts_at: madrid('2026-09-01 10:00'), ends_at: madrid('2026-09-01 10:15'), status: 'completed', rescheduled: false, checked_in_at: null, practitioner_id: 'tm-1', practitioner_name: 'Ana Demo', appointment_type_id: null, room_id: null },
      // A room chosen here stands.
      { id: 'b', account_id: ACCOUNT, external_reference: '9601', patient_id: 'pat-1', clinic_id: CLINIC, starts_at: madrid('2026-09-02 10:00'), ends_at: madrid('2026-09-02 10:15'), status: 'booked', rescheduled: false, checked_in_at: null, practitioner_id: 'tm-1', practitioner_name: 'Ana Demo', appointment_type_id: null, room_id: 'room-2' },
      // Moved here: nothing is taken from PracticeHub, its room neither.
      { id: 'c', account_id: ACCOUNT, external_reference: '9602', patient_id: 'pat-1', clinic_id: CLINIC, starts_at: madrid('2026-09-03 12:00'), ends_at: madrid('2026-09-03 12:15'), status: 'booked', rescheduled: true, checked_in_at: null, practitioner_id: 'tm-1', practitioner_name: 'Ana Demo', appointment_type_id: null, room_id: null },
    )
    const at = (id: number, day: string, resource: number, location = 1) => ({ id, patient_id: 500, practitioner_id: 1, start: `2026-09-${day} 10:00:00`, end: `2026-09-${day} 10:15:00`, status: id === 9600 ? 'processed' : 'pending', location_id: location, resource_id: resource })
    const snap = snapshot([
      at(9600, '01', 1),
      at(9601, '02', 1),
      at(9602, '03', 1),
      at(9603, '04', 2), // "Sala 2" -> "Camilla 2": one "2" on each side
      at(9604, '05', 3), // "3" is only another clinic's
      at(9605, '06', 9, 2), // another PracticeHub location's "1"
    ], {
      '/v3/resources': [
        { id: 1, location_id: 1, name: ' 1 ' },
        { id: 2, location_id: 1, name: 'Sala 2' },
        { id: 3, location_id: 1, name: '3' },
        { id: 9, location_id: 2, name: '1' },
      ],
    })
    const p = await planAppointments(ctxFor(tables), snap)
    expect(p.stats.find((s) => s.label === 'Room set')?.value).to.equal('2')
    expect(p.warnings).to.include('Rooms: PracticeHub "1" → 1, "Sala 2" → Camilla 2.')
    expect(p.warnings.some((w) => w.includes('"3" (1)'))).to.equal(true)
    expect(p.warnings.some((w) => w.startsWith('1 visits are at another PracticeHub location'))).to.equal(true)
    expect(p.rows.find((r) => r.ref === '9600')?.detail).to.equal('Room: (blank) → 1')

    await p.apply(noop, never)
    const room = (ref: string) => tables.appointments!.find((a) => a.account_id === ACCOUNT && a.external_reference === ref)?.room_id ?? null
    expect(['9600', '9601', '9602', '9603', '9604', '9605'].map(room)).to.deep.equal(['room-1', 'room-2', null, 'room-2', null, null])

    // Run again, nothing is left to write.
    expect((await planAppointments(ctxFor(tables), snap)).total).to.equal(0)
  })

  it('says why visits have no room when the copy has no rooms, and nothing when neither side has any', async () => {
    const snap = snapshot([{ id: 9500, patient_id: 500, start: '2026-09-09 10:00:00', end: '2026-09-09 10:15:00', status: 'pending', location_id: 1, resource_id: 1 }])
    const plain = await planAppointments(ctxFor(clinicTables()), snap)
    expect(plain.warnings.some((w) => w.includes('room'))).to.equal(false)

    const withRooms = clinicTables()
    withRooms.calendar_resources = [{ id: 'room-1', account_id: ACCOUNT, clinic_id: CLINIC, name: '1' }]
    const noCopy = await planAppointments(ctxFor(withRooms), snap)
    expect(noCopy.warnings.some((w) => w.includes('the copy read from PracticeHub has no rooms'))).to.equal(true)
    await noCopy.apply(noop, never)
    expect(withRooms.appointments![0]!.room_id ?? null).to.equal(null)

    const oneRoomThere = await planAppointments(ctxFor(clinicTables()), snapshot(snap.lists['/appointments'] as Row[], { '/v3/resources': [{ id: 1, location_id: 1, name: '1' }] }))
    expect(oneRoomThere.warnings.some((w) => w.includes('room'))).to.equal(false)
  })

  it('writes nothing without a clinic, and stops between chunks when told to', async () => {
    const snap = snapshot([{ id: 9500, patient_id: 500, start: '2026-09-09 10:00:00', end: '2026-09-09 10:15:00', status: 'pending' }])
    const tables = clinicTables()
    const noClinic = await planAppointments(ctxFor(tables, null), snap)
    expect((await noClinic.apply(noop, never)).written).to.equal(0)
    expect(tables.appointments).to.have.length(0)

    const stopped = await planAppointments(ctxFor(tables), snap)
    expect((await stopped.apply(noop, () => true)).written).to.equal(0)
    expect(tables.appointments).to.have.length(0)
  })
})

// --- appointment types ---------------------------------------------------------------------

describe('PracticeHub appointment types', () => {
  it('leaves behind a retired type nobody used, and reads colours', () => {
    expect(isWorthBringing({ active: 0 }, 0)).to.equal(false)
    expect(isWorthBringing({ active: 0 }, 3)).to.equal(true)
    expect(isWorthBringing({ active: 1 }, 0)).to.equal(true)
    expect(hexColor('#A1B2C3')).to.equal('#a1b2c3')
    expect(hexColor('red')).to.equal(null)
  })

  it('creates what is missing, relinks only what differs, and prices only over a 0', () => {
    const { candidates, skippedNoMatch } = practiceHubTypeCandidates({
      phTypes: [{ id: 10, name: 'Ajuste' }, { id: 11, name: 'Informe Quiropractico', duration: 30, color: '00ff00' }, { id: 12, name: 'Vieja', active: 0 }, { id: 13, name: 'Retirada', active: 0 }],
      phAppointments: [
        { id: 1, appointment_type_id: 10 }, { id: 2, appointment_type_id: '10' }, { id: 3, appointment_type_id: 11 },
        { id: 4, appointment_type_id: 12 }, { id: 5, appointment_type_id: null }, { id: 6, appointment_type_id: 99 },
      ],
      typesHere: [{ id: 'type-a', name: 'ajuste', default_price_cents: 0 }],
      visitsHere: [
        { id: 'v1', external_reference: '1', appointment_type_id: 'type-a' },
        { id: 'v2', external_reference: '2', appointment_type_id: null },
        { id: 'v3', external_reference: '3', appointment_type_id: null },
      ],
      services: [{ id: 1, description: 'Ajuste', amount: '45.00' }],
    })
    expect(skippedNoMatch).to.equal(2)
    expect(candidates.map((c) => c.name)).to.deep.equal(['Ajuste', 'Informe Quiropractico', 'Vieja'])
    const [ajuste, informe, vieja] = candidates
    expect(ajuste).to.include({ ourTypeId: 'type-a', priceToWrite: 4500, inPracticeHub: 2 })
    expect(ajuste!.relinkIds).to.deep.equal(['v2'])
    expect(informe).to.include({ ourTypeId: null, funnelStage: 'report', durationMinutes: 30, color: '#00ff00', archived: false })
    expect(informe!.relinkIds).to.deep.equal(['v3'])
    expect(vieja).to.include({ ourTypeId: null, archived: true })
  })
})

describe('planAppointmentTypes', () => {
  it('creates the types the Appointments step left untyped, links the visits, and then has nothing to do', async () => {
    const tables = clinicTables()
    tables.appointment_types!.push({ id: 'type-a', account_id: ACCOUNT, name: 'Ajuste', default_price_cents: 0 })
    tables.appointments!.push(
      { id: 'v1', account_id: ACCOUNT, external_reference: '9500', appointment_type_id: null },
      { id: 'v2', account_id: ACCOUNT, external_reference: '9501', appointment_type_id: null },
      // Another clinic's visit with the same PracticeHub id is never touched.
      { id: 'vx', account_id: 'other-acc', external_reference: '9501', appointment_type_id: null },
    )
    const snap = snapshot(
      [{ id: 9500, appointment_type_id: 10 }, { id: 9501, appointment_type_id: 11 }],
      { '/billable_items': [{ id: 1, description: 'Ajuste ', amount: '45.00' }, { id: 2, description: 'Informe quiropráctico', amount: '60.00' }] },
    )
    const first = await planAppointmentTypes(ctxFor(tables), snap)
    // One new type, one price, two visits.
    expect(first.total).to.equal(4)
    expect(tables.appointment_types).to.have.length(1)

    const res = await first.apply(noop, never)
    expect(res.errors).to.deep.equal([])
    const informe = tables.appointment_types!.find((ty) => ty.name === 'Informe Quiropractico')!
    expect(informe).to.include({ account_id: ACCOUNT, stage: 'report', online_booking_enabled: false, default_price_cents: 6000 })
    expect(tables.appointment_types!.find((ty) => ty.id === 'type-a')!.default_price_cents).to.equal(4500)
    expect(tables.appointments!.find((a) => a.id === 'v1')!.appointment_type_id).to.equal('type-a')
    expect(tables.appointments!.find((a) => a.id === 'v2')!.appointment_type_id).to.equal(informe.id)
    expect(tables.appointments!.find((a) => a.id === 'vx')!.appointment_type_id).to.equal(null)

    const second = await planAppointmentTypes(ctxFor(tables), snap)
    expect(second.total).to.equal(0)
  })

  // The shape QuiroBalance's PracticeHub returned on 20 Nov 2026: its types
  // and services do not share names, and the one service that does share a
  // name ("Ajuste ") is retired at an old price. The sync before this wrote
  // that 30 € to the type, and left the rest at 0 without a word.
  it('never prices a type from a retired service, and names the types it cannot price', async () => {
    const tables = clinicTables()
    tables.appointment_types!.push(
      { id: 'type-ajuste', account_id: ACCOUNT, name: 'Ajuste', default_price_cents: 0 },
      { id: 'type-primera', account_id: ACCOUNT, name: 'Primera visita', default_price_cents: 0 },
      // Priced by the clinic here: kept, and not reported as missing.
      { id: 'type-informe', account_id: ACCOUNT, name: 'Informe', default_price_cents: 5000 },
    )
    const snap = snapshot([], {
      '/appointment_types': [{ id: 1, name: 'Ajuste', active: 1 }, { id: 2, name: 'Primera visita', active: 1 }, { id: 3, name: 'Informe', active: 1 }, { id: 4, name: 'Reevaluación', active: 1 }],
      '/billable_items': [
        { id: 1, description: 'Chequeo quiropráctico y ajuste 2025', amount: '50.00', active: null },
        { id: 2, description: 'Primera visita', amount: '70.00', active: null },
        { id: 11, description: 'Ajuste ', amount: '30.00', active: false },
        { id: 17, description: 'Chequeo quiropráctico', amount: '0.00', active: true },
      ],
    })
    const plan = await planAppointmentTypes(ctxFor(tables), snap)
    const unpriced = plan.warnings.find((w) => w.startsWith('No price in PracticeHub for:'))
    expect(unpriced).to.contain('Ajuste, Reevaluación.')
    expect(unpriced).not.to.contain('Informe')
    expect(unpriced).not.to.contain('Primera visita')

    const res = await plan.apply(noop, never)
    expect(res.errors).to.deep.equal([])
    const price = (id: string) => tables.appointment_types!.find((ty) => ty.id === id)!.default_price_cents
    expect(price('type-ajuste')).to.equal(0)
    expect(price('type-primera')).to.equal(7000)
    expect(price('type-informe')).to.equal(5000)
    expect(tables.appointment_types!.find((ty) => ty.name === 'Reevaluación')).to.not.have.property('default_price_cents')
  })

  it('says when the copy has no prices to bring', async () => {
    const p = await planAppointmentTypes(ctxFor(clinicTables()), snapshot([{ id: 9500, appointment_type_id: 10 }]))
    expect(p.warnings.some((w) => w.includes('PracticeHub API'))).to.equal(true)
  })
})

// --- a type renamed or merged here --------------------------------------------------------

describe('Which type here a PracticeHub type is', () => {
  const typesHere = [
    { id: 'type-consulta', name: 'Consulta inicial' },
    { id: 'type-ajuste', name: 'Ajuste' },
    { id: 'type-a30', name: 'Ajuste 30' },
  ]

  it('is the type its visits already have here, whatever it is called now', () => {
    const matches = practiceHubTypeMatches({
      phTypes: [{ id: 2, name: 'Primera visita' }, { id: 1, name: 'Ajuste' }, { id: 7, name: 'Ajuste 30' }],
      phAppointments: [
        { id: 1, appointment_type_id: 2 }, { id: 2, appointment_type_id: '2' }, { id: 3, appointment_type_id: 2 },
        // Two of three visits of "Ajuste" were moved to "Ajuste 30" here: that
        // is where the type went, though "Ajuste" still exists by name.
        { id: 4, appointment_type_id: 1 }, { id: 5, appointment_type_id: 1 }, { id: 6, appointment_type_id: 1 },
      ],
      typesHere,
      visitsHere: [
        { external_reference: '1', appointment_type_id: 'type-consulta' },
        { external_reference: '2', appointment_type_id: 'type-consulta' },
        // One changed by hand does not outvote the rest.
        { external_reference: '3', appointment_type_id: 'type-ajuste' },
        { external_reference: '4', appointment_type_id: 'type-a30' },
        { external_reference: '5', appointment_type_id: 'type-a30' },
        { external_reference: '6', appointment_type_id: 'type-ajuste' },
      ],
    })
    expect(matches.get('2')?.id).to.equal('type-consulta')
    expect(matches.get('1')?.id).to.equal('type-a30')
    // No visits here yet: by name, as before.
    expect(matches.get('7')?.id).to.equal('type-a30')
  })

  it('falls back to the name when its visits are split evenly, untyped, or on a type that is gone', () => {
    const matches = practiceHubTypeMatches({
      phTypes: [{ id: 1, name: 'Ajuste' }, { id: 2, name: 'Primera visita' }, { id: 3, name: 'Informe' }],
      phAppointments: [{ id: 1, appointment_type_id: 1 }, { id: 2, appointment_type_id: 1 }, { id: 3, appointment_type_id: 2 }, { id: 4, appointment_type_id: 3 }],
      typesHere,
      visitsHere: [
        { external_reference: '1', appointment_type_id: 'type-consulta' },
        { external_reference: '2', appointment_type_id: 'type-a30' },
        { external_reference: '3', appointment_type_id: null },
        { external_reference: '4', appointment_type_id: 'type-deleted' },
      ],
    })
    expect(matches.get('1')?.id).to.equal('type-ajuste')
    expect(matches.get('2')).to.equal(undefined)
    expect(matches.get('3')).to.equal(undefined)
  })

  // QuiroBalance, 21 Nov 2026: "Primera visita" renamed "Consulta inicial"
  // here, while PracticeHub still calls it "Primera visita". By name, the next
  // sync cleared the type off every one of its visits, created a second
  // "Primera visita" and moved them all to it.
  it('survives a full sync: neither step clears, re-creates or moves anything', async () => {
    const tables = clinicTables()
    tables.appointment_types!.push({ id: 'type-consulta', account_id: ACCOUNT, name: 'Consulta inicial', default_price_cents: 7000 })
    tables.appointments!.push(
      { id: 'v1', account_id: ACCOUNT, external_reference: '9500', patient_id: 'pat-1', clinic_id: CLINIC, starts_at: madrid('2026-09-09 10:00'), ends_at: madrid('2026-09-09 11:00'), status: 'booked', rescheduled: false, checked_in_at: null, practitioner_id: 'tm-1', practitioner_name: 'Ana Demo', appointment_type_id: 'type-consulta' },
    )
    const snap = snapshot(
      [
        { id: 9500, patient_id: 500, practitioner_id: 1, appointment_type_id: 2, start: '2026-09-09 10:00:00', end: '2026-09-09 11:00:00', status: 'pending' },
        // A new one in PracticeHub comes in typed too.
        { id: 9501, patient_id: 500, practitioner_id: 1, appointment_type_id: 2, start: '2026-09-16 10:00:00', end: '2026-09-16 11:00:00', status: 'pending' },
      ],
      { '/appointment_types': [{ id: 2, name: 'Primera visita', active: 1 }] },
    )

    const appointments = await planAppointments(ctxFor(tables), snap)
    expect(appointments.warnings.some((w) => w.includes('Primera visita'))).to.equal(false)
    expect((await appointments.apply(noop, never)).errors).to.deep.equal([])
    expect(tables.appointments!.map((a) => a.appointment_type_id)).to.deep.equal(['type-consulta', 'type-consulta'])

    const types = await planAppointmentTypes(ctxFor(tables), snap)
    expect(types.total).to.equal(0)
    expect(types.rows[0]).to.include({ name: 'Primera visita', status: 'Already here as "Consulta inicial"' })
    await types.apply(noop, never)
    expect(tables.appointment_types!.map((ty) => ty.name)).to.deep.equal(['Consulta inicial'])
  })
})

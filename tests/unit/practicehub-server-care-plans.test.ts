import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  planCarePlans,
  practiceHubCarePlanIdOf,
  practiceHubCarePlanOutcomes,
  practiceHubInterval,
  practiceHubPlanCreatedAt,
  practiceHubSplitPhases,
  type PracticeHubPhase,
  type PracticeHubCarePlanRow,
} from '../../utils/practicehubImport/carePlans'
import type { PracticeHubImportContext, PracticeHubSnapshot } from '../../utils/practicehubImport/types'

// PracticeHub Classic care plans becoming care plans: the rules first, then
// the step against a database kept in memory that answers only the PostgREST
// calls it makes. The people are invented; the shapes are PracticeHub's, as
// one clinic's 1,970 plan rows sent them.

type Row = Record<string, unknown>

function fakeSupabase(tables: Record<string, Row[]>) {
  let seq = 0
  const from = (table: string) => {
    const rows = () => (tables[table] ??= [])
    const q = { op: 'select', values: undefined as unknown, filters: [] as [string, string, unknown][], range: null as [number, number] | null }
    const match = (r: Row) => q.filters.every(([kind, col, v]) =>
      kind === 'eq' ? r[col] === v
        : kind === 'is' ? (r[col] ?? null) === v
        : kind === 'in' ? (v as Set<unknown>).has(r[col])
          : kind === 'like' ? r[col] != null && String(r[col]).startsWith(String(v).replace(/%$/, ''))
            : true)
    const run = () => {
      if (q.op === 'insert') {
        const added = ([] as Row[]).concat(q.values as Row[]).map((v) => ({ id: `${table}-${++seq}`, ...v }))
        rows().push(...added)
        return { data: added, error: null }
      }
      if (q.op === 'delete') {
        tables[table] = rows().filter((r) => !match(r))
        return { data: null, error: null }
      }
      const found = rows().filter(match)
      return { data: q.range ? found.slice(q.range[0], q.range[1] + 1) : found, error: null }
    }
    const filter = (kind: string) => (col: string, v: unknown) => { q.filters.push([kind, col, v]); return b }
    const b: Record<string, unknown> = {
      select: () => b,
      order: () => b,
      insert: (v: unknown) => { q.op = 'insert'; q.values = v; return b },
      delete: () => { q.op = 'delete'; return b },
      eq: filter('eq'),
      like: filter('like'),
      not: () => b,
      is: filter('is'),
      in: (col: string, v: unknown[]) => filter('in')(col, new Set(v)),
      range: (a: number, z: number) => { q.range = [a, z]; return b },
      then: (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, no),
    }
    return b
  }
  return { from }
}

const ACCOUNT = 'acc'
const OTHER = 'other-acc'
const t = (en: string) => en
const noop = () => {}
const never = () => false
const ctxFor = (tables: Record<string, Row[]>): PracticeHubImportContext =>
  ({ supabase: fakeSupabase(tables) as never, accountId: ACCOUNT, clinicId: 'c1', defaultPhoneCountry: 'ES', t, files: null })

const reexam = (n: number, type = '4') => ({ period: 'one-off', appt_type: type, appt_number: String(n) })
const recurring = { period: 'recurring', appt_type: '1', appt_number: '1' }

function snapshot(): PracticeHubSnapshot {
  return {
    readAt: '2026-11-25T08:00:00Z',
    baseUrl: 'https://demo.practicehub.io',
    lists: {
      '/patients': [
        { id: 11, patient_number: '1001' },
        { id: 12, patient_number: '1002' },
        { id: 13, patient_number: '1003' },
      ],
      '/appointment_types': [
        { id: 1, name: 'Ajuste' },
        { id: 4, name: 'Reexamen' },
        { id: 17, name: 'Radiografías' },
      ],
      '/care_plans': [
        // Ana: one plan, two phases -- two rows under one id, in order, both
        // with the plan's start; re-exams at visits 6 and 15 of the plan.
        { id: 62, version: 1, patient_id: 11, start_date: '2026-09-01 00:00:00', active: 1, visits: 2, interval: '+1 week', duration: 3, frequency_type: 'fixed_term', visit_rules: [recurring, reexam(6, '17'), reexam(15)] },
        { id: 62, version: 1, patient_id: 11, start_date: '2026-09-01 00:00:00', active: 1, visits: 1, interval: '+1 week', duration: 9, frequency_type: 'fixed_term', visit_rules: [recurring, reexam(6, '17'), reexam(15)] },
        // Ana, earlier: a maintenance plan with no end.
        { id: 99, version: 1, patient_id: 11, start_date: '2025-01-01 00:00:00', active: 1, visits: 1, interval: '+2 weeks', duration: 0, frequency_type: 'ongoing', visit_rules: [] },
        // Ana: every three days -- no care plan here can say that.
        { id: 90, version: 1, patient_id: 11, start_date: '2026-10-01 00:00:00', active: 1, visits: 1, interval: '+3 days', duration: 4, frequency_type: 'fixed_term', visit_rules: [] },
        // Bruno: phase 1 under way (two visits of six), phase 2 still to come.
        { id: 70, version: 1, patient_id: 12, start_date: '2026-11-10 00:00:00', active: 1, visits: 2, interval: '+1 week', duration: 3, frequency_type: 'fixed_term', visit_rules: [recurring, reexam(15)] },
        { id: 70, version: 1, patient_id: '12', start_date: '2026-11-10 00:00:00', active: 1, visits: 1, interval: '+1 week', duration: 9, frequency_type: 'fixed_term', visit_rules: [recurring, reexam(15)] },
        // Bruno: switched off in PracticeHub.
        { id: 80, version: 1, patient_id: 12, start_date: '2026-01-10 00:00:00', active: 0, visits: 1, interval: '+1 week', duration: 6, frequency_type: 'fixed_term', visit_rules: [] },
        // Carla is not here yet.
        { id: 95, version: 1, patient_id: 13, start_date: '2026-10-01 00:00:00', active: 1, visits: 1, interval: '+1 week', duration: 6, frequency_type: 'fixed_term', visit_rules: [] },
      ],
    },
  }
}

function clinic(): Record<string, Row[]> {
  return {
    patients: [
      { id: 'p1', account_id: ACCOUNT, external_reference: '1001', first_name: 'Ana', last_name: 'Gil' },
      { id: 'p2', account_id: ACCOUNT, external_reference: '1002', first_name: 'Bruno', last_name: null },
      { id: 'x3', account_id: OTHER, external_reference: '1003', first_name: 'Carla', last_name: 'Ruiz' },
    ],
    appointment_types: [{ id: 'type-reexam', account_id: ACCOUNT, name: 'Reexamen', default_price_cents: 0 }],
    // Ana finished phase 1 (six visits) on 19 Sep, so phase 2 began on the
    // 20th. A cancelled visit and a deleted one do not count.
    appointments: [
      ...['2026-09-01', '2026-09-04', '2026-09-08', '2026-09-11', '2026-09-15', '2026-09-19', '2026-09-26'].map((d, i) => ({ id: `a${i}`, account_id: ACCOUNT, patient_id: 'p1', starts_at: `${d}T08:30:00+00:00`, status: 'completed', deleted_at: null })),
      { id: 'ac', account_id: ACCOUNT, patient_id: 'p1', starts_at: '2026-09-05T08:30:00+00:00', status: 'cancelled', deleted_at: null },
      { id: 'ad', account_id: ACCOUNT, patient_id: 'p1', starts_at: '2026-09-06T08:30:00+00:00', status: 'completed', deleted_at: '2026-09-07T00:00:00Z' },
      { id: 'b1', account_id: ACCOUNT, patient_id: 'p2', starts_at: '2026-11-10T16:00:00+00:00', status: 'completed', deleted_at: null },
      { id: 'b2', account_id: ACCOUNT, patient_id: 'p2', starts_at: '2026-11-13T16:00:00+00:00', status: 'completed', deleted_at: null },
    ],
    care_plans: [
      // Another clinic's import of the same PracticeHub ids: not "already here".
      { id: 'xp', account_id: OTHER, patient_id: 'x3', external_reference: 'PH-careplan-70-1' },
    ],
    contact_log: [
      // Ana's plan 62 imported earlier as notes, one per version, as the old step did.
      { id: 'n62a', account_id: ACCOUNT, patient_id: 'p1', external_reference: 'PH-careplan-62' },
      { id: 'n62b', account_id: ACCOUNT, patient_id: 'p1', external_reference: 'PH-careplan-62' },
      // A PracticeHub log entry: never touched by this step.
      { id: 'log', account_id: ACCOUNT, patient_id: 'p1', external_reference: 'PH-log-501' },
    ],
  }
}

const plansOf = (tables: Record<string, Row[]>, patient: string) =>
  tables.care_plans!.filter((r) => r.account_id === ACCOUNT && r.patient_id === patient).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-25T09:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('the rules', () => {
  it('reads PracticeHub periods as weeks or months', () => {
    expect(practiceHubInterval('+1 week')).toEqual({ value: 1, unit: 'week' })
    expect(practiceHubInterval('+3 weeks')).toEqual({ value: 3, unit: 'week' })
    expect(practiceHubInterval('+1 month')).toEqual({ value: 1, unit: 'month' })
    expect(practiceHubInterval('+14 days')).toEqual({ value: 2, unit: 'week' })
    expect(practiceHubInterval('+3 days')).toBeNull()
    expect(practiceHubInterval('1 year')).toBeNull()
    expect(practiceHubInterval(null)).toBeNull()
  })

  it('knows its own references, not the notes the old step wrote', () => {
    expect(practiceHubCarePlanIdOf('PH-careplan-62-2')).toBe('62')
    expect(practiceHubCarePlanIdOf('PH-careplan-62')).toBeNull()
    expect(practiceHubCarePlanIdOf(null)).toBeNull()
  })

  const outcomes = (rows: unknown[]) =>
    practiceHubCarePlanOutcomes(rows as PracticeHubCarePlanRow[], { typeFor: (id) => (id === '4' ? { id: 'type-reexam', label: 'Reexamen' } : { label: `Tipo ${id}` }) })

  it('turns a plan\'s rows into its phases, in order, and a re-exam counted across the plan into a marker on its phase', () => {
    const [o] = outcomes((snapshot().lists['/care_plans'] as Row[]).filter((r) => r.id === 62))
    if (o!.kind !== 'plan') throw new Error('expected a plan')
    expect(o.phases.map((r) => [r.ref, r.startedAt, r.visitsPerPeriod, r.frequencyValue, r.frequencyUnit, r.totalVisits, r.markers])).toEqual([
      ['PH-careplan-62-1', '2026-09-01', 2, 1, 'week', 6, [{ at: 6, label: 'Tipo 17' }]],
      ['PH-careplan-62-2', '2026-09-01', 1, 1, 'week', 9, [{ at: 9, appointment_type_id: 'type-reexam', label: 'Reexamen' }]],
    ])
  })

  const phase = (n: number, totalVisits: number | null): PracticeHubPhase =>
    ({ ref: `PH-careplan-5-${n}`, startedAt: '2026-09-01', visitsPerPeriod: 1, frequencyValue: 1, frequencyUnit: 'week', totalVisits, markers: [] })

  it('starts each phase the day after the visit that finished the one before, as the trigger does', () => {
    const visits = ['2026-09-03T18:00:00.000Z', '2026-09-01T09:00:00.000Z', '2026-09-08T09:00:00.000Z', '2026-09-20T09:00:00.000Z', '2026-08-30T09:00:00.000Z']
    const { rows, queued } = practiceHubSplitPhases([phase(1, 2), phase(2, 2), phase(3, 4)], visits)
    // 30 Aug is before the plan; 1 and 3 Sep finish phase 1; 8 and 20 Sep phase 2.
    expect(rows.map((r) => [r.ref, r.startedAt])).toEqual([['PH-careplan-5-1', '2026-09-01'], ['PH-careplan-5-2', '2026-09-04'], ['PH-careplan-5-3', '2026-09-21']])
    expect(queued).toEqual([])
  })

  it('queues the phases the patient has not reached on the one they are in', () => {
    const { rows, queued } = practiceHubSplitPhases([phase(1, 6), phase(2, 9)], ['2026-09-01T09:00:00.000Z'])
    expect(rows.map((r) => r.ref)).toEqual(['PH-careplan-5-1'])
    expect(queued.map((r) => [r.ref, r.totalVisits])).toEqual([['PH-careplan-5-2', 9]])
    // Not started at all: the first phase is the plan, from its date.
    expect(practiceHubSplitPhases([phase(1, 6), phase(2, 9)], []).rows.map((r) => r.startedAt)).toEqual(['2026-09-01'])
  })

  it('leaves as a note a plan switched off, or one it cannot express', () => {
    expect(outcomes([{ id: 1, version: 1, patient_id: 1, start_date: '2026-01-01', active: 0, visits: 1, interval: '+1 week', duration: 4, frequency_type: 'fixed_term' }])[0]).toMatchObject({ kind: 'note', reason: 'inactive' })
    // A phase with no end before another: the next would never start.
    expect(outcomes([
      { id: 2, version: 1, patient_id: 1, start_date: '2026-01-01', active: 1, visits: 1, interval: '+1 week', duration: 0, frequency_type: 'ongoing' },
      { id: 2, version: 2, patient_id: 1, start_date: '2026-03-01', active: 1, visits: 1, interval: '+1 week', duration: 4, frequency_type: 'fixed_term' },
    ])[0]).toMatchObject({ kind: 'note', reason: 'unsupported' })
    // More than 7 visits a period.
    expect(outcomes([{ id: 3, version: 1, patient_id: 1, start_date: '2026-01-01', active: 1, visits: 8, interval: '+1 week', duration: 4, frequency_type: 'fixed_term' }])[0]).toMatchObject({ kind: 'note', reason: 'unsupported' })
    // More phases than a plan can queue.
    expect(outcomes(Array.from({ length: 8 }, () => ({ id: 4, version: 1, patient_id: 1, start_date: '2026-01-01', active: 1, visits: 1, interval: '+1 week', duration: 2, frequency_type: 'fixed_term' })))[0]).toMatchObject({ kind: 'note', reason: 'unsupported' })
  })

  it('dates each patient\'s phases in order, never after now', () => {
    const at = practiceHubPlanCreatedAt([
      { patientId: 'p', rows: [{ ref: 'PH-careplan-1-2', startedAt: '2026-09-01' }, { ref: 'PH-careplan-1-1', startedAt: '2026-09-01' }] },
      { patientId: 'p', rows: [{ ref: 'PH-careplan-2-1', startedAt: '2027-01-01' }] },
    ], new Date('2026-11-25T09:00:00Z'))
    expect([...at]).toEqual([
      ['PH-careplan-1-1', '2026-09-01T00:00:00.000Z'],
      ['PH-careplan-1-2', '2026-09-01T00:00:00.001Z'],
      ['PH-careplan-2-1', '2026-11-25T09:00:00.000Z'],
    ])
  })
})

describe('the Care plans step on the server', () => {
  it('writes care plans with their phases, moves the old notes, and keeps the rest as notes', async () => {
    const tables = clinic()
    const plan = await planCarePlans(ctxFor(tables), snapshot())
    expect(plan.stats.map((s) => [s.label, s.value])).toEqual([
      ['As care plans', '2'],
      ['Moved from the history to care plans', '1'],
      ['Phases in them', '5'],
      ['As a note (switched off or unsupported)', '2'],
      ['Already imported', '0'],
      ['No matching patient', '1'],
    ])
    expect(await plan.apply(noop, never)).toEqual({ written: 5, errors: [] })

    // Ana: the maintenance plan, then plan 62's two phases -- the last is current.
    expect(plansOf(tables, 'p1').map((r) => [r.external_reference, r.started_at, r.visits_per_period, r.frequency_value, r.frequency_unit, r.total_visits, r.next_phases, r.name])).toEqual([
      ['PH-careplan-99-1', '2025-01-01', 1, 2, 'week', null, [], 'Care plan'],
      ['PH-careplan-62-1', '2026-09-01', 2, 1, 'week', 6, [], 'Care plan'],
      ['PH-careplan-62-2', '2026-09-20', 1, 1, 'week', 9, [], 'Care plan'],
    ])
    expect(plansOf(tables, 'p1').at(-1)!.visit_markers).toEqual([{ at: 9, appointment_type_id: 'type-reexam', label: 'Reexamen' }])
    // Bruno: phase 1 now, phase 2 waiting on it.
    expect(plansOf(tables, 'p2').map((r) => [r.external_reference, r.total_visits, r.next_phases])).toEqual([
      ['PH-careplan-70-1', 6, [{ visits_per_period: 1, frequency_value: 1, frequency_unit: 'week', total_visits: 9 }]],
    ])

    // Plan 62's notes are gone; 80 (off) and 90 (every three days) are notes; the log entry is untouched.
    expect(tables.contact_log!.filter((r) => r.account_id === ACCOUNT).map((r) => [r.patient_id, r.external_reference])).toEqual([
      ['p1', 'PH-log-501'],
      ['p1', 'PH-careplan-90'],
      ['p2', 'PH-careplan-80'],
    ])
  })

  it('a second run writes nothing', async () => {
    const tables = clinic()
    await (await planCarePlans(ctxFor(tables), snapshot())).apply(noop, never)
    const again = await planCarePlans(ctxFor(tables), snapshot())
    expect(again.total).toBe(0)
    expect(again.stats.find((s) => s.label === 'Already imported')!.value).toBe('3')
  })

  it('once a plan is here it is the clinic\'s: a phase PracticeHub adds later is not brought', async () => {
    const tables = clinic()
    await (await planCarePlans(ctxFor(tables), snapshot())).apply(noop, never)
    const later = snapshot()
    later.lists['/care_plans']!.push({ id: 62, version: 1, patient_id: 11, start_date: '2026-09-01 00:00:00', active: 1, visits: 1, interval: '+2 weeks', duration: 4, frequency_type: 'fixed_term', visit_rules: [] })
    expect((await planCarePlans(ctxFor(tables), later)).total).toBe(0)
  })

  it('clears a note whose plan was written by a run cut off before removing it', async () => {
    const tables = clinic()
    tables.care_plans!.push({ id: 'cp', account_id: ACCOUNT, patient_id: 'p1', external_reference: 'PH-careplan-62-1' })
    await (await planCarePlans(ctxFor(tables), snapshot())).apply(noop, never)
    expect(tables.contact_log!.some((r) => r.external_reference === 'PH-careplan-62')).toBe(false)
  })

  it('stopped before writing, writes nothing', async () => {
    const tables = clinic()
    expect(await (await planCarePlans(ctxFor(tables), snapshot())).apply(noop, () => true)).toEqual({ written: 0, errors: [] })
    expect(tables.care_plans!.filter((r) => r.account_id === ACCOUNT)).toHaveLength(0)
  })
})

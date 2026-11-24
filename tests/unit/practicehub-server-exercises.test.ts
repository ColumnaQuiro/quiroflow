import { describe, expect, it } from 'vitest'
import { planExercises, planPracticeHubExerciseRows, practiceHubExerciseText, type PracticeHubExercise } from '../../utils/practicehubImport/exercises'
import type { PracticeHubImportContext, PracticeHubSnapshot } from '../../utils/practicehubImport/types'

// PracticeHub's exercises as the server imports them: the library and each
// patient's copy of a library exercise, from Classic's one /exercises list.
// The rows have the shape the real API sent on 24 Nov 2026; the people and
// the exercises are invented.

type Row = Record<string, unknown>

function fakeSupabase(tables: Record<string, Row[]>, opts: { failReads?: Set<string> } = {}) {
  let seq = 0
  const from = (table: string) => {
    const rows = () => (tables[table] ??= [])
    const q = { op: 'select', values: undefined as unknown, filters: [] as [string, string, unknown][], range: null as [number, number] | null, single: false, count: false }
    const match = (r: Row) => q.filters.every(([kind, col, v]) =>
      kind === 'eq' ? r[col] === v
        : kind === 'is' ? (r[col] ?? null) === v
          : kind === 'notnull' ? (r[col] ?? null) !== null
            : kind === 'in' ? (v as Set<unknown>).has(r[col])
              : kind === 'like' ? String(r[col] ?? '').startsWith(String(v).replace(/%$/, '')) && r[col] != null
                : true)
    const run = () => {
      if (q.op === 'insert') {
        const added = ([] as Row[]).concat(q.values as Row | Row[]).map((v) => ({ id: `${table}-${++seq}`, ...v }))
        rows().push(...added)
        return { data: q.single ? added[0] : added, error: null }
      }
      if (q.op === 'delete') {
        const keep = rows().filter((r) => !match(r))
        const gone = rows().length - keep.length
        tables[table] = keep
        return { data: null, error: null, count: gone }
      }
      if (q.op === 'update') {
        const hit = rows().filter(match)
        for (const r of hit) Object.assign(r, q.values)
        return { data: hit, error: null }
      }
      if (opts.failReads?.has(table)) return { data: null, error: { message: 'statement timeout' }, count: null }
      const found = rows().filter(match)
      const page = q.range ? found.slice(q.range[0], q.range[1] + 1) : found
      return { data: q.single ? page[0] ?? null : page, error: null, count: q.count ? found.length : null }
    }
    const filter = (kind: string) => (col: string, v: unknown) => { q.filters.push([kind, col, v]); return b }
    const b: Record<string, unknown> = {
      select: (_c?: string, o?: { count?: string }) => { if (o?.count) q.count = true; return b },
      order: () => b,
      insert: (v: unknown) => { q.op = 'insert'; q.values = v; return b },
      update: (v: unknown) => { q.op = 'update'; q.values = v; return b },
      delete: () => { q.op = 'delete'; return b },
      eq: filter('eq'),
      is: filter('is'),
      like: filter('like'),
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
const OTHER = 'other-acc'
const t = (en: string) => en
const noop = () => {}
const never = () => false

function ctxFor(tables: Record<string, Row[]>): PracticeHubImportContext {
  return { supabase: fakeSupabase(tables) as never, accountId: ACCOUNT, clinicId: 'c1', defaultPhoneCountry: 'ES', t, files: null }
}

const lib = (id: number, name: string, description: string, video: string, extra: Partial<PracticeHubExercise> = {}): PracticeHubExercise =>
  ({ id, exercise_id: 0, patient_id: 0, name, description, video_url: video, file_url: null, template: '1', active: '1', created: '2026-05-02T08:18:14.000000Z', ...extra })
const given = (id: number, patient: number, name: string, description: string, video: string, extra: Partial<PracticeHubExercise> = {}): PracticeHubExercise =>
  ({ id, exercise_id: 0, patient_id: patient, name, description, video_url: video, file_url: 'https://phub-production.s3.amazonaws.com/1/exercise/x.png?A', template: '0', active: '1', created: '2026-07-19T19:18:49.000000Z', ...extra })

function exercises(): PracticeHubExercise[] {
  return [
    lib(1, 'Puente de glúteo', '3 x 12 \r\ncada día ', 'https://youtu.be/aaa'),
    lib(2, 'Gato-camello', '', 'https://youtu.be/bbb'),
    // Two library exercises of one name, told apart by their video.
    lib(3, 'Rotación torácica', 'Sentado', 'https://youtu.be/ccc'),
    lib(4, 'Rotación torácica', 'De pie', 'https://youtu.be/ddd'),
    lib(5, 'Plancha', 'Retirado', 'https://youtu.be/eee', { active: '0' }),
    // Ana: one as the library has it, one rewritten for her, the standing rotation.
    given(31, 11, 'Puente de glúteo', '3 x 12\r\ncada día', 'https://youtu.be/aaa'),
    given(32, 11, 'Gato-camello', 'Solo por la mañana', 'https://youtu.be/bbb'),
    given(33, 11, 'Rotación torácica', 'De pie', 'https://youtu.be/ddd'),
    // Bruno: an exercise whose library one was deleted, given to Carla too.
    given(34, 12, 'Respiración diafragmática', '5 minutos', 'https://youtu.be/fff'),
    given(35, 13, 'Respiración diafragmática', '5 minutos', 'https://youtu.be/fff'),
    // A patient not in QuiroFlow yet.
    given(36, 14, 'Puente de glúteo', '', 'https://youtu.be/aaa'),
  ]
}

function snapshot(rows = exercises()): PracticeHubSnapshot {
  return {
    readAt: '2026-11-24T10:00:00Z',
    baseUrl: 'https://demo.practicehub.io',
    lists: {
      '/patients': [
        { id: 11, patient_number: '1001' },
        { id: 12, patient_number: '1002' },
        { id: 13, patient_number: '1003' },
        { id: 14, patient_number: '1004' },
      ],
      '/exercises': rows,
    },
  }
}

function clinic(): Record<string, Row[]> {
  return {
    patients: [
      { id: 'p1', account_id: ACCOUNT, external_reference: '1001', first_name: 'Ana', last_name: 'Gil' },
      { id: 'p2', account_id: ACCOUNT, external_reference: '1002', first_name: 'Bruno', last_name: null },
      { id: 'p3', account_id: ACCOUNT, external_reference: '1003', first_name: 'Carla', last_name: 'Ruiz' },
      // Another clinic's patient with PracticeHub's fourth Patient Number: never matched.
      { id: 'x4', account_id: OTHER, external_reference: '1004', first_name: 'Dora', last_name: null },
    ],
    exercises: [
      // The clinic's own, by hand: Gato-camello is used, not doubled.
      { id: 'own-cat', account_id: ACCOUNT, name: 'gato-camello ', external_reference: null, archived_at: null, instructions: 'Mi versión', media_url: null },
      // Another clinic's import of the same PracticeHub ids: not "already here".
      { id: 'x-1', account_id: OTHER, name: 'Puente de glúteo', external_reference: 'PH-exercise-1', archived_at: null },
    ],
    patient_exercises: [
      { id: 'x-pe', account_id: OTHER, patient_id: 'x4', exercise_id: 'x-1', external_reference: 'PH-exercise-31' },
    ],
  }
}

const mine = (rows: Row[]) => rows.filter((r) => r.account_id === ACCOUNT)

describe('practiceHubExerciseText', () => {
  it('drops Windows line ends and trailing spaces, and makes empty null', () => {
    expect(practiceHubExerciseText('3 x 12 \r\ncada día ')).toBe('3 x 12\ncada día')
    expect(practiceHubExerciseText('  ')).toBeNull()
    expect(practiceHubExerciseText(null)).toBeNull()
  })
})

describe('planPracticeHubExerciseRows', () => {
  const here = (exercisesHere = mine(clinic().exercises!) as never[]) => ({
    phPatients: snapshot().lists['/patients'] as { id: number; patient_number: string }[],
    ourPatientByRef: new Map([['1001', { id: 'p1', label: 'Ana Gil' }], ['1002', { id: 'p2', label: 'Bruno' }], ['1003', { id: 'p3', label: 'Carla Ruiz' }]]),
    exercises: exercisesHere,
    assignedRefs: new Set<string>(),
  })

  it('puts each patient’s copy onto its library exercise, by name and then video', () => {
    const plan = planPracticeHubExerciseRows(exercises(), here())
    const ana = plan.assign.filter((a) => a.patientId === 'p1')
    expect(ana.map((a) => [a.name, a.exercise])).toEqual([
      ['Puente de glúteo', { ref: 'PH-exercise-1' }],
      ['Gato-camello', { id: 'own-cat' }],
      ['Rotación torácica', { ref: 'PH-exercise-4' }],
    ])
  })

  it('keeps a description rewritten for the patient as the assignment’s notes, and nothing when it is the library’s', () => {
    const plan = planPracticeHubExerciseRows(exercises(), here())
    const notes = Object.fromEntries(plan.assign.filter((a) => a.patientId === 'p1').map((a) => [a.name, a.notes]))
    expect(notes).toEqual({ 'Puente de glúteo': null, 'Gato-camello': 'Solo por la mañana', 'Rotación torácica': null })
  })

  it('uses a library exercise of the same name already here, and gives it the reference', () => {
    const plan = planPracticeHubExerciseRows(exercises(), here())
    expect(plan.stamp).toEqual([{ id: 'own-cat', ref: 'PH-exercise-2', name: 'Gato-camello' }])
    expect(plan.create.map((e) => e.name)).not.toContain('Gato-camello')
  })

  it('makes one library exercise for a deleted one two patients still have', () => {
    const plan = planPracticeHubExerciseRows(exercises(), here())
    const breathing = plan.create.filter((e) => e.name === 'Respiración diafragmática')
    expect(breathing).toEqual([expect.objectContaining({ ref: 'PH-exercise-34', instructions: '5 minutos', mediaUrl: 'https://youtu.be/fff' })])
    expect(plan.assign.filter((a) => a.name === 'Respiración diafragmática').map((a) => [a.patientId, a.exercise])).toEqual([
      ['p2', { ref: 'PH-exercise-34' }],
      ['p3', { ref: 'PH-exercise-34' }],
    ])
  })

  it('archives a library exercise PracticeHub has switched off, and skips a patient not here', () => {
    const plan = planPracticeHubExerciseRows(exercises(), here())
    expect(plan.create.find((e) => e.name === 'Plancha')?.archived).toBe(true)
    expect(plan.unmatched).toBe(1)
    expect(plan.assign).toHaveLength(5)
  })

  it('picks the same row for a deleted library exercise when the first patient that had it is already given', () => {
    const first = planPracticeHubExerciseRows(exercises(), here())
    const made = first.create.find((e) => e.name === 'Respiración diafragmática')!
    const again = planPracticeHubExerciseRows(exercises(), {
      ...here([...mine(clinic().exercises!), { id: 'ex-34', account_id: ACCOUNT, name: made.name, external_reference: made.ref, archived_at: null }] as never[]),
      assignedRefs: new Set(['PH-exercise-34']),
    })
    expect(again.create.map((e) => e.name)).not.toContain('Respiración diafragmática')
    expect(again.assign.find((a) => a.patientId === 'p3')?.exercise).toEqual({ id: 'ex-34' })
  })
})

describe('planExercises', () => {
  it('writes the library, then each patient’s exercises, all scoped to the account', async () => {
    const tables = clinic()
    const plan = await planExercises(ctxFor(tables), snapshot())
    expect(plan.total).toBe(5 + 1 + 5)
    const res = await plan.apply(noop, never)
    expect(res.errors).toEqual([])

    const lib = mine(tables.exercises!)
    expect(lib.map((e) => e.external_reference).sort()).toEqual(['PH-exercise-1', 'PH-exercise-2', 'PH-exercise-3', 'PH-exercise-34', 'PH-exercise-4', 'PH-exercise-5'])
    // The clinic's own wording is kept: only the reference is added.
    expect(lib.find((e) => e.id === 'own-cat')).toMatchObject({ instructions: 'Mi versión', external_reference: 'PH-exercise-2' })
    expect(lib.find((e) => e.external_reference === 'PH-exercise-1')).toMatchObject({ name: 'Puente de glúteo', instructions: '3 x 12\ncada día', media_url: 'https://youtu.be/aaa', archived_at: null, created_at: '2026-05-02T08:18:14.000Z' })

    const given = mine(tables.patient_exercises!)
    expect(given).toHaveLength(5)
    const pe = given.find((g) => g.external_reference === 'PH-exercise-32')!
    expect(pe).toMatchObject({ patient_id: 'p1', exercise_id: 'own-cat', notes: 'Solo por la mañana', ended_at: null, created_at: '2026-07-19T19:18:49.000Z' })
    // The other clinic's rows are untouched.
    expect(tables.patient_exercises!.filter((r) => r.account_id === OTHER)).toHaveLength(1)
  })

  it('finds nothing left to write the second time', async () => {
    const tables = clinic()
    await (await planExercises(ctxFor(tables), snapshot())).apply(noop, never)
    const again = await planExercises(ctxFor(tables), snapshot())
    expect(again.total).toBe(0)
    expect(again.rows).toEqual([])
  })

  it('throws rather than planning from a copy read before exercises were read', async () => {
    const old = snapshot()
    delete old.lists['/exercises']
    await expect(planExercises(ctxFor(clinic()), old)).rejects.toThrow(/no \/exercises/)
  })
})

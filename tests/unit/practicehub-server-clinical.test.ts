import { describe, expect, it } from 'vitest'
import {
  planCarePlans,
  planPatientLogs,
  planStickyNotes,
  planTreatmentNotes,
  practiceHubCarePlanSummary,
  practiceHubClinicalNoteText,
  practiceHubContactLogRows,
  practiceHubLogNote,
  practiceHubPreviewTruncate,
} from '../../utils/practicehubImport/clinical'
import type { PracticeHubImportContext, PracticeHubSnapshot, PracticeHubStepPlanner } from '../../utils/practicehubImport/types'

// The PracticeHub clinical steps as the server runs them -- Treatment notes,
// Care plans, Patient logs and Sticky notes: the pure rules first, then each
// planner against a database kept in memory that answers only the PostgREST
// calls the planners make. The people are invented.

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

function ctxFor(tables: Record<string, Row[]>, failReads?: Set<string>): PracticeHubImportContext {
  return { supabase: fakeSupabase(tables, { failReads }) as never, accountId: ACCOUNT, clinicId: 'c1', defaultPhoneCountry: 'ES', t, files: null }
}

// PracticeHub: three patients, the third not here yet. Patient 11's record
// carries a sticky note in `note`, as the real API sends it.
function snapshot(): PracticeHubSnapshot {
  return {
    readAt: '2026-11-18T10:00:00Z',
    baseUrl: 'https://demo.practicehub.io',
    lists: {
      '/patients': [
        { id: 11, patient_number: '1001', first_name: 'Ana', note: 'Alergia<br>al látex' },
        { id: 12, patient_number: '1002', first_name: 'Bruno', note: '' },
        { id: 13, patient_number: '1003', first_name: 'Carla', note: 'Paga en efectivo' },
      ],
      '/clinical_notes': [
        { id: 301, patient_id: 11, state: 'final', type: 'soap', data: { soap_data: [{ key: 'S', val: 'Dolor <b>lumbar</b>' }, { label: 'O', value: '' }, { key: 'P', val: 'Revisión&nbsp;2 semanas' }] }, created: '2026-09-01 10:00:00' },
        // patient_id as text, as some lists send it.
        { id: 302, patient_id: '12', state: 'final', type: 'quick', data: null, created: '2026-09-02 11:00:00' },
        { id: 303, patient_id: 13, state: 'final', type: 'soap', data: null, created: '2026-09-03 12:00:00' },
      ],
      '/care_plans': [
        { id: 401, patient_id: 11, start_date: '2026-09-01', active: 1, visits: 2, interval: '1 week', duration: 6, frequency_type: 'weekly' },
        { id: 402, patient_id: 13, start_date: '2026-09-05', active: 0, visits: 1, interval: '2 weeks', duration: 3, frequency_type: 'weekly' },
      ],
      '/patient_logs': [
        { id: 501, patient_id: 11, type: 'note', sub_type: null, data: 'Llamó<br/>para cambiar cita', created: '2026-09-04 09:00:00' },
        { id: 502, patient_id: 12, type: 'sms', sub_type: 'reminder', data: '<p></p>', created: '2026-09-05 09:00:00' },
      ],
    },
  }
}

function clinic(): Record<string, Row[]> {
  return {
    patients: [
      { id: 'p1', account_id: ACCOUNT, external_reference: '1001', first_name: 'Ana', last_name: 'Gil', sticky_note: null },
      { id: 'p2', account_id: ACCOUNT, external_reference: '1002', first_name: 'Bruno', last_name: null, sticky_note: 'Old' },
      // Another clinic's patient with PracticeHub's third Patient Number: never matched.
      { id: 'x3', account_id: OTHER, external_reference: '1003', first_name: 'Carla', last_name: 'Ruiz', sticky_note: null },
    ],
    contact_log: [
      // Another clinic's import of the same PracticeHub ids: not "already here".
      { id: 'xc1', account_id: OTHER, patient_id: 'x3', external_reference: 'PH-clinicalnote-301' },
      { id: 'xc2', account_id: OTHER, patient_id: 'x3', external_reference: 'PH-careplan-401' },
      { id: 'xc3', account_id: OTHER, patient_id: 'x3', external_reference: 'PH-log-501' },
    ],
  }
}

const mine = (tables: Record<string, Row[]>, prefix: string) =>
  tables.contact_log!.filter((r) => r.account_id === ACCOUNT && String(r.external_reference).startsWith(prefix))

describe('the rules shared with the browser importers', () => {
  it('writes a treatment note as its SOAP sections, without HTML, skipping empty ones', () => {
    expect(practiceHubClinicalNoteText(snapshot().lists['/clinical_notes']![0] as never)).toBe('S: Dolor lumbar\nP: Revisión 2 semanas')
    expect(practiceHubClinicalNoteText({ data: null })).toBe('(empty)')
  })

  it('summarises a Classic care plan in the words every import has stored', () => {
    expect(practiceHubCarePlanSummary(snapshot().lists['/care_plans']![0] as never)).toBe('2 visit(s), every 1 week, for 6 occurrence(s) (weekly) starting 2026-09-01. Active.')
  })

  it('keeps a log entry’s PracticeHub type as a prefix, and drops an empty body', () => {
    expect(practiceHubLogNote({ type: 'note', sub_type: null, data: 'Llamó<br/>para cambiar cita' })).toBe('[note] Llamó\npara cambiar cita')
    expect(practiceHubLogNote({ type: 'sms', sub_type: 'reminder', data: '<p></p>' })).toBe('[sms/reminder]')
  })

  it('truncates a preview at 90 characters by default', () => {
    expect(practiceHubPreviewTruncate('x'.repeat(91))).toBe(`${'x'.repeat(90)}…`)
    expect(practiceHubPreviewTruncate('short')).toBe('short')
  })

  it('matches by Patient Number, skips what is already here and what has no patient', () => {
    const r = practiceHubContactLogRows(snapshot().lists['/care_plans'] as { id: number; patient_id: number }[], {
      prefix: 'PH-careplan-',
      phPatients: snapshot().lists['/patients'] as never,
      ourPatientByRef: new Map([['1001', { id: 'p1', label: 'Ana Gil' }]]),
      haveRefs: new Set(),
      note: () => 'n',
      createdAt: () => 'c',
    })
    expect(r.candidates.map((c) => [c.ref, c.patientId])).toEqual([['PH-careplan-401', 'p1']])
    expect(r.skippedUnmatched).toBe(1)
  })
})

describe.each<[string, PracticeHubStepPlanner, string, number]>([
  ['Treatment notes', planTreatmentNotes, 'PH-clinicalnote-', 2],
  ['Care plans', planCarePlans, 'PH-careplan-', 1],
  ['Patient logs', planPatientLogs, 'PH-log-', 2],
])('the %s step on the server', (_name, planner, prefix, expected) => {
  it('plans only from this account and writes every row with it', async () => {
    const tables = clinic()
    const p = await planner(ctxFor(tables), snapshot())
    expect(p.total).toBe(expected)
    expect(p.rows).toHaveLength(expected)
    const done: number[] = []
    expect(await p.apply((n) => done.push(n), never)).toEqual({ written: expected, errors: [] })
    expect(done.at(-1)).toBe(expected)
    const written = mine(tables, prefix)
    expect(written).toHaveLength(expected)
    for (const r of written) {
      expect(r.account_id).toBe(ACCOUNT)
      expect(r.action).toBe('other')
      expect(['p1', 'p2']).toContain(r.patient_id)
    }
    // The other clinic's rows are untouched, and its patient got nothing.
    expect(tables.contact_log!.filter((r) => r.patient_id === 'x3')).toHaveLength(3)
  })

  it('run again, plans and writes nothing', async () => {
    const tables = clinic()
    await (await planner(ctxFor(tables), snapshot())).apply(noop, never)
    const again = await planner(ctxFor(tables), snapshot())
    expect(again.total).toBe(0)
    expect(await again.apply(noop, never)).toEqual({ written: 0, errors: [] })
    expect(mine(tables, prefix)).toHaveLength(expected)
  })

  it('stopped before writing, writes nothing; the next slice writes it all', async () => {
    const tables = clinic()
    expect(await (await planner(ctxFor(tables), snapshot())).apply(noop, () => true)).toEqual({ written: 0, errors: [] })
    expect(mine(tables, prefix)).toHaveLength(0)
    await (await planner(ctxFor(tables), snapshot())).apply(noop, never)
    expect(mine(tables, prefix)).toHaveLength(expected)
  })

  it('a failed read throws rather than planning everything again', async () => {
    await expect(planner(ctxFor(clinic(), new Set(['contact_log'])), snapshot())).rejects.toThrow(/contact_log/)
    await expect(planner(ctxFor(clinic(), new Set(['patients'])), snapshot())).rejects.toThrow(/patients/)
  })
})

describe('what each contact-history step writes', () => {
  it('treatment notes: typed, dated when written, and reported per patient', async () => {
    const tables = clinic()
    const p = await planTreatmentNotes(ctxFor(tables), snapshot())
    expect(p.rows[0]).toEqual({ date: '2026-09-01', patient: 'Ana Gil', type: 'soap', note: '[clinical_note/soap] S: Dolor lumbar\nP: Revisión 2 semanas' })
    expect(p.warnings.some((w) => w.includes('1 notes are skipped'))).toBe(true)
    await p.apply(noop, never)
    expect(mine(tables, 'PH-clinicalnote-').map((r) => [r.external_reference, r.patient_id, r.note, r.created_at])).toEqual([
      ['PH-clinicalnote-301', 'p1', '[clinical_note/soap] S: Dolor lumbar\nP: Revisión 2 semanas', '2026-09-01 10:00:00'],
      ['PH-clinicalnote-302', 'p2', '[clinical_note/quick] (empty)', '2026-09-02 11:00:00'],
    ])
  })

  it('care plans: dated from their start', async () => {
    const tables = clinic()
    await (await planCarePlans(ctxFor(tables), snapshot())).apply(noop, never)
    expect(mine(tables, 'PH-careplan-').map((r) => [r.note, r.created_at])).toEqual([
      ['[care_plan] 2 visit(s), every 1 week, for 6 occurrence(s) (weekly) starting 2026-09-01. Active.', '2026-09-01'],
    ])
  })

  it('patient logs: the type kept on the note', async () => {
    const tables = clinic()
    await (await planPatientLogs(ctxFor(tables), snapshot())).apply(noop, never)
    expect(mine(tables, 'PH-log-').map((r) => r.note)).toEqual(['[note] Llamó\npara cambiar cita', '[sms/reminder]'])
  })
})

describe('the Sticky notes step on the server', () => {
  it('finds the field, updates only this account’s patients, and says which field it read', async () => {
    const tables = clinic()
    const p = await planStickyNotes(ctxFor(tables), snapshot())
    expect(p.stats.find((s) => s.label === 'Reading from PracticeHub field')!.value).toBe('note')
    // Ana gets hers; Bruno's is empty in PracticeHub; Carla is another clinic's.
    expect(p.total).toBe(1)
    expect(p.rows).toEqual([{ patient: 'Ana Gil', current: '(blank)', next: 'Alergia\nal látex' }])
    expect(await p.apply(noop, never)).toEqual({ written: 1, errors: [] })
    expect(tables.patients!.map((r) => [r.id, r.sticky_note])).toEqual([['p1', 'Alergia\nal látex'], ['p2', 'Old'], ['x3', null]])
  })

  it('warns when a note here is about to be replaced', async () => {
    const tables = clinic()
    tables.patients![0]!.sticky_note = 'Escrita aquí'
    const p = await planStickyNotes(ctxFor(tables), snapshot())
    expect(p.warnings.some((w) => w.includes('will have it replaced'))).toBe(true)
  })

  it('run again, plans and writes nothing', async () => {
    const tables = clinic()
    await (await planStickyNotes(ctxFor(tables), snapshot())).apply(noop, never)
    const again = await planStickyNotes(ctxFor(tables), snapshot())
    expect(again.total).toBe(0)
    expect(await again.apply(noop, never)).toEqual({ written: 0, errors: [] })
  })

  it('stopped, writes nothing', async () => {
    const tables = clinic()
    expect(await (await planStickyNotes(ctxFor(tables), snapshot())).apply(noop, () => true)).toEqual({ written: 0, errors: [] })
    expect(tables.patients![0]!.sticky_note).toBeNull()
  })

  it('with no sticky-looking field at all, plans nothing and lists the fields it saw', async () => {
    const s = snapshot()
    s.lists['/patients'] = [{ id: 11, patient_number: '1001', first_name: 'Ana' }]
    const p = await planStickyNotes(ctxFor(clinic()), s)
    expect(p.total).toBe(0)
    expect(p.warnings.at(-1)).toBe('Fields PracticeHub returned: first_name, id, patient_number')
  })

  it('a failed read of the patients throws', async () => {
    await expect(planStickyNotes(ctxFor(clinic(), new Set(['patients'])), snapshot())).rejects.toThrow(/patients/)
  })
})

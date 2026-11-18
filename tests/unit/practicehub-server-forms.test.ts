import { describe, expect, it } from 'vitest'
import {
  keepNewestNationalId,
  planCustomFormResponses,
  practiceHubFormNationalId,
  practiceHubFormsRows,
  practiceHubFormTemplateReference,
} from '../../utils/practicehubImport/forms'
import type { DocField } from '../../utils/docFields'
import type { PracticeHubImportContext, PracticeHubSnapshot } from '../../utils/practicehubImport/types'

// The PracticeHub Form responses step as the server runs it: the pure rules
// first, then the planner against a database kept in memory that answers only
// the PostgREST calls it makes. The people and forms are invented.

type Row = Record<string, unknown>

function fakeSupabase(tables: Record<string, Row[]>, opts: { failReads?: Set<string>; failInserts?: Set<string> } = {}) {
  let seq = 0
  const from = (table: string) => {
    const rows = () => (tables[table] ??= [])
    const q = { op: 'select', values: undefined as unknown, filters: [] as [string, string, unknown][], range: null as [number, number] | null, single: false, count: false }
    const match = (r: Row) => q.filters.every(([kind, col, v]) =>
      kind === 'eq' ? r[col] === v
        : kind === 'is' ? (r[col] ?? null) === v
          : kind === 'notnull' ? (r[col] ?? null) !== null
            : kind === 'in' ? (v as Set<unknown>).has(r[col])
              : kind === 'like' ? r[col] != null && String(r[col]).startsWith(String(v).replace(/%$/, ''))
                : true)
    const run = () => {
      if (q.op === 'insert') {
        if (opts.failInserts?.has(table)) return { data: null, error: { message: 'insert refused' } }
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

function ctxFor(tables: Record<string, Row[]>, opts?: { failReads?: Set<string>; failInserts?: Set<string> }): PracticeHubImportContext {
  return { supabase: fakeSupabase(tables, opts) as never, accountId: ACCOUNT, clinicId: 'c1', defaultPhoneCountry: 'ES', t, files: null }
}

const field = (name: string, value: string, label: string) => ({ name, value, label })

// Two forms. Ana filled the intake twice (her DNI changed between them),
// Bruno once and the consent once; Carla is not here.
function snapshot(): PracticeHubSnapshot {
  return {
    readAt: '2026-11-18T10:00:00Z',
    baseUrl: 'https://demo.practicehub.io',
    lists: {
      '/patients': [{ id: 11, patient_number: '1001' }, { id: 12, patient_number: '1002' }, { id: 13, patient_number: '1003' }],
      '/custom_form_responses': [
        { id: 901, form_id: 'f-intake', form_name: 'Ficha inicial', patient_id: '11', created: '2026-09-01 10:00:00', data: [field('text-1', '11111111H', 'DNI'), field('checkbox-group-1[]', 'Fisio', '¿Otros especialistas?')] },
        { id: 902, form_id: 'f-intake', form_name: 'Ficha inicial', patient_id: '11', created: '2026-10-01 10:00:00', data: [field('text-1', '22222222J', 'DNI'), field('checkbox-group-1[]', 'Osteópata', '¿Otros especialistas?')] },
        { id: 903, form_id: 'f-intake', form_name: 'Ficha inicial', patient_id: 12, created: '2026-09-02 10:00:00', data: [field('text-1', '33333333P', 'DNI')] },
        { id: 904, form_id: 'f-consent', form_name: 'Protección de Datos', patient_id: '12', created: '2026-09-02 10:05:00', data: [field('checkbox-1', 'on', 'Acepto')] },
        { id: 905, form_id: 'f-intake', form_name: 'Ficha inicial', patient_id: '13', created: '2026-09-03 10:00:00', data: [field('text-1', '44444444A', 'DNI')] },
      ],
    },
  }
}

function clinic(): Record<string, Row[]> {
  return {
    patients: [
      { id: 'p1', account_id: ACCOUNT, external_reference: '1001', first_name: 'Ana', last_name: 'Gil', national_id: null },
      // Typed here by the clinic: never replaced by a form.
      { id: 'p2', account_id: ACCOUNT, external_reference: '1002', first_name: 'Bruno', last_name: null, national_id: '99999999R' },
      { id: 'x3', account_id: OTHER, external_reference: '1003', first_name: 'Carla', last_name: 'Ruiz', national_id: null },
    ],
    // Another clinic's import of the same PracticeHub form and response: neither is "already here".
    doc_templates: [{ id: 'xt', account_id: OTHER, external_reference: 'PH-form-template-f-intake', title: 'Ficha inicial' }],
    patient_docs: [{ id: 'xd', account_id: OTHER, patient_id: 'x3', external_reference: 'PH-form-901' }],
  }
}

const docsHere = (tables: Record<string, Row[]>) => tables.patient_docs!.filter((d) => d.account_id === ACCOUNT)
const templatesHere = (tables: Record<string, Row[]>) => tables.doc_templates!.filter((d) => d.account_id === ACCOUNT)

describe('the rules shared with the browser importer', () => {
  const block = (o: Partial<DocField>): DocField => ({ id: 'b', type: 'short_text', label: 'DNI', ...o })

  it('reads the patient’s own DNI only from a linked answer that reads as one', () => {
    expect(practiceHubFormNationalId([block({ value: 'no sé' , patientField: 'national_id' }), block({ value: ' 12345678Z ', patientField: 'national_id' })])).toBe('12345678Z')
    expect(practiceHubFormNationalId([block({ value: '12345678Z' })])).toBeNull()
  })

  it('keeps the newest form’s DNI per patient', () => {
    const map = new Map<string, { value: string; at: string }>()
    keepNewestNationalId(map, 'p', [block({ value: '22222222J', patientField: 'national_id' })], '2026-10-01 10:00:00')
    keepNewestNationalId(map, 'p', [block({ value: '11111111H', patientField: 'national_id' })], '2026-09-01 10:00:00')
    expect(map.get('p')).toEqual({ value: '22222222J', at: '2026-10-01 10:00:00' })
  })

  it('plans one template per form, and every response whose patient is here', () => {
    const s = snapshot().lists
    let n = 0
    const r = practiceHubFormsRows({
      phPatients: s['/patients'] as never,
      responses: s['/custom_form_responses'] as never,
      ourPatientByRef: new Map([['1001', { id: 'p1', label: 'Ana Gil' }], ['1002', { id: 'p2', label: 'Bruno' }]]),
      haveDocRefs: new Set(['PH-form-901']),
      templateIdByRef: new Map([[practiceHubFormTemplateReference('f-consent'), 'tpl-consent']]),
      newId: () => `id-${++n}`,
    })
    expect(r.templates.map((tpl) => [tpl.formId, tpl.formName])).toEqual([['f-intake', 'Ficha inicial']])
    // The template's checkbox question lists every option any patient ticked, none ticked.
    expect(r.templates[0]!.fields.find((f) => f.type === 'choice')).toMatchObject({ options: ['Fisio', 'Osteópata'], value: [] })
    expect(r.existingTemplateIdByFormId).toEqual(new Map([['f-consent', 'tpl-consent']]))
    expect(r.candidates.map((c) => [c.ref, c.patientId])).toEqual([['PH-form-902', 'p1'], ['PH-form-903', 'p2'], ['PH-form-904', 'p2']])
    expect(r.skippedDuplicate).toBe(1)
    expect(r.skippedUnmatched).toBe(1)
    // The DNI of a form already saved here still counts.
    expect(r.nationalIdFromImported).toEqual(new Map([['p1', { value: '11111111H', at: '2026-09-01 10:00:00' }]]))
  })
})

describe('the Form responses step on the server', () => {
  it('plans only from this account and writes every row with it', async () => {
    const tables = clinic()
    const p = await planCustomFormResponses(ctxFor(tables), snapshot())
    // Two templates, four forms (Carla is not here), one DNI (Bruno has his own).
    expect(p.total).toBe(2 + 4 + 1)
    const done: number[] = []
    expect(await p.apply((n) => done.push(n), never)).toEqual({ written: 7, errors: [] })
    expect(done.at(-1)).toBe(7)

    const templates = templatesHere(tables)
    expect(templates.map((tpl) => [tpl.external_reference, tpl.title])).toEqual([
      ['PH-form-template-f-intake', 'Ficha inicial'],
      ['PH-form-template-f-consent', 'Protección de Datos'],
    ])
    const intake = templates[0]!.id
    const docs = docsHere(tables)
    expect(docs.map((d) => [d.external_reference, d.patient_id, d.template_id, d.completed_at])).toEqual([
      ['PH-form-901', 'p1', intake, '2026-09-01 10:00:00'],
      ['PH-form-902', 'p1', intake, '2026-10-01 10:00:00'],
      ['PH-form-903', 'p2', intake, '2026-09-02 10:00:00'],
      ['PH-form-904', 'p2', templates[1]!.id, '2026-09-02 10:05:00'],
    ])
    // Ana's newest DNI; Bruno's own kept; the other clinic's patient untouched.
    expect(tables.patients!.map((p) => [p.id, p.national_id])).toEqual([['p1', '22222222J'], ['p2', '99999999R'], ['x3', null]])
    expect(tables.doc_templates!.filter((d) => d.account_id === OTHER)).toHaveLength(1)
  })

  it('run again, plans and writes nothing', async () => {
    const tables = clinic()
    await (await planCustomFormResponses(ctxFor(tables), snapshot())).apply(noop, never)
    const again = await planCustomFormResponses(ctxFor(tables), snapshot())
    expect(again.total).toBe(0)
    expect(await again.apply(noop, never)).toEqual({ written: 0, errors: [] })
    expect(templatesHere(tables)).toHaveLength(2)
    expect(docsHere(tables)).toHaveLength(4)
  })

  it('a slice stopped after the templates does not create them twice, and the next one files the forms under them', async () => {
    const tables = clinic()
    const first = await planCustomFormResponses(ctxFor(tables), snapshot())
    let calls = 0
    // Lets the two template inserts through, then stops before the forms.
    await first.apply(noop, () => ++calls > 2)
    expect(templatesHere(tables)).toHaveLength(2)
    expect(docsHere(tables)).toHaveLength(0)

    const next = await planCustomFormResponses(ctxFor(tables), snapshot())
    expect(next.total).toBe(4 + 1)
    await next.apply(noop, never)
    expect(templatesHere(tables)).toHaveLength(2)
    const ids = new Set(templatesHere(tables).map((tpl) => tpl.id))
    expect(docsHere(tables).every((d) => ids.has(d.template_id))).toBe(true)
  })

  it('a slice stopped after the forms but before the DNI fills it next time', async () => {
    const tables = clinic()
    const first = await planCustomFormResponses(ctxFor(tables), snapshot())
    let calls = 0
    // Two templates, one chunk of forms, then stop.
    await first.apply(noop, () => ++calls > 3)
    expect(docsHere(tables)).toHaveLength(4)
    expect(tables.patients![0]!.national_id).toBeNull()

    const next = await planCustomFormResponses(ctxFor(tables), snapshot())
    expect(next.total).toBe(1)
    expect(await next.apply(noop, never)).toEqual({ written: 1, errors: [] })
    expect(tables.patients![0]!.national_id).toBe('22222222J')
  })

  it('never replaces a DNI typed here between the plan and the write', async () => {
    const tables = clinic()
    const p = await planCustomFormResponses(ctxFor(tables), snapshot())
    tables.patients![0]!.national_id = '55555555K'
    await p.apply(noop, never)
    expect(tables.patients![0]!.national_id).toBe('55555555K')
  })

  it('takes no DNI from forms that were not saved', async () => {
    const tables = clinic()
    const p = await planCustomFormResponses(ctxFor(tables, { failInserts: new Set(['patient_docs']) }), snapshot())
    const result = await p.apply(noop, never)
    expect(result.errors).toEqual(['Forms 1-4 were not saved: insert refused'])
    expect(tables.patients![0]!.national_id).toBeNull()
  })

  it('stopped before anything, writes nothing', async () => {
    const tables = clinic()
    expect(await (await planCustomFormResponses(ctxFor(tables), snapshot())).apply(noop, () => true)).toEqual({ written: 0, errors: [] })
    expect(templatesHere(tables)).toHaveLength(0)
  })

  it('a failed read throws rather than planning everything again', async () => {
    for (const table of ['patients', 'patient_docs', 'doc_templates'])
      await expect(planCustomFormResponses(ctxFor(clinic(), { failReads: new Set([table]) }), snapshot())).rejects.toThrow(table)
  })
})

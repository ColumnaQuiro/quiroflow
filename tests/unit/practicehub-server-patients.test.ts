import { describe, expect, it } from 'vitest'
import {
  planPatients,
  practiceHubBalanceCents,
  practiceHubCreatedAt,
  practiceHubLanguage,
  practiceHubNumberCountries,
  practiceHubOnlyNewNumbers,
  practiceHubPatientUpdate,
  practiceHubPatientsDiff,
  practiceHubPractitionerMatcher,
  type PracticeHubExistingPatient,
  type PracticeHubPatientsDiffOptions,
} from '../../utils/practicehubImport/patients'
import type { PracticeHubImportContext, PracticeHubSnapshot } from '../../utils/practicehubImport/types'

// The Patients step of the PracticeHub import, shared by the browser screen
// and the server sync. The pure rules first, then the server planner against
// a database kept in memory. The people are invented.

type Row = Record<string, unknown>

function fakeSupabase(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const rows = () => (tables[table] ??= [])
    const q = { op: 'select', values: undefined as unknown, filters: [] as [string, string, unknown][], range: null as [number, number] | null }
    const match = (r: Row) => q.filters.every(([kind, col, v]) =>
      kind === 'eq' ? r[col] === v
        : kind === 'is' ? (r[col] ?? null) === v
          : (v as Set<unknown>).has(r[col]))
    const run = () => {
      if (q.op === 'insert') {
        const added = ([] as Row[]).concat(q.values as Row | Row[]).map((v, i) => ({ id: `${table}-${rows().length + i + 1}`, ...v }))
        rows().push(...added)
        return { data: added, error: null }
      }
      if (q.op === 'update') {
        const hit = rows().filter(match)
        for (const r of hit) Object.assign(r, q.values)
        return { data: hit, error: null }
      }
      const found = rows().filter(match)
      return { data: q.range ? found.slice(q.range[0], q.range[1] + 1) : found, error: null }
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
      range: (a: number, z: number) => { q.range = [a, z]; return b },
      then: (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, no),
    }
    return b
  }
  return { from }
}

const t = (en: string) => en
const ACCOUNT = 'acc'

function existingPatient(over: Partial<PracticeHubExistingPatient> = {}): PracticeHubExistingPatient {
  return {
    id: 'p1', external_reference: '202400007', email: 'lucia@example.test', first_name: 'Lucía', last_name: 'Demo',
    date_of_birth: '1990-04-02', referral_source: null, preferred_language: 'es', marketing_channels: [], default_practitioner_id: null,
    created_at: '2024-03-05T09:15:00+00:00', balance_cents: 0, photo_storage_path: null,
    ...over,
  }
}

const show = (_field: string, value: unknown) => (value === null || value === undefined || value === '' ? '(blank)' : String(value))
const blank = (value: unknown) => (value === null || value === undefined || value === '' ? '(blank)' : String(value))

function diffOptions(over: Partial<PracticeHubPatientsDiffOptions> = {}): PracticeHubPatientsDiffOptions {
  return {
    accountId: ACCOUNT, clinicId: 'clinic-1', externalRefFor: (r) => r, countryFor: () => 'ES',
    practitionerFor: practiceHubPractitionerMatcher([{ id: 'tm-1', full_name: 'Marta Ruiz' }]), show, blank,
    ...over,
  }
}

describe('PracticeHub patient fields', () => {
  it('flips the balance: PracticeHub owed is positive, ours is negative', () => {
    expect(practiceHubBalanceCents('45.00')).toBe(-4500)
    expect(practiceHubBalanceCents('-12.5')).toBe(1250)
    expect(practiceHubBalanceCents('')).toBe(0)
  })

  it('keeps a known language and falls back to Spanish', () => {
    expect(practiceHubLanguage(' FR ')).toBe('fr')
    expect(practiceHubLanguage('xx')).toBe('es')
  })

  it('reads the join date as UTC from either column name', () => {
    expect(practiceHubCreatedAt({ 'Patient Created': '2024-03-05 09:15:00' })).toBe('2024-03-05T09:15:00.000Z')
    expect(practiceHubCreatedAt({ Created: '2024-03-05 09:15:00' })).toBe('2024-03-05T09:15:00.000Z')
    expect(practiceHubCreatedAt({})).toBeUndefined()
  })

  it('reads each number\'s country by patient number and number', () => {
    const map = practiceHubNumberCountries([
      { id: 1, patient_number: '7', numbers: [{ number: ' 600 11 22 33 ', iso2: 'es' }, { number: '(303) 710-5245', iso2: 'us' }, { number: '611', iso2: null }] },
      { id: 2, patient_number: null, numbers: [{ number: '1', iso2: 'fr' }] },
    ])
    expect([...map]).toEqual([['7|600 11 22 33', 'ES'], ['7|(303) 710-5245', 'US']])
  })
})

describe('updating a patient already here', () => {
  const incoming = { account_id: ACCOUNT, first_name: 'Lucía', last_name: null, email: null, date_of_birth: null, referral_source: 'Google', preferred_language: 'es', marketing_channels: [], default_practitioner_id: null, balance_cents: 0 }

  it('never erases with a blank, and overwrites what PracticeHub owns', () => {
    const { updates } = practiceHubPatientUpdate(existingPatient({ balance_cents: 500 }), incoming, '202400007', '202400007', undefined, show, blank)
    // last_name, email, date_of_birth null and marketing [] are left alone;
    // a zero balance is a value, so it overwrites.
    expect(updates).toEqual({ referral_source: 'Google', balance_cents: 0 })
  })

  it('compares the join date as an instant, not as text', () => {
    const same = practiceHubPatientUpdate(existingPatient(), incoming, '202400007', '202400007', '2024-03-05T09:15:00.000Z', show, blank)
    expect(same.updates.created_at).toBeUndefined()
    const moved = practiceHubPatientUpdate(existingPatient(), incoming, '202400007', '202400007', '2023-01-01T00:00:00.000Z', show, blank)
    expect(moved.updates.created_at).toBe('2023-01-01T00:00:00.000Z')
  })

  it('backfills the reference, and corrects one stored under the custom reference', () => {
    const byEmail = practiceHubPatientUpdate(existingPatient({ external_reference: null }), incoming, '202400007', '202400007', undefined, show, blank)
    expect(byEmail.updates.external_reference).toBe('202400007')
    const custom = practiceHubPatientUpdate(existingPatient({ external_reference: 'X0000000T' }), incoming, '202400007', 'X0000000T', undefined, show, blank)
    expect(custom.updates.external_reference).toBe('202400007')
    const other = practiceHubPatientUpdate(existingPatient({ external_reference: 'MANUAL-1' }), incoming, '202400007', '202400007', undefined, show, blank)
    expect(other.updates.external_reference).toBeUndefined()
  })
})

describe('what each row does', () => {
  const row = (over: Record<string, string> = {}) => ({ 'Patient Number': '202400007', 'First Name': 'Lucía', 'Last Name': 'Demo', 'Email Address': 'lucia@example.test', 'Date of Birth': '1990-04-02', 'Preferred Language': 'es', 'Account Balance': '0', ...over })

  it('skips deleted and nameless rows, and names the practitioners not on the team', () => {
    const d = practiceHubPatientsDiff([
      row({ Deleted: 'TRUE' }),
      row({ 'First Name': '', 'Last Name': '' }),
      row({ 'Patient Number': '1', 'Email Address': '', 'Default Practitioner': 'Marta Ruiz' }),
      row({ 'Patient Number': '2', 'Email Address': '', 'Default Practitioner': 'Pablo Nuevo' }),
      row({ 'Patient Number': '3', 'Email Address': '', 'Default Practitioner': 'Pablo Nuevo' }),
    ], [], diffOptions())
    expect([d.skippedDeleted, d.skippedNoName, d.toImport.length]).toEqual([1, 1, 3])
    expect(d.toImport[0]!.patient.default_practitioner_id).toBe('tm-1')
    expect(d.unmatchedPractitioners).toEqual([{ name: 'Pablo Nuevo', patients: 2 }])
  })

  it('a row with only a last name gets it as the first name', () => {
    const d = practiceHubPatientsDiff([row({ 'First Name': '', 'Last Name': 'Demo' })], [], diffOptions())
    expect(d.toImport[0]!.patient).toMatchObject({ first_name: 'Demo', last_name: null })
  })

  it('matches by patient number, then by the custom reference, then by email', () => {
    const here = [existingPatient({ id: 'by-ref', email: null }), existingPatient({ id: 'by-custom', external_reference: 'X1', email: null }), existingPatient({ id: 'by-email', external_reference: null, email: 'ana@example.test' })]
    const d = practiceHubPatientsDiff([
      row({ 'Mobile': '600' }),
      row({ 'Patient Number': 'X1', 'Email Address': '', 'Mobile': '601' }),
      row({ 'Patient Number': '9', 'Email Address': 'ANA@example.test', 'Mobile': '602' }),
    ], here, diffOptions({ externalRefFor: (r) => (r === 'X1' ? '555' : r) }))
    expect(d.toImport).toEqual([])
    expect(d.toUpdate.map((u) => u.id)).toEqual(['by-ref', 'by-custom', 'by-email'])
    expect(d.toUpdate[1]!.updates.external_reference).toBe('555')
  })

  it('only adds numbers the patient does not have yet, ignoring formatting', () => {
    const d = practiceHubPatientsDiff([row({ Mobile: '600 11 22 33', Home: '911 22 33 44' })], [existingPatient()], diffOptions())
    const { changed, unchanged } = practiceHubOnlyNewNumbers(d.toUpdate, [{ patient_id: 'p1', number: '600112233' }], t)
    expect(unchanged).toBe(0)
    expect(changed[0]!.numbers.map((n) => n.number)).toEqual(['911 22 33 44'])
    const again = practiceHubOnlyNewNumbers(changed, [{ patient_id: 'p1', number: '600112233' }, { patient_id: 'p1', number: '911-22-33-44' }], t)
    expect([again.changed.length, again.unchanged]).toEqual([0, 1])
  })
})

describe('the server step', () => {
  const snapshot = (): PracticeHubSnapshot => ({
    readAt: '', baseUrl: '',
    lists: {
      '/practitioners': [{ id: 9, first_name: 'Marta', last_name: 'Ruiz' }],
      '/referral_sources': [{ id: 12, name: 'Google' }],
      '/patients': [
        {
          id: 501, patient_number: '202400007', first_name: 'Lucía', last_name: 'Demo', email: 'lucia@example.test', dob: '1990-04-02',
          created: '2024-03-05 09:15:00', balance: '45.00', locale: 'fr',
          numbers: [{ number: '600 11 22 33', type: 'Mobile', iso2: 'es' }, { number: '(303) 710-5245', type: 'Home', iso2: 'us' }, { number: '700 00 00 00', type: 'Other' }],
          default_practitioners: [{ practitioner_id: 9 }], referral_source_type: 'referral_source', referral_source_id: '12',
        },
        { id: 502, patient_number: '202400008', first_name: 'Pablo', last_name: 'Prueba', email: null, balance: '0' },
      ],
    },
  })

  function setup(tables: Record<string, Row[]>, over: Partial<PracticeHubImportContext> = {}) {
    const ctx = { supabase: fakeSupabase(tables) as never, accountId: ACCOUNT, clinicId: 'clinic-1', defaultPhoneCountry: 'PT', t, files: null, ...over } as PracticeHubImportContext
    return ctx
  }

  it('plans against this account only, writes everything, and finds nothing to do the second time', async () => {
    const tables: Record<string, Row[]> = {
      team_members: [{ id: 'tm-1', account_id: ACCOUNT, full_name: 'Marta Ruiz' }, { id: 'tm-x', account_id: 'other', full_name: 'Marta Ruiz' }],
      // Another clinic's patient with the same number is not this one.
      patients: [{ ...existingPatient({ id: 'foreign' }), account_id: 'other' }],
      patient_contact_numbers: [],
    }
    const ctx = setup(tables)
    const plan = await planPatients(ctx, snapshot())
    expect(plan.total).toBe(2)
    expect(plan.rows.map((r) => r.name)).toEqual(['Lucía Demo', 'Pablo Prueba'])

    const result = await plan.apply(() => {}, () => false)
    expect(result).toEqual({ written: 2, errors: [] })
    const ours = tables.patients!.filter((p) => p.account_id === ACCOUNT)
    expect(ours).toHaveLength(2)
    expect(ours[0]).toMatchObject({
      clinic_id: 'clinic-1', external_reference: '202400007', balance_cents: -4500, preferred_language: 'fr',
      default_practitioner_id: 'tm-1', referral_source: 'Google', created_at: '2024-03-05T09:15:00.000Z',
    })
    // PracticeHub's country where it gives one, the account's own where not.
    expect(tables.patient_contact_numbers!.map((n) => [n.number, n.country_code, n.account_id])).toEqual([
      ['600 11 22 33', 'ES', ACCOUNT], ['(303) 710-5245', 'US', ACCOUNT], ['700 00 00 00', 'PT', ACCOUNT],
    ])
    expect(tables.patients!.find((p) => p.id === 'foreign')).toMatchObject({ account_id: 'other', balance_cents: 0 })

    const again = await planPatients(ctx, snapshot())
    expect(again.total).toBe(0)
  })

  it('updates what PracticeHub changed and adds only the new number', async () => {
    const tables: Record<string, Row[]> = {
      team_members: [],
      patients: [{ ...existingPatient({ id: 'p1', balance_cents: 0, preferred_language: 'fr' }), account_id: ACCOUNT }],
      patient_contact_numbers: [{ id: 'n1', account_id: ACCOUNT, patient_id: 'p1', number: '600-11-22-33', country_code: 'ES' }],
    }
    const ctx = setup(tables)
    const plan = await planPatients(ctx, { ...snapshot(), lists: { ...snapshot().lists, '/patients': [snapshot().lists['/patients']![0]] } })
    expect(plan.total).toBe(1)
    expect(plan.rows[0]!.what).toContain('Balance')
    // Not on the team: named, and the field is left alone.
    expect(plan.warnings.some((w) => w.includes('Marta Ruiz (1)'))).toBe(true)
    await plan.apply(() => {}, () => false)
    expect(tables.patients![0]).toMatchObject({ balance_cents: -4500, last_name: 'Demo', default_practitioner_id: null, referral_source: 'Google' })
    expect(tables.patient_contact_numbers!.map((n) => n.number)).toEqual(['600-11-22-33', '(303) 710-5245', '700 00 00 00'])
  })

  it('stops between chunks when told to', async () => {
    const tables: Record<string, Row[]> = { team_members: [], patients: [], patient_contact_numbers: [] }
    const plan = await planPatients(setup(tables), snapshot())
    const result = await plan.apply(() => {}, () => true)
    expect(result.written).toBe(0)
    expect(tables.patients).toHaveLength(0)
  })

  it('says when new patients will have no clinic', async () => {
    const plan = await planPatients(setup({ team_members: [], patients: [], patient_contact_numbers: [] }, { clinicId: null }), snapshot())
    expect(plan.warnings.some((w) => w.includes('no primary clinic'))).toBe(true)
  })

  it('refuses a copy that never read /patients', async () => {
    await expect(planPatients(setup({}), { readAt: '', baseUrl: '', lists: { '/practitioners': [], '/referral_sources': [] } })).rejects.toThrow('/patients')
  })
})

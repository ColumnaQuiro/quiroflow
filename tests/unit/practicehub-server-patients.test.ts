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
import { practiceHubGovernmentNumbers, practiceHubPatientRows, practiceHubTagsByPatientNumber } from '../../utils/practicehubApiRows'

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
    date_of_birth: '1990-04-02', referral_source: null, preferred_language: 'es', marketing_channels: [], default_practitioner_id: null, default_practitioner_name: null,
    created_at: '2024-03-05T09:15:00+00:00', balance_cents: 0, photo_storage_path: null, national_id: null,
    address: null, postal_code: null, city: null, country: null, gender: null,
    preferred_name: null, status: 'active', do_not_contact: false, tags: [],
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

describe('the address', () => {
  // Every PracticeHub record carries one address entry, and its country is
  // set even when nothing else is: this is how they arrive.
  const phPatient = (address: Record<string, string | null>) => ({ id: 1, patient_number: '202400007', first_name: 'Lucía', last_name: 'Demo', address: [address] })
  const blankAddress = { address_one: '', address_two: '', address_three: '', city: '', county_state: '', postcode: '', country: 'ES' }
  const rowsFor = (address: Record<string, string | null>) => practiceHubPatientRows([phPatient(address)], { practitioners: [], referralSources: [] })

  it('goes onto a new patient, its lines joined, the country as a name', () => {
    const rows = rowsFor({ ...blankAddress, address_one: 'Calle Mayor 12', address_two: '3º B', postcode: '12540', city: 'Vila-real' })
    const [created] = practiceHubPatientsDiff(rows, [], diffOptions()).toImport
    expect(created.patient).toMatchObject({ address: 'Calle Mayor 12, 3º B', postal_code: '12540', city: 'Vila-real', country: 'España' })
  })

  it('leaves every field blank, country included, for a patient with no address', () => {
    const [created] = practiceHubPatientsDiff(rowsFor(blankAddress), [], diffOptions()).toImport
    expect(created.patient).toMatchObject({ address: null, postal_code: null, city: null, country: null })
    // A record with no address entry at all reads the same.
    const none = practiceHubPatientRows([{ id: 2, patient_number: '2', first_name: 'Iván', address: null }], { practitioners: [], referralSources: [] })
    expect(practiceHubPatientsDiff(none, [], diffOptions()).toImport[0].patient.country).toBeNull()
  })

  it('fills a patient imported before without one, and never blanks one with an empty PracticeHub field', () => {
    const filled = practiceHubPatientsDiff(rowsFor({ ...blankAddress, address_one: 'Calle Mayor 12', postcode: '12540', city: 'Vila-real' }), [existingPatient()], diffOptions())
    expect(filled.toUpdate[0].updates).toEqual({ address: 'Calle Mayor 12', postal_code: '12540', city: 'Vila-real', country: 'España' })

    const kept = practiceHubPatientsDiff(rowsFor({ ...blankAddress, address_one: 'Calle Nueva 1' }), [existingPatient({ address: 'Calle Mayor 12', postal_code: '12540', city: 'Vila-real', country: 'España' })], diffOptions())
    expect(kept.toUpdate[0].updates).toEqual({ address: 'Calle Nueva 1' })

    const nothing = practiceHubPatientsDiff(rowsFor(blankAddress), [existingPatient({ address: 'Calle Mayor 12' })], diffOptions())
    expect(nothing.toUpdate).toEqual([])
    expect(nothing.skippedDuplicate).toBe(1)
  })
})

describe('the sex', () => {
  const rowsFor = (sex: string | number | null) => practiceHubPatientRows([{ id: 1, patient_number: '202400007', first_name: 'Lucía', last_name: 'Demo', sex }], { practitioners: [], referralSources: [] })
  const genderOf = (sex: string | number | null) => practiceHubPatientsDiff(rowsFor(sex), [], diffOptions()).toImport[0].patient.gender

  it('reads PracticeHub Classic\'s codes as the words PracticeHub 2.0 gives the same patients', () => {
    expect(genderOf('1')).toBe('male')
    expect(genderOf('2')).toBe('female')
    expect(genderOf(3)).toBe('other')
  })

  it('leaves it blank when not given, or when it is a code nobody has seen', () => {
    expect(genderOf('0')).toBeNull()
    expect(genderOf(null)).toBeNull()
    expect(genderOf('9')).toBeNull()
  })

  it('fills a patient already here, and a blank in PracticeHub never clears one', () => {
    expect(practiceHubPatientsDiff(rowsFor('2'), [existingPatient()], diffOptions()).toUpdate[0].updates).toEqual({ gender: 'female' })
    expect(practiceHubPatientsDiff(rowsFor('0'), [existingPatient({ gender: 'female' })], diffOptions()).toUpdate).toEqual([])
  })
})

describe('archived and deceased patients', () => {
  const rowsFor = (patient_status: string | null) => practiceHubPatientRows([{ id: 1, patient_number: '202400007', first_name: 'Lucía', last_name: 'Demo', patient_status }], { practitioners: [], referralSources: [] })
  const created = (status: string | null) => practiceHubPatientsDiff(rowsFor(status), [], diffOptions()).toImport[0].patient
  const updated = (status: string | null, over: Partial<PracticeHubExistingPatient> = {}) => practiceHubPatientsDiff(rowsFor(status), [existingPatient(over)], diffOptions()).toUpdate[0]?.updates

  it('come in inactive, and a deceased one is never contacted', () => {
    expect(created('active')).toMatchObject({ status: 'active', do_not_contact: false })
    expect(created('archived')).toMatchObject({ status: 'inactive', do_not_contact: false })
    expect(created('Deceased')).toMatchObject({ status: 'inactive', do_not_contact: true })
    expect(created(null)).toMatchObject({ status: 'active', do_not_contact: false })
  })

  it('make an active patient here inactive, never the other way', () => {
    expect(updated('archived')).toEqual({ status: 'inactive' })
    expect(updated('deceased')).toEqual({ status: 'inactive', do_not_contact: true })
    // Made inactive here, or told not to be contacted: PracticeHub does not undo it.
    expect(updated('active', { status: 'inactive', do_not_contact: true })).toBeUndefined()
  })
})

describe('tags', () => {
  const rowsFor = (tags: string[]) => practiceHubPatientRows(
    [{ id: 1, patient_number: '202400007', first_name: 'Lucía', last_name: 'Demo' }],
    { practitioners: [], referralSources: [], tagsByPatientNumber: practiceHubTagsByPatientNumber([{ patient_number: 202400007, tags: tags.map((name) => ({ name })) }]) },
  )

  it('are read from PracticeHub 2.0 by patient number', () => {
    const map = practiceHubTagsByPatientNumber([{ patient_number: ' 7 ', tags: [{ name: ' VIP ' }, { name: '' }] }, { patient_number: '8', tags: [] }, { patient_number: null, tags: [{ name: 'x' }] }])
    expect([...map]).toEqual([['7', ['VIP']]])
    expect(practiceHubPatientsDiff(rowsFor(['VIP', '2X3 1X6']), [], diffOptions()).toImport[0].patient.tags).toEqual(['VIP', '2X3 1X6'])
  })

  it('are only ever added to a patient here, ignoring case', () => {
    const [u] = practiceHubPatientsDiff(rowsFor(['vip', 'Embarazo']), [existingPatient({ tags: ['VIP', 'Local'] })], diffOptions()).toUpdate
    expect(u.updates).toEqual({ tags: ['VIP', 'Local', 'Embarazo'] })
    // None new, and one only here: nothing to write.
    expect(practiceHubPatientsDiff(rowsFor(['VIP']), [existingPatient({ tags: ['VIP', 'Local'] })], diffOptions()).toUpdate).toEqual([])
  })
})

describe('the preferred name', () => {
  const rowsFor = (preferred_name: string | null) => practiceHubPatientRows([{ id: 1, patient_number: '202400007', first_name: 'José', last_name: 'Demo', preferred_name }], { practitioners: [], referralSources: [] })

  it('goes onto a new patient and fills or corrects one here, never blanking it', () => {
    expect(practiceHubPatientsDiff(rowsFor(' Pepe '), [], diffOptions()).toImport[0].patient.preferred_name).toBe('Pepe')
    expect(practiceHubPatientsDiff(rowsFor(''), [], diffOptions()).toImport[0].patient.preferred_name).toBeNull()
    expect(practiceHubPatientsDiff(rowsFor('Pepe'), [existingPatient({ first_name: 'José' })], diffOptions()).toUpdate[0].updates).toEqual({ preferred_name: 'Pepe' })
    expect(practiceHubPatientsDiff(rowsFor(null), [existingPatient({ first_name: 'José', preferred_name: 'Pepe' })], diffOptions()).toUpdate).toEqual([])
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

  // A clinic imports before its team joins. The name has to stay on the
  // patient, or the first colleague whose visits are linked takes every
  // patient they ever saw (20261127153025).
  it('keeps PracticeHub\'s practitioner by name while nobody on the team has it', () => {
    const d = practiceHubPatientsDiff([row({ 'Default Practitioner': ' Pablo Nuevo ' }), row({ 'Patient Number': '2', 'Email Address': '' })], [], diffOptions())
    expect(d.toImport[0]!.patient).toMatchObject({ default_practitioner_id: null, default_practitioner_name: 'Pablo Nuevo' })
    expect(d.toImport[1]!.patient).toMatchObject({ default_practitioner_id: null, default_practitioner_name: null })
  })

  it('puts back PracticeHub\'s practitioner over one filled here from a colleague\'s visits', () => {
    const here = [existingPatient({ default_practitioner_id: 'tm-2' })]
    const d = practiceHubPatientsDiff([row({ 'Default Practitioner': 'Marta Ruiz' })], here, diffOptions({
      practitionerFor: practiceHubPractitionerMatcher([{ id: 'tm-1', full_name: 'Marta Ruiz' }, { id: 'tm-2', full_name: 'Pablo Nuevo' }]),
    }))
    expect(d.toUpdate[0]!.updates).toEqual({ default_practitioner_id: 'tm-1', default_practitioner_name: 'Marta Ruiz' })
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

// PracticeHub keeps a Spanish patient's DNI/NIE in the "Social security
// number" box, which only its 2.0 API sends (government_number). A clinic
// arrived with none of its patients' because nothing read it.
describe('the DNI/NIE from PracticeHub 2.0', () => {
  const ph = [{ id: 501, patient_number: '202400007', first_name: 'Lucía', last_name: 'Demo' }, { id: 502, patient_number: '202400008', first_name: 'Pablo', last_name: 'Prueba' }]
  const rowsWith = (v3: { id: number | string; government_number?: string | null }[]) =>
    practiceHubPatientRows(ph, { practitioners: [], referralSources: [], governmentNumberById: practiceHubGovernmentNumbers(v3) })

  it('is matched by PracticeHub id, trimmed, and left out when blank', () => {
    expect([...practiceHubGovernmentNumbers([{ id: 501, government_number: ' X0000000T ' }, { id: '502', government_number: '  ' }, { id: 503, government_number: null }, { id: 504 }])])
      .toEqual([['501', 'X0000000T']])
    expect(rowsWith([{ id: '501', government_number: 'X0000000T' }]).map((r) => r['Government Number'])).toEqual(['X0000000T', ''])
  })

  it('goes onto a new patient, and only when it reads as an identity number', () => {
    const d = practiceHubPatientsDiff(rowsWith([{ id: 501, government_number: '00000000T' }, { id: 502, government_number: 'see the note on the file, renewed in 2025' }]), [], diffOptions())
    expect(d.toImport.map((c) => c.patient.national_id)).toEqual(['00000000T', null])
  })

  it('fills a blank one on a patient already here and never replaces one', () => {
    const rows = rowsWith([{ id: 501, government_number: '00000000T' }])
    const blankHere = practiceHubPatientsDiff(rows, [existingPatient({ email: null, national_id: ' ' })], diffOptions())
    expect(blankHere.toUpdate[0]!.updates).toEqual({ national_id: '00000000T' })
    expect(blankHere.toUpdate[0]!.diff).toEqual([{ field: 'national_id', from: ' ', to: '00000000T' }])
    const typedHere = practiceHubPatientsDiff(rows, [existingPatient({ email: null, national_id: 'Y1111111H' })], diffOptions())
    expect(typedHere.toUpdate).toEqual([])
  })

  it('leaves the DNI/NIE alone when PracticeHub has none', () => {
    const d = practiceHubPatientsDiff(rowsWith([]), [existingPatient({ email: null, national_id: 'Y1111111H' })], diffOptions())
    expect(d.toUpdate).toEqual([])
    expect(d.skippedDuplicate).toBe(1)
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

  it('brings the tags in the 2.0 copy, and asks for a key only when there is none', async () => {
    const tables: Record<string, Row[]> = { team_members: [], patients: [], patient_contact_numbers: [] }
    const withV3 = { ...snapshot(), lists: { ...snapshot().lists, '/v3/patients': [{ id: 501, patient_number: '202400007', tags: [{ name: 'VIP' }] }] } }
    const plan = await planPatients(setup(tables), withV3)
    expect(plan.warnings.some((w) => w.includes('Tags'))).toBe(false)
    await plan.apply(() => {}, () => false)
    expect(tables.patients!.find((p) => p.external_reference === '202400007')?.tags).toEqual(['VIP'])

    const without = await planPatients(setup({ team_members: [], patients: [], patient_contact_numbers: [] }), snapshot())
    expect(without.warnings.some((w) => w.startsWith('Tags and the DNI/NIE'))).toBe(true)
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

  it('brings the DNI/NIE from the 2.0 list in the copy, and says when the copy has none', async () => {
    const tables: Record<string, Row[]> = {
      team_members: [{ id: 'tm-1', account_id: ACCOUNT, full_name: 'Marta Ruiz' }],
      patients: [{ ...existingPatient({ id: 'p1', balance_cents: -4500, preferred_language: 'fr', default_practitioner_id: 'tm-1', default_practitioner_name: 'Marta Ruiz', referral_source: 'Google' }), account_id: ACCOUNT }],
      patient_contact_numbers: [
        { id: 'n1', account_id: ACCOUNT, patient_id: 'p1', number: '600112233' }, { id: 'n2', account_id: ACCOUNT, patient_id: 'p1', number: '3037105245' },
        { id: 'n3', account_id: ACCOUNT, patient_id: 'p1', number: '700000000' },
      ],
    }
    const ctx = setup(tables)
    const without = await planPatients(ctx, snapshot())
    expect(without.warnings.some((w) => w.includes('DNI/NIE'))).toBe(true)
    expect(without.rows.map((r) => r.name)).toEqual(['Pablo Prueba'])

    const withV3 = { ...snapshot(), lists: { ...snapshot().lists, '/v3/patients': [{ id: 501, government_number: 'X0000000T' }, { id: 502, government_number: '00000000T' }] } }
    const plan = await planPatients(ctx, withV3)
    expect(plan.warnings.some((w) => w.includes('DNI/NIE'))).toBe(false)
    expect(plan.rows.find((r) => r.name === 'Lucía Demo')!.what).toBe('DNI / NIE: (blank) → X0000000T')
    await plan.apply(() => {}, () => false)
    expect(tables.patients!.map((p) => p.national_id)).toEqual(['X0000000T', '00000000T'])
    // Nothing else on the patient already here was touched, and nothing is left to do.
    expect(tables.patients![0]).toMatchObject({ balance_cents: -4500, email: 'lucia@example.test', last_name: 'Demo' })
    expect((await planPatients(ctx, withV3)).total).toBe(0)
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

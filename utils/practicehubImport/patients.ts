import type { TablesInsert, TablesUpdate } from '~/types/database.types'
import { formatEur } from '~/utils/billing'
import { countryByCode } from '~/utils/countries'
import { nationalIdAnswer } from '~/utils/docFields'
import { LANGUAGES } from '~/utils/languages'
import { practiceHubGovernmentNumbers, practiceHubPatientNumberMap, practiceHubPatientRows, practiceHubTagsByPatientNumber, practiceHubUtc, type PHApiPatient, type PHNamed, type PHV3Patient } from '~/utils/practicehubApiRows'
import { practiceHubList, type PracticeHubPlan, type PracticeHubStepPlanner } from '~/utils/practicehubImport/types'

// The Patients step of the PracticeHub import: who to create, who to update
// and with what, worked out from PracticeHub's /patients against the patients
// already here.
//
// Two callers share the rules below, so there is one copy of them: the
// browser screen (components/import/PracticeHubPatientsImporter.vue), which
// still reads a CSV export or the API itself and writes as the signed-in
// user, and `planPatients` at the bottom, which plans from the copy a server
// job read (see ./types.ts) and writes with the service role.
//
// Every other step matches its records to a patient by the reference stored
// here, so this one runs first.

type T = (en: string, es: string) => string
type CsvRow = Record<string, string>

export type PracticeHubContactNumber = { country_code: string; number: string; is_whatsapp: boolean }

// Fields PracticeHub owns for the duration of the migration -- on a
// re-import matching an existing patient, these get overwritten
// unconditionally (confirmed with the clinic: PracticeHub stays the source
// of truth right up to cutover, even though several of these are also
// editable from the patient's own QuiroFlow screen).
// `created_at` is deliberately not in this list -- it's handled separately
// in practiceHubPatientUpdate using the *unfallen-back* parsed value, since
// `patient.created_at` always has a value (defaulting to "now" for rows
// with no CSV "Created" date, to satisfy the NOT NULL column on insert)
// and treating that default as a real change would flag every row missing
// a Created date as "created_at will change to right now" on every re-run.
export const PRACTICEHUB_PATIENT_OVERWRITE_FIELDS = [
  'first_name',
  'last_name',
  'email',
  'date_of_birth',
  'referral_source',
  'preferred_language',
  'marketing_channels',
  'default_practitioner_id',
  'balance_cents',
  // Each part on its own, so a PracticeHub address with no postcode keeps
  // the one already here rather than blanking it.
  'address',
  'postal_code',
  'city',
  'country',
  'gender',
  'preferred_name',
] as const

export interface PracticeHubExistingPatient {
  id: string
  external_reference: string | null
  email: string | null
  first_name: string
  last_name: string | null
  date_of_birth: string | null
  referral_source: string | null
  preferred_language: string
  marketing_channels: string[] | null
  default_practitioner_id: string | null
  created_at: string
  balance_cents: number
  photo_storage_path: string | null
  national_id: string | null
  address: string | null
  postal_code: string | null
  city: string | null
  country: string | null
  gender: string | null
  preferred_name: string | null
  status: string
  do_not_contact: boolean
  tags: string[] | null
}

export const PRACTICEHUB_EXISTING_PATIENT_COLUMNS =
  'id, external_reference, email, first_name, last_name, date_of_birth, referral_source, preferred_language, marketing_channels, default_practitioner_id, created_at, balance_cents, photo_storage_path, national_id, address, postal_code, city, country, gender, preferred_name, status, do_not_contact, tags'

export interface PracticeHubFieldDiff { field: string; from: string; to: string }

export interface PracticeHubPatientToCreate {
  patient: TablesInsert<'patients'>
  numbers: PracticeHubContactNumber[]
  sourceRow: number
}

export interface PracticeHubPatientToUpdate {
  id: string
  label: string
  updates: TablesUpdate<'patients'>
  diff: PracticeHubFieldDiff[]
  numbers: PracticeHubContactNumber[]
  sourceRow: number
}

// --- Phone countries ------------------------------------------------------------
//
// The CSV export carries "Mobile" and "Home" as bare strings with no
// country. PracticeHub itself knows better -- its /patients API returns each
// number with an `iso2` -- and that is the only place the country exists, so
// the import reads it from there and falls back to the account's own country
// only for numbers it cannot find.
//
// Getting this wrong is not cosmetic. Every imported number was stored
// against 'ES', so a US patient's "(303) 710-5245" rendered as
// "+34 (303) 710-5245" and any WhatsApp sent to it would have gone to a
// Spanish number instead. On the first live migration that was 90 numbers
// across 16 countries.

export function practiceHubNumberCountryKey(patientNumber: string, number: string) {
  return `${patientNumber.trim()}|${number.trim()}`
}

/** Each number's country as PracticeHub's /patients gives it, keyed by practiceHubNumberCountryKey. */
export function practiceHubNumberCountries(patients: PHApiPatient[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const p of patients) {
    const ref = String(p.patient_number ?? '').trim()
    if (!ref) continue
    for (const n of p.numbers ?? []) {
      const num = (n?.number ?? '').trim()
      const iso = (n?.iso2 ?? '').trim().toUpperCase()
      if (num && iso) map.set(practiceHubNumberCountryKey(ref, num), iso)
    }
  }
  return map
}

// --- One row's fields -------------------------------------------------------------

export function practiceHubBalanceCents(value: string): number {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return 0
  // PracticeHub's export has this inverted relative to our convention:
  // a positive "Account Balance" there means the patient owes money (DR),
  // negative means they're in credit (CR). We store positive = credit,
  // negative = owed (verified against live PracticeHub data for several
  // real patients), so flip the sign on the way in.
  return -Math.round(n * 100)
}

export function practiceHubLanguage(value: string): string {
  const code = value.trim().toLowerCase()
  return LANGUAGES.some((l) => l.code === code) ? code : 'es'
}

// Without this, every migrated patient's created_at defaults to the moment
// of import (now()) instead of when they actually joined the practice --
// tenure-based reports and "new patient" filters are wrong for the entire
// migrated patient base. The export calls the column "Patient Created" and
// this read "Created", so that is exactly what happened: all 1,529 of
// Columnaquiro's imported patients carry an import day as their join date.
// PracticeHub writes it in UTC with no zone.
export function practiceHubCreatedAt(row: CsvRow): string | undefined {
  return practiceHubUtc(row['Patient Created'] || row['Created']) || undefined
}

export function practiceHubPatientNotes(row: CsvRow): string | null {
  const parts = [row['Note'], row['Chief Complaint']].map((s) => s?.trim()).filter(Boolean)
  return parts.length > 0 ? parts.join('\n\n---\n\n') : null
}

/** Archived or deceased in PracticeHub. */
export function practiceHubIsInactive(row: CsvRow): boolean {
  const status = (row['Status'] ?? '').trim().toLowerCase()
  return status === 'archived' || status === 'deceased'
}

export function practiceHubMarketingChannels(row: CsvRow): string[] {
  const channels: string[] = []
  if (row['SMS Marketing'] === '1') channels.push('sms')
  if (row['Email Marketing'] === '1') channels.push('email')
  if (row['Other Marketing'] === '1') channels.push('other')
  return channels
}

/** Matches a PracticeHub practitioner's name to a team member, ignoring case and outer spaces. */
export function practiceHubPractitionerMatcher(members: { id: string; full_name: string }[]) {
  return (name: string): string | null => {
    const clean = name.trim().toLowerCase()
    if (!clean) return null
    const match = members.find((m) => m.full_name.trim().toLowerCase() === clean)
    return match?.id ?? null
  }
}

// --- How a change is shown --------------------------------------------------------

export function practiceHubBlank(value: unknown, t: T): string {
  if (value === null || value === undefined || value === '') return t('(blank)', '(vacío)')
  if (Array.isArray(value)) return value.length ? value.join(', ') : t('(blank)', '(vacío)')
  return String(value)
}

// The preview of changes to existing patients names each field the way the
// patient record does, not by its database column ("default_practitioner_id"),
// and shows the value a person would recognise: the practitioner's name, not
// their id; euros, not cents; the language, not its code.
export function practiceHubPatientFieldLabel(field: string, t: T): string {
  switch (field) {
    case 'first_name': return t('First name', 'Nombre')
    case 'last_name': return t('Last name', 'Apellidos')
    case 'email': return t('Email', 'Correo electrónico')
    case 'date_of_birth': return t('Date of birth', 'Fecha de nacimiento')
    case 'referral_source': return t('Referral source', 'Fuente de referencia')
    case 'preferred_language': return t('Language', 'Idioma')
    case 'marketing_channels': return t('Marketing consent', 'Consentimiento de marketing')
    case 'default_practitioner_id': return t('Usual practitioner', 'Profesional habitual')
    case 'balance_cents': return t('Balance', 'Saldo')
    case 'created_at': return t('Patient since', 'Paciente desde')
    case 'external_reference': return t('PracticeHub reference', 'Referencia de PracticeHub')
    case 'national_id': return 'DNI / NIE'
    case 'address': return t('Address', 'Dirección')
    case 'postal_code': return t('Postal code', 'Código postal')
    case 'city': return t('City', 'Ciudad')
    case 'country': return t('Country', 'País')
    case 'gender': return t('Sex', 'Sexo')
    case 'preferred_name': return t('Preferred name', 'Nombre preferido')
    case 'status': return t('Status', 'Estado')
    case 'do_not_contact': return t('Do not contact', 'No contactar')
    case 'tags': return t('Tags', 'Etiquetas')
    case 'phone': return t('Phone', 'Teléfono')
    default: return field
  }
}

export function practiceHubLanguageLabel(code: string | null | undefined): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code ?? ''
}

export function practiceHubShownValue(field: string, value: unknown, t: T, practitionerName: (id: unknown) => string | undefined): string {
  if (value === null || value === undefined || value === '') return practiceHubBlank(value, t)
  if (field === 'default_practitioner_id') return practitionerName(value) ?? practiceHubBlank(value, t)
  if (field === 'balance_cents' && typeof value === 'number') return formatEur(value)
  if (field === 'preferred_language' && typeof value === 'string') return practiceHubLanguageLabel(value)
  if (field === 'gender' && value === 'female') return t('Female', 'Mujer')
  if (field === 'gender' && value === 'male') return t('Male', 'Hombre')
  if (field === 'gender' && value === 'other') return t('Other', 'Otro')
  if (field === 'status' && value === 'active') return t('Active', 'Activo')
  if (field === 'status' && value === 'inactive') return t('Inactive', 'Inactivo')
  if (field === 'do_not_contact' && typeof value === 'boolean') return value ? t('Yes', 'Sí') : t('No', 'No')
  if (field === 'created_at' && typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toLocaleDateString('es-ES')
  return practiceHubBlank(value, t)
}

export function practiceHubValuesDiffer(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify([...a].sort()) !== JSON.stringify([...b].sort())
  return a !== b
}

// --- Create or update -------------------------------------------------------------

// Builds the update payload for a patient that already exists in QuiroFlow
// (matched by external_reference or email). Only overwrites a field when the
// incoming value is actually present -- a blank cell in this export should
// never erase a value the patient already has.
export function practiceHubPatientUpdate(
  existing: PracticeHubExistingPatient,
  incoming: TablesInsert<'patients'>,
  externalRef: string,
  fileRef: string,
  realCreatedAt: string | undefined,
  show: (field: string, value: unknown) => string,
  blank: (value: unknown) => string,
) {
  const updates: TablesUpdate<'patients'> = {}
  const diff: PracticeHubFieldDiff[] = []

  for (const field of PRACTICEHUB_PATIENT_OVERWRITE_FIELDS) {
    const value = incoming[field]
    if (value === null || value === undefined) continue
    if (typeof value === 'string' && value === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    const existingValue = existing[field]
    if (practiceHubValuesDiffer(value, existingValue)) {
      ;(updates as Record<string, unknown>)[field] = value
      diff.push({ field, from: show(field, existingValue), to: show(field, value) })
    }
  }

  // Compared as instants: Postgres hands back "…+00:00" and the parsed value
  // is "…Z", so a string comparison flagged every patient on every re-run.
  if (realCreatedAt && new Date(realCreatedAt).getTime() !== new Date(existing.created_at).getTime()) {
    updates.created_at = realCreatedAt
    diff.push({ field: 'created_at', from: show('created_at', existing.created_at), to: show('created_at', realCreatedAt) })
  }

  // Archived or deceased in PracticeHub makes an active patient inactive, as
  // archiving one here does. Never the other way: a patient made inactive
  // here stays so, whatever PracticeHub says.
  if (incoming.status === 'inactive' && existing.status !== 'inactive') {
    updates.status = 'inactive'
    diff.push({ field: 'status', from: show('status', existing.status), to: show('status', 'inactive') })
  }
  // Likewise one-way: nothing PracticeHub says lets a patient be contacted again.
  if (incoming.do_not_contact === true && !existing.do_not_contact) {
    updates.do_not_contact = true
    diff.push({ field: 'do_not_contact', from: show('do_not_contact', false), to: show('do_not_contact', true) })
  }

  // Tags are only ever added. One the clinic removed or added here stays as
  // it is, and the same tag in different case is not a second one -- the
  // same comparison the patients_tags trigger makes.
  const tagsHere = existing.tags ?? []
  const seen = new Set(tagsHere.map((tag) => tag.trim().toLowerCase()))
  const newTags = (incoming.tags ?? []).filter((tag) => {
    const key = tag.trim().toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (newTags.length) {
    updates.tags = [...tagsHere, ...newTags]
    diff.push({ field: 'tags', from: blank(tagsHere), to: updates.tags.join(', ') })
  }

  // The DNI/NIE is not PracticeHub's to overwrite: it only fills a blank one.
  // One already on the profile was typed here or came from a signed form,
  // and it is what the patient's facturas carry.
  if (incoming.national_id && !existing.national_id?.trim()) {
    updates.national_id = incoming.national_id
    diff.push({ field: 'national_id', from: blank(existing.national_id), to: incoming.national_id })
  }

  // A patient matched by email only (e.g. created directly in QuiroFlow)
  // won't have this set yet -- backfill it so future re-syncs match by ref.
  // One stored under their custom reference gets their patient number, so
  // the later steps find them.
  const misreferenced = existing.external_reference === fileRef && fileRef !== externalRef
  if (externalRef && (!existing.external_reference || misreferenced)) {
    updates.external_reference = externalRef
    diff.push({ field: 'external_reference', from: blank(existing.external_reference), to: externalRef })
  }

  return { updates, diff }
}

export interface PracticeHubPatientsDiffOptions {
  accountId: string
  /** The clinic new patients go into, or null for none. */
  clinicId: string | null
  /** The patient number a row's "Patient Number" stands for (it is a custom reference for some). */
  externalRefFor: (fileRef: string) => string
  /** A number's country: what PracticeHub says, or the account's own. */
  countryFor: (patientNumber: string, number: string) => string
  practitionerFor: (name: string) => string | null
  show: (field: string, value: unknown) => string
  blank: (value: unknown) => string
}

export interface PracticeHubPatientsDiff {
  toImport: PracticeHubPatientToCreate[]
  /** Matched patients with a change or a number to compare. Numbers they already have are not filtered yet: see practiceHubOnlyNewNumbers. */
  toUpdate: PracticeHubPatientToUpdate[]
  skippedDuplicate: number
  skippedDeleted: number
  skippedNoName: number
  // PracticeHub practitioners named as a patient's default who are not on this
  // clinic's team yet. A new clinic imports before inviting anyone, so without
  // this every default practitioner is silently dropped; adding them under Team
  // and reading again fills them in.
  unmatchedPractitioners: { name: string; patients: number }[]
}

/** What each row (in the CSV export's shape) does against the patients already here. */
export function practiceHubPatientsDiff(rows: CsvRow[], existingPatients: PracticeHubExistingPatient[], opts: PracticeHubPatientsDiffOptions): PracticeHubPatientsDiff {
  const byRef = new Map<string, PracticeHubExistingPatient>()
  const byEmail = new Map<string, PracticeHubExistingPatient>()
  for (const row of existingPatients) {
    if (row.external_reference) byRef.set(row.external_reference, row)
    if (row.email) byEmail.set(row.email.toLowerCase(), row)
  }

  const out: PracticeHubPatientsDiff = { toImport: [], toUpdate: [], skippedDuplicate: 0, skippedDeleted: 0, skippedNoName: 0, unmatchedPractitioners: [] }
  const unmatched = new Map<string, number>()

  rows.forEach((row, index) => {
    if ((row['Deleted'] || '').trim().toUpperCase() === 'TRUE') {
      out.skippedDeleted++
      return
    }

    const firstName = row['First Name']?.trim() || row['Last Name']?.trim() || ''
    if (!firstName) {
      out.skippedNoName++
      return
    }

    const email = row['Email Address']?.trim() || ''
    const fileRef = row['Patient Number']?.trim() || ''
    const externalRef = opts.externalRefFor(fileRef)
    // Also by the reference as the file gave it: a patient imported earlier
    // under their custom reference is the same patient, not a new one.
    const existing = (externalRef && byRef.get(externalRef)) || (fileRef && byRef.get(fileRef)) || (email && byEmail.get(email.toLowerCase())) || undefined

    const numbers: PracticeHubContactNumber[] = []
    const mobile = row['Mobile']?.trim()
    const home = row['Home']?.trim()
    if (mobile) numbers.push({ country_code: opts.countryFor(externalRef, mobile), number: mobile, is_whatsapp: false })
    if (home) numbers.push({ country_code: opts.countryFor(externalRef, home), number: home, is_whatsapp: false })
    for (const other of (row['Other Numbers'] ?? '').split('\n').map((n) => n.trim()).filter(Boolean)) {
      numbers.push({ country_code: opts.countryFor(externalRef, other), number: other, is_whatsapp: false })
    }

    const practitionerName = row['Default Practitioner']?.trim() || ''
    if (practitionerName && !opts.practitionerFor(practitionerName)) {
      unmatched.set(practitionerName, (unmatched.get(practitionerName) ?? 0) + 1)
    }

    const realCreatedAt = practiceHubCreatedAt(row)
    const patient: TablesInsert<'patients'> = {
      account_id: opts.accountId,
      clinic_id: opts.clinicId || null,
      first_name: firstName,
      last_name: row['First Name']?.trim() ? row['Last Name']?.trim() || null : null,
      email: email || null,
      date_of_birth: row['Date of Birth']?.trim() || null,
      // Explicit fallback rather than an `undefined` value -- a bulk
      // insert's request body doesn't reliably strip an `undefined`-valued
      // key the way a single-object insert would, and a NULL landing on
      // this NOT NULL column fails the whole batch's insert. Only used for
      // new rows -- practiceHubPatientUpdate uses `realCreatedAt` directly so
      // this fallback never gets treated as a real change on an update.
      created_at: realCreatedAt ?? new Date().toISOString(),
      balance_cents: practiceHubBalanceCents(row['Account Balance'] || '0'),
      tags: (row['Tags'] ?? '').split(',').map((tag) => tag.trim()).filter(Boolean),
      referral_source: row['Referral Source']?.trim() || null,
      preferred_language: practiceHubLanguage(row['Preferred Language'] || ''),
      notes: practiceHubPatientNotes(row),
      external_reference: externalRef || null,
      // PracticeHub's "Social security number", held to the same rule as a
      // DNI typed into a form here. Always a key, null when there is none:
      // see created_at above on why a bulk insert must not carry undefined.
      national_id: nationalIdAnswer(row['Government Number']),
      marketing_channels: practiceHubMarketingChannels(row),
      default_practitioner_id: opts.practitionerFor(row['Default Practitioner'] || ''),
      // Every row carries these keys, null when blank: see created_at above.
      address: row['Address']?.trim() || null,
      postal_code: row['Postcode']?.trim() || null,
      city: row['City']?.trim() || null,
      country: row['Country']?.trim() || null,
      // Only one of the three values the column's check allows: anything else
      // would fail the whole batch's insert, so it is left blank instead.
      gender: ['female', 'male', 'other'].includes(row['Sex']?.trim() ?? '') ? row['Sex']!.trim() : null,
      preferred_name: row['Preferred Name']?.trim() || null,
      // Archived and deceased patients come in inactive, as archiving one
      // here would leave them, so they stay out of recalls and campaigns.
      status: practiceHubIsInactive(row) ? 'inactive' : 'active',
      do_not_contact: (row['Status'] ?? '').trim().toLowerCase() === 'deceased',
    }

    if (!existing) {
      out.toImport.push({ sourceRow: index + 2, patient, numbers })
      return
    }

    const { updates: fieldUpdates, diff } = practiceHubPatientUpdate(existing, patient, externalRef, fileRef, realCreatedAt, opts.show, opts.blank)
    // Kept even with no field changes while it carries numbers: one of them
    // may be new, which is only known once they are compared
    // (practiceHubOnlyNewNumbers).
    if (Object.keys(fieldUpdates).length === 0 && numbers.length === 0) {
      out.skippedDuplicate++
      return
    }
    out.toUpdate.push({
      id: existing.id,
      label: `${patient.first_name} ${patient.last_name ?? ''}`.trim(),
      updates: fieldUpdates,
      diff,
      numbers,
      sourceRow: index + 2,
    })
  })

  out.unmatchedPractitioners = [...unmatched].map(([name, patients]) => ({ name, patients })).sort((a, b) => b.patients - a.patients)
  return out
}

// Contact numbers are additive-only on an update -- never touch a number
// the patient already has, only add ones this row carries that aren't
// already on file (normalized so formatting differences don't cause dupes).
// Mutates `updates` in place, and returns those left with something to write
// and how many turned out to have nothing.
export function practiceHubOnlyNewNumbers(
  updates: PracticeHubPatientToUpdate[],
  numbersHere: { patient_id: string; number: string }[],
  t: T,
): { changed: PracticeHubPatientToUpdate[]; unchanged: number } {
  const existingNumbersByPatient = new Map<string, Set<string>>()
  for (const n of numbersHere) {
    const set = existingNumbersByPatient.get(n.patient_id) ?? new Set<string>()
    set.add(n.number.replace(/\D/g, ''))
    existingNumbersByPatient.set(n.patient_id, set)
  }
  for (const u of updates) {
    const existingSet = existingNumbersByPatient.get(u.id) ?? new Set<string>()
    u.numbers = u.numbers.filter((n) => !existingSet.has(n.number.replace(/\D/g, '')))
    for (const n of u.numbers) u.diff.push({ field: 'phone', from: t('(new)', '(nuevo)'), to: n.number })
  }
  const changed = updates.filter((u) => Object.keys(u.updates).length > 0 || u.numbers.length > 0)
  return { changed, unchanged: updates.length - changed.length }
}

// --- The server step ----------------------------------------------------------------

const PAGE = 1000
const ID_CHUNK = 200
const INSERT_CHUNK = 100
const UPDATE_CHUNK = 100
const CONCURRENCY = 8

async function withConcurrency<I>(items: I[], n: number, run: (item: I) => Promise<void>) {
  let index = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (index < items.length) await run(items[index++]!)
  }))
}

export const planPatients: PracticeHubStepPlanner = async (ctx, snapshot): Promise<PracticeHubPlan> => {
  const { supabase, accountId, t } = ctx
  const nf = new Intl.NumberFormat('es-ES')

  const phPatients = practiceHubList<PHApiPatient>(snapshot, '/patients')
  const practitioners = practiceHubList<PHNamed>(snapshot, '/practitioners')
  const referralSources = practiceHubList<PHNamed>(snapshot, '/referral_sources')
  // Tags are only in PracticeHub 2.0's /patients, like the DNI/NIE below.
  // The DNI/NIE is only in 2.0's /patients, which the read copies when the
  // clinic has saved a 2.0 key. Without one the list is not in the copy, the
  // patients arrive without it, and the plan says so below.
  const v3Patients = snapshot.lists['/v3/patients'] as PHV3Patient[] | undefined
  const rows = practiceHubPatientRows(phPatients, {
    practitioners,
    referralSources,
    tagsByPatientNumber: practiceHubTagsByPatientNumber(v3Patients ?? []),
    governmentNumberById: practiceHubGovernmentNumbers(v3Patients ?? []),
  })
  const numberCountries = practiceHubNumberCountries(phPatients)
  // The CSV's "Patient Number" holds a custom reference (DNI, passport) for
  // the patients who have one; the API rows already carry the real number,
  // but a patient imported earlier from the CSV may be stored under the
  // custom one, and is found and corrected through this.
  const patientNumberFor = practiceHubPatientNumberMap(phPatients)
  // The fallback for a number PracticeHub's API didn't answer for. The
  // account's own country, not Spain's -- a clinic in Lisbon should get
  // Portuguese numbers, not the bug this replaced.
  const defaultCountry = ctx.defaultPhoneCountry
  const countryFor = (patientNumber: string, number: string) => numberCountries.get(practiceHubNumberCountryKey(patientNumber, number)) ?? defaultCountry

  const { data: team, error: teamError } = await supabase.from('team_members').select('id, full_name').eq('account_id', accountId)
  if (teamError) throw new Error(`team_members: ${teamError.message}`)
  const members = team ?? []
  const practitionerFor = practiceHubPractitionerMatcher(members)
  const show = (field: string, value: unknown) => practiceHubShownValue(field, value, t, (id) => members.find((m) => m.id === id)?.full_name)
  const blank = (value: unknown) => practiceHubBlank(value, t)

  // Every patient of this account, a page at a time: PostgREST stops at 1,000
  // rows without saying so. A failed page throws rather than planning against
  // half the patients, which would create the other half again.
  const existing: PracticeHubExistingPatient[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('patients')
      .select(PRACTICEHUB_EXISTING_PATIENT_COLUMNS)
      .eq('account_id', accountId)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`patients: ${error.message}`)
    existing.push(...((data ?? []) as unknown as PracticeHubExistingPatient[]))
    if (!data || data.length < PAGE) break
  }

  const diff = practiceHubPatientsDiff(rows, existing, {
    accountId,
    clinicId: ctx.clinicId,
    externalRefFor: (ref) => patientNumberFor.get(ref) ?? ref,
    countryFor,
    practitionerFor,
    show,
    blank,
  })

  const numbersHere: { patient_id: string; number: string }[] = []
  const matchedIds = diff.toUpdate.map((u) => u.id)
  for (let i = 0; i < matchedIds.length; i += ID_CHUNK) {
    const ids = matchedIds.slice(i, i + ID_CHUNK)
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('patient_contact_numbers')
        .select('patient_id, number')
        .eq('account_id', accountId)
        .in('patient_id', ids)
        .order('id')
        .range(from, from + PAGE - 1)
      if (error) throw new Error(`patient_contact_numbers: ${error.message}`)
      numbersHere.push(...(data ?? []))
      if (!data || data.length < PAGE) break
    }
  }
  const { changed, unchanged } = practiceHubOnlyNewNumbers(diff.toUpdate, numbersHere, t)
  const toImport = diff.toImport
  const skippedDuplicate = diff.skippedDuplicate + unchanged

  // How many of the numbers about to be written are foreign. Worth showing:
  // it is the difference between this import and the one that made every
  // patient Spanish, and it is a number the clinic can sanity-check.
  const foreignNumbers = [...toImport, ...changed].reduce((total, row) => total + row.numbers.filter((n) => n.country_code !== defaultCountry).length, 0)
  const defaultCountryName = countryByCode(defaultCountry).name

  // Profile photos are a step of their own (photos.ts), run later in the same
  // sync from a fresh read of PracticeHub's links: the ones in this copy are
  // signed and expire within the hour.

  const unmatched = diff.unmatchedPractitioners
  const warnings = [
    ...(unmatched.length ? [t(
      `Not on your team yet, so these patients get no default practitioner: ${unmatched.map((p) => `${p.name} (${p.patients})`).join(', ')}. Add them under Settings → Team with the same name and read again.`,
      `Aún no están en tu equipo, así que estos pacientes quedan sin profesional habitual: ${unmatched.map((p) => `${p.name} (${p.patients})`).join(', ')}. Añádelos en Ajustes → Equipo con el mismo nombre y vuelve a leer.`,
    )] : []),
    ...(v3Patients ? [] : [t(
      'Tags and the DNI/NIE (PracticeHub’s "Social security number") are only in the PracticeHub API. Save a PracticeHub API key in Settings > Import > Connection and read again to bring them.',
      'Las etiquetas y el DNI/NIE (el «Número de la seguridad social» de PracticeHub) solo están en la PracticeHub API. Guarda una clave de la PracticeHub API en Ajustes > Importar > Conexión y vuelve a leer para traerlos.',
    )]),
    // A patient with no clinic is invisible on the main Patients list once
    // its clinic filter applies, with no error anywhere.
    ...(!ctx.clinicId && toImport.length ? [t(
      `${nf.format(toImport.length)} new patients will have no primary clinic. Choose a clinic in the clinic switcher in the sidebar first to put them in one.`,
      `${nf.format(toImport.length)} pacientes nuevos quedarán sin clínica principal. Elige antes una clínica en el selector de la barra lateral para asignársela.`,
    )] : []),
  ]

  const fieldLabel = (field: string) => practiceHubPatientFieldLabel(field, t)
  const nameOf = (p: TablesInsert<'patients'>) => `${p.first_name} ${p.last_name ?? ''}`.trim()

  return {
    stats: [
      { label: t('Patients in PracticeHub', 'Pacientes en PracticeHub'), value: nf.format(rows.length) },
      { label: t('Will import', 'Se importarán'), value: nf.format(toImport.length), tone: 'good' },
      { label: t('Will update', 'Se actualizarán'), value: nf.format(changed.length), tone: 'good' },
      { label: t('No changes', 'Sin cambios'), value: nf.format(skippedDuplicate) },
      { label: t('Skipped (deleted or no name)', 'Omitidos (borrados o sin nombre)'), value: nf.format(diff.skippedDeleted + diff.skippedNoName) },
      { label: t(`Numbers outside ${defaultCountryName}`, `Números fuera de ${defaultCountryName}`), value: nf.format(foreignNumbers) },
    ],
    columns: [{ key: 'name', label: t('Patient', 'Paciente') }, { key: 'what', label: t('Change', 'Cambio'), wrap: true }],
    rows: [
      ...toImport.map((c) => ({
        name: nameOf(c.patient),
        what: [
          t('New', 'Nuevo'),
          c.patient.email,
          formatEur(c.patient.balance_cents ?? 0),
          practiceHubLanguageLabel(c.patient.preferred_language),
          (c.patient.tags ?? []).join(', '),
          c.numbers.map((n) => n.number).join(', '),
        ].filter(Boolean).join(' · '),
      })),
      ...changed.map((u) => ({ name: u.label, what: u.diff.map((d) => `${fieldLabel(d.field)}: ${d.from} → ${d.to}`).join('\n') })),
    ],
    warnings,
    total: toImport.length + changed.length,
    async apply(progress, shouldStop) {
      const errors: string[] = []
      let written = 0
      let done = 0

      for (let i = 0; i < toImport.length; i += INSERT_CHUNK) {
        if (shouldStop()) return { written, errors }
        const chunk = toImport.slice(i, i + INSERT_CHUNK)
        const span = `${nameOf(chunk[0]!.patient)} … ${nameOf(chunk[chunk.length - 1]!.patient)}`
        const { data: inserted, error } = await supabase.from('patients').insert(chunk.map((c) => c.patient)).select('id')
        if (error) {
          errors.push(t(`Patients ${span} were not imported: ${error.message}`, `Los pacientes ${span} no se importaron: ${error.message}`))
        } else {
          written += inserted.length
          // The inserted rows come back in the order they were sent.
          const numberRows = chunk.flatMap((c, idx) =>
            inserted[idx]
              ? c.numbers.map((n) => ({ account_id: accountId, patient_id: inserted[idx]!.id, country_code: n.country_code, number: n.number, is_whatsapp: n.is_whatsapp }))
              : [],
          )
          if (numberRows.length > 0) {
            const { error: numbersError } = await supabase.from('patient_contact_numbers').insert(numberRows)
            if (numbersError) errors.push(t(`Phone numbers for patients ${span} were not saved: ${numbersError.message}`, `No se guardaron los teléfonos de los pacientes ${span}: ${numbersError.message}`))
          }
        }
        done += chunk.length
        progress(done)
      }

      for (let i = 0; i < changed.length; i += UPDATE_CHUNK) {
        if (shouldStop()) break
        await withConcurrency(changed.slice(i, i + UPDATE_CHUNK), CONCURRENCY, async (row) => {
          if (shouldStop()) return
          // A row that only brings a new number has nothing to update.
          const { error } = Object.keys(row.updates).length > 0
            ? await supabase.from('patients').update(row.updates).eq('id', row.id).eq('account_id', accountId)
            : { error: null }
          if (error) {
            errors.push(t(`${row.label} was not updated: ${error.message}`, `${row.label} no se actualizó: ${error.message}`))
          } else {
            written++
            if (row.numbers.length > 0) {
              const { error: numbersError } = await supabase.from('patient_contact_numbers').insert(
                row.numbers.map((n) => ({ account_id: accountId, patient_id: row.id, country_code: n.country_code, number: n.number, is_whatsapp: n.is_whatsapp })),
              )
              if (numbersError) errors.push(t(`Phone numbers for ${row.label} were not saved: ${numbersError.message}`, `No se guardaron los teléfonos de ${row.label}: ${numbersError.message}`))
            }
          }
          progress(++done)
        })
      }

      return { written, errors }
    },
  }
}

<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import Papa from 'papaparse'
import type { TablesInsert, TablesUpdate } from '~/types/database.types'
import { practiceHubPatientNumberMap, practiceHubPatientRows, practiceHubUtc, type PHApiPatient, type PHNamed } from '~/utils/practicehubApiRows'

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

// The CSV export carries "Mobile" and "Home" as bare strings with no
// country. PracticeHub itself knows better -- its /patients API returns each
// number with an `iso2` -- and that is the only place the country exists, so
// the import reads it from there and falls back to Spain only for numbers it
// cannot find.
//
// Getting this wrong is not cosmetic. Every imported number was stored
// against 'ES', so a US patient's "(303) 710-5245" rendered as
// "+34 (303) 710-5245" and any WhatsApp sent to it would have gone to a
// Spanish number instead. On the first live migration that was 90 numbers
// across 16 countries.
const connection = usePracticeHubConnection()
const numberCountries = ref(new Map<string, string>())
const countryLookupState = ref<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
// The CSV's "Patient Number" holds a custom reference (DNI, passport) for
// the patients who have one, and every later step matches on the real
// patient number -- so their payments and bonos never arrived. The API knows
// which is which; a CSV row is stored under the number it maps to.
const patientNumberFor = ref(new Map<string, string>())

function countryKey(patientNumber: string, number: string) {
  return `${patientNumber.trim()}|${number.trim()}`
}

function readNumberCountries(patients: PHApiPatient[]) {
  const map = new Map<string, string>()
  for (const p of patients) {
    const ref = String(p.patient_number ?? '').trim()
    if (!ref) continue
    for (const n of p.numbers ?? []) {
      const num = (n?.number ?? '').trim()
      const iso = (n?.iso2 ?? '').trim().toUpperCase()
      if (num && iso) map.set(countryKey(ref, num), iso)
    }
  }
  numberCountries.value = map
  patientNumberFor.value = practiceHubPatientNumberMap(patients)
  countryLookupState.value = 'ready'
}

async function loadNumberCountries() {
  if (!connection.value) {
    countryLookupState.value = 'unavailable'
    return
  }
  countryLookupState.value = 'loading'
  try {
    const api = usePracticeHubApi(connection.value)
    readNumberCountries(await api.fetchAll<PHApiPatient>('/patients'))
  } catch {
    // A failed lookup imports the numbers rather than the whole file --
    // every other field is in the CSV and is still worth having.
    countryLookupState.value = 'unavailable'
  }
}

// Reads the patients straight from PracticeHub's API instead of a CSV
// export: the same rows, built by utils/practicehubApiRows.ts, through the
// same preview. Tags are only in PracticeHub 2.0's API, so they come across
// when that key is saved too, and the preview says so when it is not.
const loadingFromApi = ref(false)
const apiProgress = ref('')
const tagsUnavailable = ref(false)

async function loadTagsByPatientNumber(): Promise<Map<string, string[]> | undefined> {
  const saved = await useStaffFetch<{ hasV3Key?: boolean }>('/api/import/practicehub-connection').catch(() => null)
  if (!saved?.hasV3Key) return undefined
  try {
    const patients = await usePracticeHubV3().fetchAll<{ patient_number: string | null; tags?: { name: string }[] | null }>('/patients')
    return new Map(patients.map((p) => [String(p.patient_number ?? '').trim(), (p.tags ?? []).map((tag) => tag.name).filter(Boolean)]))
  } catch {
    return undefined
  }
}

async function loadFromPracticeHub() {
  if (!connection.value) return
  fileError.value = ''
  loadingFromApi.value = true
  try {
    const api = usePracticeHubApi(connection.value)
    apiProgress.value = t('Reading practitioners and referral sources…', 'Leyendo profesionales y fuentes de referencia…')
    const practitioners = await api.fetchAll<PHNamed>('/practitioners')
    const referralSources = await api.fetchAll<PHNamed>('/referral_sources')
    const patients = await api.fetchAll<PHApiPatient>('/patients', (fetched, total) => {
      apiProgress.value = t(`Reading patients… ${fetched} / ${total}`, `Leyendo pacientes… ${fetched} / ${total}`)
    })
    apiProgress.value = t('Reading tags…', 'Leyendo etiquetas…')
    const tagsByPatientNumber = await loadTagsByPatientNumber()
    tagsUnavailable.value = !tagsByPatientNumber

    readNumberCountries(patients)
    rawRows.value = practiceHubPatientRows(patients, { practitioners, referralSources, tagsByPatientNumber })
    fileName.value = t('PracticeHub, read just now', 'PracticeHub, leído ahora mismo')
    await computeDiff()
    stage.value = 'preview'
  } catch (e: any) {
    fileError.value = e?.data?.statusMessage ?? e?.message ?? t('Could not read PracticeHub.', 'No se pudo leer PracticeHub.')
  } finally {
    loadingFromApi.value = false
    apiProgress.value = ''
  }
}

// The fallback for a number PracticeHub's API didn't answer for. The
// account's own country, not Spain's -- a clinic in Lisbon importing without
// a connection should get Portuguese numbers, not the bug this replaced.
const defaultCountry = computed(() => store.defaultPhoneCountry)
const defaultCountryName = computed(() => countryByCode(defaultCountry.value).name)

// How many of the numbers about to be written are foreign. Worth showing:
// it is the difference between this import and the one that made every
// patient Spanish, and it is a number the clinic can sanity-check.
const foreignNumberCount = computed(() =>
  [...toImport.value, ...toUpdate.value].reduce(
    (total, row) => total + row.numbers.filter((n) => n.country_code !== defaultCountry.value).length,
    0,
  ),
)

function countryFor(patientNumber: string, number: string): string {
  return numberCountries.value.get(countryKey(patientNumber, number)) ?? defaultCountry.value
}

type CsvRow = Record<string, string>
type ContactNumber = { country_code: string; number: string; is_whatsapp: boolean }

interface MappedPatient {
  patient: TablesInsert<'patients'>
  numbers: ContactNumber[]
  sourceRow: number
}

// Fields PracticeHub owns for the duration of the migration -- on a
// re-import matching an existing patient, these get overwritten
// unconditionally (confirmed with the clinic: PracticeHub stays the source
// of truth right up to cutover, even though several of these are also
// editable from the patient's own QuiroFlow screen).
// `created_at` is deliberately not in this list -- it's handled separately
// in buildPatientUpdate using the *unfallen-back* parsed value, since
// `patient.created_at` always has a value (defaulting to "now" for rows
// with no CSV "Created" date, to satisfy the NOT NULL column on insert)
// and treating that default as a real change would flag every row missing
// a Created date as "created_at will change to right now" on every re-run.
const OVERWRITE_FIELDS = [
  'first_name',
  'last_name',
  'email',
  'date_of_birth',
  'referral_source',
  'preferred_language',
  'marketing_channels',
  'default_practitioner_id',
  'balance_cents',
] as const

interface ExistingPatient {
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
}

interface FieldDiff { field: string; from: string; to: string }

interface MappedUpdate {
  id: string
  label: string
  updates: TablesUpdate<'patients'>
  diff: FieldDiff[]
  numbers: ContactNumber[]
  sourceRow: number
}

const stage = ref<'pick' | 'preview' | 'importing' | 'done' | 'error'>('pick')
const dragOver = ref(false)
const fileError = ref('')
const fileName = ref('')
const runError = ref('')

// A plain `ref(store.currentClinicId ?? '')` snapshot here would silently
// stick at '' forever if this component mounts before the account store's
// own async load() resolves -- every imported patient would end up with no
// clinic at all (invisible on the main Patients list once its clinic
// filter applies) with no error anywhere. This stays in sync until the
// user actually touches the dropdown themselves.
const targetClinicId = ref('')
const clinicManuallySet = ref(false)
watch(
  () => store.currentClinicId,
  (id) => {
    if (!clinicManuallySet.value && id) targetClinicId.value = id
  },
  { immediate: true },
)

const toImport = ref<MappedPatient[]>([])
const toUpdate = ref<MappedUpdate[]>([])
const skippedDuplicate = ref(0)
const skippedDeleted = ref(0)
const skippedNoName = ref(0)
// PracticeHub practitioners named as a patient's default who are not on this
// clinic's team yet. A new clinic imports before inviting anyone, so without
// this every default practitioner is silently dropped; adding them under Team
// and reading again fills them in.
const unmatchedPractitioners = ref<{ name: string; patients: number }[]>([])
const totalRows = ref(0)

const importing = ref(false)
const importedCount = ref(0)
const updatedCount = ref(0)
const importErrors = ref<string[]>([])

interface TeamMemberOption { id: string; full_name: string }
const teamMembers = ref<TeamMemberOption[]>([])
onMounted(async () => {
  const { data } = await supabase.from('team_members').select('id, full_name')
  teamMembers.value = data ?? []
  // Picks up the connection saved under Settings -> Import -> PracticeHub ->
  // General, so the country lookup works without re-typing the API key here.
  await loadSavedPracticeHubConnection()
})

function matchPractitioner(name: string): string | null {
  const clean = name.trim().toLowerCase()
  if (!clean) return null
  const match = teamMembers.value.find((m) => m.full_name.trim().toLowerCase() === clean)
  return match?.id ?? null
}

function parseBalanceCents(value: string): number {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return 0
  // PracticeHub's export has this inverted relative to our convention:
  // a positive "Account Balance" there means the patient owes money (DR),
  // negative means they're in credit (CR). We store positive = credit,
  // negative = owed (verified against live PracticeHub data for several
  // real patients), so flip the sign on the way in.
  return -Math.round(n * 100)
}

function parseLanguage(value: string): string {
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
function parseCreatedAt(row: CsvRow): string | undefined {
  return practiceHubUtc(row['Patient Created'] || row['Created']) || undefined
}

function buildNotes(row: CsvRow): string | null {
  const parts = [row['Note'], row['Chief Complaint']].map((s) => s?.trim()).filter(Boolean)
  return parts.length > 0 ? parts.join('\n\n---\n\n') : null
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(blank)'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(blank)'
  return String(value)
}

function valuesDiffer(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify([...a].sort()) !== JSON.stringify([...b].sort())
  return a !== b
}

// Builds the update payload for a patient that already exists in QuiroFlow
// (matched by external_reference or email). Only overwrites a field when the
// incoming CSV value is actually present -- a blank cell in this export
// should never erase a value the patient already has.
function buildPatientUpdate(
  existing: ExistingPatient,
  incoming: TablesInsert<'patients'>,
  externalRef: string,
  fileRef: string,
  realCreatedAt: string | undefined,
) {
  const updates: TablesUpdate<'patients'> = {}
  const diff: FieldDiff[] = []

  for (const field of OVERWRITE_FIELDS) {
    const value = incoming[field]
    if (value === null || value === undefined) continue
    if (typeof value === 'string' && value === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    const existingValue = existing[field]
    if (valuesDiffer(value, existingValue)) {
      ;(updates as Record<string, unknown>)[field] = value
      diff.push({ field, from: formatValue(existingValue), to: formatValue(value) })
    }
  }

  // Compared as instants: Postgres hands back "…+00:00" and the parsed value
  // is "…Z", so a string comparison flagged every patient on every re-run.
  if (realCreatedAt && new Date(realCreatedAt).getTime() !== new Date(existing.created_at).getTime()) {
    updates.created_at = realCreatedAt
    diff.push({ field: 'created_at', from: formatValue(existing.created_at), to: formatValue(realCreatedAt) })
  }

  // A patient matched by email only (e.g. created directly in QuiroFlow)
  // won't have this set yet -- backfill it so future re-syncs match by ref.
  // One stored under their custom reference gets their patient number, so
  // the later steps find them.
  const misreferenced = existing.external_reference === fileRef && fileRef !== externalRef
  if (externalRef && (!existing.external_reference || misreferenced)) {
    updates.external_reference = externalRef
    diff.push({ field: 'external_reference', from: formatValue(existing.external_reference), to: externalRef })
  }

  return { updates, diff }
}

function buildMarketingChannels(row: CsvRow): string[] {
  const channels: string[] = []
  if (row['SMS Marketing'] === '1') channels.push('sms')
  if (row['Email Marketing'] === '1') channels.push('email')
  if (row['Other Marketing'] === '1') channels.push('other')
  return channels
}

const rawRows = ref<CsvRow[]>([])

async function handleFile(file: File) {
  fileError.value = ''
  fileName.value = file.name

  const text = await file.text()
  const parsed = Papa.parse<CsvRow>(text, { header: true, skipEmptyLines: true })

  if (parsed.errors.length > 0) {
    fileError.value = t(
      `Could not parse this file: ${parsed.errors[0].message}`,
      `No se pudo procesar este archivo: ${parsed.errors[0].message}`,
    )
    return
  }

  rawRows.value = parsed.data
  // Before the diff, not after: computeDiff() decides each number's country,
  // and the preview should show what will really be written.
  await loadNumberCountries()
  await computeDiff()
  stage.value = 'preview'
}

// Re-derives toImport/toUpdate against the DB's *current* state. Split out
// from handleFile so a retry after a failed import can recompute this from
// scratch -- re-fetching what's already landed -- instead of blindly
// re-running a stale plan that could double-insert whatever succeeded
// before the failure.
async function computeDiff() {
  const rows = rawRows.value
  totalRows.value = rows.length

  const byRef = new Map<string, ExistingPatient>()
  const byEmail = new Map<string, ExistingPatient>()
  const PAGE_SIZE = 1000
  for (let page = 0; ; page++) {
    const { data: existing } = await supabase
      .from('patients')
      .select(
        'id, external_reference, email, first_name, last_name, date_of_birth, referral_source, preferred_language, marketing_channels, default_practitioner_id, created_at, balance_cents',
      )
      .order('id').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    for (const p of existing ?? []) {
      const row = p as ExistingPatient
      if (row.external_reference) byRef.set(row.external_reference, row)
      if (row.email) byEmail.set(row.email.toLowerCase(), row)
    }
    if (!existing || existing.length < PAGE_SIZE) break
  }

  skippedDuplicate.value = 0
  skippedDeleted.value = 0
  skippedNoName.value = 0
  const mapped: MappedPatient[] = []
  const updates: MappedUpdate[] = []
  const matchedIds: string[] = []
  const unmatched = new Map<string, number>()

  rows.forEach((row, index) => {
    if ((row['Deleted'] || '').trim().toUpperCase() === 'TRUE') {
      skippedDeleted.value++
      return
    }

    const firstName = row['First Name']?.trim() || row['Last Name']?.trim() || ''
    if (!firstName) {
      skippedNoName.value++
      return
    }

    const email = row['Email Address']?.trim() || ''
    const fileRef = row['Patient Number']?.trim() || ''
    const externalRef = patientNumberFor.value.get(fileRef) ?? fileRef
    // Also by the reference as the file gave it: a patient imported earlier
    // under their custom reference is the same patient, not a new one.
    const existing = (externalRef && byRef.get(externalRef)) || (fileRef && byRef.get(fileRef)) || (email && byEmail.get(email.toLowerCase())) || undefined

    const numbers: ContactNumber[] = []
    const mobile = row['Mobile']?.trim()
    const home = row['Home']?.trim()
    if (mobile) numbers.push({ country_code: countryFor(externalRef, mobile), number: mobile, is_whatsapp: false })
    if (home) numbers.push({ country_code: countryFor(externalRef, home), number: home, is_whatsapp: false })
    for (const other of (row['Other Numbers'] ?? '').split('\n').map((n) => n.trim()).filter(Boolean)) {
      numbers.push({ country_code: countryFor(externalRef, other), number: other, is_whatsapp: false })
    }

    const practitionerName = row['Default Practitioner']?.trim() || ''
    if (practitionerName && !matchPractitioner(practitionerName)) {
      unmatched.set(practitionerName, (unmatched.get(practitionerName) ?? 0) + 1)
    }

    const realCreatedAt = parseCreatedAt(row)
    const patient: TablesInsert<'patients'> = {
      account_id: store.accountId!,
      clinic_id: targetClinicId.value || null,
      first_name: firstName,
      last_name: row['First Name']?.trim() ? row['Last Name']?.trim() || null : null,
      email: email || null,
      date_of_birth: row['Date of Birth']?.trim() || null,
      // Explicit fallback rather than an `undefined` value -- a bulk
      // insert's request body doesn't reliably strip an `undefined`-valued
      // key the way a single-object insert would, and a NULL landing on
      // this NOT NULL column fails the whole batch's insert. Only used for
      // new rows -- buildPatientUpdate uses `realCreatedAt` directly so this
      // fallback never gets treated as a real change on an update.
      created_at: realCreatedAt ?? new Date().toISOString(),
      balance_cents: parseBalanceCents(row['Account Balance'] || '0'),
      tags: (row['Tags'] ?? '').split(',').map((tag) => tag.trim()).filter(Boolean),
      referral_source: row['Referral Source']?.trim() || null,
      preferred_language: parseLanguage(row['Preferred Language'] || ''),
      notes: buildNotes(row),
      external_reference: externalRef || null,
      marketing_channels: buildMarketingChannels(row),
      default_practitioner_id: matchPractitioner(row['Default Practitioner'] || ''),
    }

    if (!existing) {
      mapped.push({ sourceRow: index + 2, patient, numbers })
      return
    }

    matchedIds.push(existing.id)
    const { updates: fieldUpdates, diff } = buildPatientUpdate(existing, patient, externalRef, fileRef, realCreatedAt)
    // Kept even with no field changes while it carries numbers: one of them
    // may be new, which is only known once they are compared below.
    if (Object.keys(fieldUpdates).length === 0 && numbers.length === 0) {
      skippedDuplicate.value++
      return
    }
    updates.push({
      id: existing.id,
      label: `${patient.first_name} ${patient.last_name ?? ''}`.trim(),
      updates: fieldUpdates,
      diff,
      numbers,
      sourceRow: index + 2,
    })
  })

  // Contact numbers are additive-only on an update -- never touch a number
  // the patient already has, only add ones this row carries that aren't
  // already on file (normalized so formatting differences don't cause dupes).
  if (matchedIds.length > 0) {
    const existingNumbersByPatient = new Map<string, Set<string>>()
    const ID_CHUNK = 200
    for (let i = 0; i < matchedIds.length; i += ID_CHUNK) {
      const idChunk = matchedIds.slice(i, i + ID_CHUNK)
      const { data } = await supabase.from('patient_contact_numbers').select('patient_id, number').in('patient_id', idChunk)
      for (const n of data ?? []) {
        const set = existingNumbersByPatient.get(n.patient_id) ?? new Set<string>()
        set.add(n.number.replace(/\D/g, ''))
        existingNumbersByPatient.set(n.patient_id, set)
      }
    }
    for (const u of updates) {
      const existingSet = existingNumbersByPatient.get(u.id) ?? new Set<string>()
      u.numbers = u.numbers.filter((n) => !existingSet.has(n.number.replace(/\D/g, '')))
      for (const n of u.numbers) u.diff.push({ field: 'phone', from: '(new)', to: n.number })
    }
  }
  const changed = updates.filter((u) => Object.keys(u.updates).length > 0 || u.numbers.length > 0)
  skippedDuplicate.value += updates.length - changed.length

  toImport.value = mapped
  toUpdate.value = changed
  unmatchedPractitioners.value = [...unmatched].map(([name, patients]) => ({ name, patients })).sort((a, b) => b.patients - a.patients)
}

function onDrop(e: DragEvent) {
  dragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) handleFile(file)
}
function onFileInput(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) handleFile(file)
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0
  async function worker() {
    while (index < items.length) {
      const item = items[index++]
      await fn(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

async function insertContactNumbers(patientId: string, numbers: ContactNumber[], sourceRow: number) {
  if (numbers.length === 0) return
  const { error } = await supabase.from('patient_contact_numbers').insert(
    numbers.map((n) => ({
      account_id: store.accountId!,
      patient_id: patientId,
      country_code: n.country_code,
      number: n.number,
      is_whatsapp: n.is_whatsapp,
    })),
  )
  if (error) importErrors.value.push(`Contact numbers for row ${sourceRow}: ${error.message}`)
}

async function runImport() {
  importing.value = true
  stage.value = 'importing'
  runError.value = ''
  importedCount.value = 0
  updatedCount.value = 0
  importErrors.value = []

  try {
    const CHUNK_SIZE = 100
    for (let i = 0; i < toImport.value.length; i += CHUNK_SIZE) {
      const chunk = toImport.value.slice(i, i + CHUNK_SIZE)
      const { data: inserted, error } = await supabase
        .from('patients')
        .insert(chunk.map((c) => c.patient))
        .select('id')

      if (error) {
        importErrors.value.push(
          t(
            `Rows ${chunk[0].sourceRow}-${chunk[chunk.length - 1].sourceRow}: ${error.message}`,
            `Filas ${chunk[0].sourceRow}-${chunk[chunk.length - 1].sourceRow}: ${error.message}`,
          ),
        )
        continue
      }

      importedCount.value += inserted.length

      const numberRows = chunk.flatMap((c, idx) =>
        c.numbers.map((n) => ({
          account_id: store.accountId!,
          patient_id: inserted[idx].id,
          country_code: n.country_code,
          number: n.number,
          is_whatsapp: n.is_whatsapp,
        })),
      )
      if (numberRows.length > 0) {
        const { error: numbersError } = await supabase.from('patient_contact_numbers').insert(numberRows)
        if (numbersError)
          importErrors.value.push(
            t(
              `Contact numbers for rows near ${chunk[0].sourceRow}: ${numbersError.message}`,
              `Números de contacto de filas cerca de ${chunk[0].sourceRow}: ${numbersError.message}`,
            ),
          )
      }
    }

    const UPDATE_CHUNK_SIZE = 100
    const CONCURRENCY = 8
    for (let i = 0; i < toUpdate.value.length; i += UPDATE_CHUNK_SIZE) {
      const chunk = toUpdate.value.slice(i, i + UPDATE_CHUNK_SIZE)
      await runWithConcurrency(chunk, CONCURRENCY, async (row) => {
        // A row that only brings a new number has nothing to update.
        const { error } = Object.keys(row.updates).length > 0 ? await supabase.from('patients').update(row.updates).eq('id', row.id) : { error: null }
        if (error) {
          importErrors.value.push(
            t(`Row ${row.sourceRow} (${row.label}): ${error.message}`, `Fila ${row.sourceRow} (${row.label}): ${error.message}`),
          )
          return
        }
        updatedCount.value++
        await insertContactNumbers(row.id, row.numbers, row.sourceRow)
      })
    }

    importing.value = false
    stage.value = 'done'
    showToast(
      t(
        `Imported ${importedCount.value} patients. Updated ${updatedCount.value} existing patients.`,
        `Se importaron ${importedCount.value} pacientes. Se actualizaron ${updatedCount.value} pacientes existentes.`,
      ),
      importErrors.value.length > 0 ? 'error' : 'success',
    )
  } catch (err) {
    importing.value = false
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
  }
}

async function retryImport() {
  stage.value = 'importing'
  runError.value = ''
  try {
    await computeDiff()
  } catch (err) {
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
    return
  }
  await runImport()
}

function reset() {
  stage.value = 'pick'
  fileName.value = ''
  fileError.value = ''
  tagsUnavailable.value = false
  toImport.value = []
  toUpdate.value = []
  importedCount.value = 0
  updatedCount.value = 0
  importErrors.value = []
}
const introLead = computed(() => t('Brings patients across from PracticeHub. Every other step matches its records to a patient by the reference stored here, so this one has to run first.', 'Trae los pacientes desde PracticeHub. Todos los demás pasos emparejan sus registros con un paciente por la referencia que se guarda aquí, así que este debe ir primero.'))
const introNotes = computed(() => [
        { title: t('Read straight from PracticeHub.', 'Leído directamente de PracticeHub.'), body: t('With the connection saved, nothing needs exporting. A CSV export from Settings -> Data Exports still works.', 'Con la conexión guardada, no hace falta exportar nada. Una exportación CSV desde Settings -> Data Exports sigue sirviendo.') },
        { title: t('Nothing is written until you press Apply.', 'No se escribe nada hasta que pulses Aplicar.'), body: t('The preview lists what will be created or updated so you can check it first.', 'La vista previa muestra qué se creará o actualizará para que lo compruebes antes.') },
        { title: t('Safe to run again.', 'Se puede volver a ejecutar.'), body: t('A patient already carrying their PracticeHub reference is matched and updated, never duplicated.', 'Un paciente que ya tiene su referencia de PracticeHub se empareja y se actualiza, nunca se duplica.') },
])

// Ties each visible <label> to the field under it (for/id), so a screen
// reader announces the field by its name.
const fieldId = useId()
</script>

<template>
  <div>
    <ImportIntro :lead="introLead" :notes="introNotes" />

    <div v-if="stage === 'pick'" class="mt-4 space-y-3">
      <div class="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-4">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-ink-900">{{ t('From PracticeHub', 'Desde PracticeHub') }}</p>
          <p class="text-[12.5px] text-ink-muted2">
            {{ connection
              ? (loadingFromApi ? apiProgress : t('Reads every patient through the saved connection. Takes a minute or two.', 'Lee todos los pacientes con la conexión guardada. Tarda un minuto o dos.'))
              : t('Save the connection first, under Connection.', 'Guarda antes la conexión, en Conexión.') }}
          </p>
        </div>
        <button
          type="button"
          class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover disabled:opacity-50"
          :disabled="!connection || loadingFromApi"
          data-cy="ph-patients-from-api"
          @click="loadFromPracticeHub"
        >
          {{ loadingFromApi ? t('Reading…', 'Leyendo…') : t('Read patients', 'Leer pacientes') }}
        </button>
      </div>
      <div
        class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center"
        :class="dragOver ? 'border-brand bg-brand-tint' : 'border-line-control bg-surface'"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop.prevent="onDrop"
      >
        <p class="text-sm text-ink-600">{{ t('Or drag and drop a PracticeHub CSV export here, or', 'O arrastra y suelta aquí una exportación CSV de PracticeHub, o') }}</p>
        <label class="mt-2 cursor-pointer text-sm font-medium text-brand-text hover:text-brand-text">
          {{ t('browse for a file', 'busca un archivo') }}
          <input type="file" accept=".csv" class="hidden" @change="onFileInput" />
        </label>
      </div>
      <p v-if="fileError" class="mt-2 text-sm text-danger-text">{{ fileError }}</p>
    </div>

    <div v-else-if="stage === 'preview'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-line bg-surface p-4">
        <p class="text-sm font-medium text-ink-900">{{ fileName }}</p>
        <dl class="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
          <div><dt class="text-ink-muted2">{{ t('Total rows', 'Filas totales') }}</dt><dd class="font-medium text-ink-900">{{ totalRows }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('Will import', 'Se importarán') }}</dt><dd class="font-medium text-success-text">{{ toImport.length }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('Will update', 'Se actualizarán') }}</dt><dd class="font-medium text-brand-text">{{ toUpdate.length }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('No changes', 'Sin cambios') }}</dt><dd class="font-medium text-ink-900">{{ skippedDuplicate }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('Deleted/no-name skipped', 'Eliminados/sin nombre omitidos') }}</dt><dd class="font-medium text-ink-900">{{ skippedDeleted + skippedNoName }}</dd></div>
        </dl>
        <!-- The CSV has no country for a phone number; PracticeHub's API
             does. Say which of the two answered, because the fallback makes
             every number Spanish and that is exactly the bug this replaced. -->
        <p v-if="countryLookupState === 'ready'" class="mt-3 text-[12.5px] text-ink-muted2">
          {{ t(
            `Phone countries read from PracticeHub · ${foreignNumberCount} number(s) outside ${defaultCountryName}`,
            `Países de los teléfonos leídos de PracticeHub · ${foreignNumberCount} número(s) fuera de ${defaultCountryName}`,
          ) }}
        </p>
        <p v-else-if="countryLookupState === 'unavailable'" class="mt-3 text-[12.5px] text-warning-text">
          {{ t(
            `No PracticeHub connection, so every phone number will be saved as ${defaultCountryName}. Connect PracticeHub under Settings → Import → PracticeHub → General and re-run this to get each number's real country.`,
            `Sin conexión con PracticeHub, todos los teléfonos se guardarán como ${defaultCountryName}. Conecta PracticeHub en Ajustes → Importar → PracticeHub → General y vuelve a ejecutarlo para obtener el país real de cada número.`,
          ) }}
        </p>
        <p v-if="tagsUnavailable" class="mt-1 text-[12.5px] text-warning-text" data-cy="ph-patients-no-tags">
          {{ t(
            'Tags are only in PracticeHub 2.0’s API, so they are not included. Save the 2.0 key under Connection and read again to bring them.',
            'Las etiquetas solo están en la API de PracticeHub 2.0, así que no se incluyen. Guarda la clave 2.0 en Conexión y vuelve a leer para traerlas.',
          ) }}
        </p>
        <p v-if="unmatchedPractitioners.length > 0" class="mt-1 text-[12.5px] text-warning-text" data-cy="ph-patients-unmatched-practitioners">
          {{ t(
            `Not on your team yet, so these patients get no default practitioner: ${unmatchedPractitioners.map((p) => `${p.name} (${p.patients})`).join(', ')}. Add them under Settings → Team with the same name and read again.`,
            `Aún no están en tu equipo, así que estos pacientes quedan sin profesional habitual: ${unmatchedPractitioners.map((p) => `${p.name} (${p.patients})`).join(', ')}. Añádelos en Ajustes → Equipo con el mismo nombre y vuelve a leer.`,
          ) }}
        </p>
      </div>

      <div>
        <label :for="`${fieldId}-targetClinicId`" class="block text-sm font-medium text-ink-700">{{ t('Import into clinic', 'Importar a la clínica') }}</label>
        <select :id="`${fieldId}-targetClinicId`"
          v-model="targetClinicId"
          class="mt-1 w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          @change="clinicManuallySet = true"
        >
          <option value="">{{ t('No primary clinic', 'Sin clínica principal') }}</option>
          <option v-for="c in store.clinics" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>

      <div class="overflow-hidden rounded-lg border border-line bg-surface">
        <table class="w-full text-sm">
          <thead class="border-b border-line bg-surface-subtle text-left text-xs font-medium uppercase tracking-wide text-ink-muted2">
            <tr>
              <th class="px-3 py-2">{{ t('Name', 'Nombre') }}</th>
              <th class="px-3 py-2">{{ t('Email', 'Correo electrónico') }}</th>
              <th class="px-3 py-2">{{ t('Balance', 'Saldo') }}</th>
              <th class="px-3 py-2">{{ t('Language', 'Idioma') }}</th>
              <th class="px-3 py-2">{{ t('Tags', 'Etiquetas') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <tr v-for="(row, i) in toImport.slice(0, 10)" :key="i">
              <td class="px-3 py-2 text-ink-900">{{ row.patient.first_name }} {{ row.patient.last_name }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ row.patient.email ?? t('N/A', 'N/D') }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ formatEur((row.patient.balance_cents ?? 0)) }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ row.patient.preferred_language }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ (row.patient.tags ?? []).join(', ') || t('N/A', 'N/D') }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="toImport.length > 10" class="border-t border-line-divider px-3 py-2 text-xs text-ink-faint">
          + {{ toImport.length - 10 }} {{ t('more rows', 'filas más') }}
        </p>
      </div>

      <div v-if="toUpdate.length > 0" class="overflow-hidden rounded-lg border border-line bg-surface">
        <div class="border-b border-line-divider px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted2">
          Sample of changes to existing patients
        </div>
        <table class="w-full text-sm">
          <thead class="border-b border-line bg-surface-subtle text-left text-xs font-medium uppercase tracking-wide text-ink-muted2">
            <tr>
              <th class="px-3 py-2">Patient</th>
              <th class="px-3 py-2">Field</th>
              <th class="px-3 py-2">Current</th>
              <th class="px-3 py-2">New</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <template v-for="(row, i) in toUpdate.slice(0, 5)" :key="i">
              <tr v-for="(d, j) in row.diff" :key="j">
                <td class="px-3 py-2 text-ink-900">{{ j === 0 ? row.label : '' }}</td>
                <td class="px-3 py-2 text-ink-muted2">{{ d.field }}</td>
                <td class="px-3 py-2 text-ink-muted2">{{ d.from }}</td>
                <td class="px-3 py-2 text-ink-900">{{ d.to }}</td>
              </tr>
            </template>
          </tbody>
        </table>
        <p v-if="toUpdate.length > 5" class="border-t border-line-divider px-3 py-2 text-xs text-ink-faint">
          + {{ toUpdate.length - 5 }} more patients to update
        </p>
      </div>

      <div class="flex gap-3">
        <button
          type="button"
          :disabled="toImport.length === 0 && toUpdate.length === 0"
          class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover disabled:opacity-50"
          @click="runImport"
        >
          {{ t(`Import ${toImport.length}, update ${toUpdate.length}`, `Importar ${toImport.length}, actualizar ${toUpdate.length}`) }}
        </button>
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="reset">
          {{ t('Cancel', 'Cancelar') }}
        </button>
      </div>
    </div>

    <div v-else-if="stage === 'importing'" class="mt-4 rounded-lg border border-line bg-surface p-8 text-center">
      <p class="text-sm text-ink-600">
        {{
          t(
            `Importing… ${importedCount + updatedCount} / ${toImport.length + toUpdate.length}`,
            `Importando… ${importedCount + updatedCount} / ${toImport.length + toUpdate.length}`,
          )
        }}
      </p>
    </div>

    <div v-else-if="stage === 'error'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
        <p class="font-medium">{{ t('Import failed:', 'Error al importar:') }}</p>
        <p class="mt-1">{{ runError }}</p>
      </div>
      <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover" @click="retryImport">
        {{ t('Retry', 'Reintentar') }}
      </button>
    </div>

    <div v-else-if="stage === 'done'" class="mt-4 space-y-4">
      <div v-if="importErrors.length > 0" class="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
        <p class="font-medium">{{ t('Some rows failed:', 'Algunas filas fallaron:') }}</p>
        <ul class="mt-1 list-disc pl-5">
          <li v-for="(e, i) in importErrors" :key="i">{{ e }}</li>
        </ul>
      </div>
      <div class="flex gap-3">
        <NuxtLink to="/patients" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover">
          {{ t('View Patients', 'Ver pacientes') }}
        </NuxtLink>
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="reset">
          {{ t('Import another file', 'Importar otro archivo') }}
        </button>
      </div>
    </div>
  </div>
</template>

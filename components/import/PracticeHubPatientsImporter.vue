<script setup lang="ts">
import Papa from 'papaparse'
import type { TablesInsert, TablesUpdate } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

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

// Same "Created" column/parsing PracticeHubFileAttachmentsImporter.vue
// already uses. Without this, every migrated patient's created_at defaults
// to the moment of import (now()) instead of when they actually joined the
// practice -- e.g. tenure-based reports and "new patient" filters would be
// wrong for the entire migrated patient base.
function parseCreatedAt(value: string): string | undefined {
  if (!value?.trim()) return undefined
  const d = new Date(value.trim().replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
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

  if (realCreatedAt && valuesDiffer(realCreatedAt, existing.created_at)) {
    updates.created_at = realCreatedAt
    diff.push({ field: 'created_at', from: formatValue(existing.created_at), to: formatValue(realCreatedAt) })
  }

  // A patient matched by email only (e.g. created directly in QuiroFlow)
  // won't have this set yet -- backfill it so future re-syncs match by ref.
  if (!existing.external_reference && externalRef) {
    updates.external_reference = externalRef
    diff.push({ field: 'external_reference', from: '(blank)', to: externalRef })
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
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
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
    const externalRef = row['Patient Number']?.trim() || ''
    const existing = (externalRef && byRef.get(externalRef)) || (email && byEmail.get(email.toLowerCase())) || undefined

    const numbers: ContactNumber[] = []
    if (row['Mobile']?.trim()) numbers.push({ country_code: 'ES', number: row['Mobile'].trim(), is_whatsapp: false })
    if (row['Home']?.trim()) numbers.push({ country_code: 'ES', number: row['Home'].trim(), is_whatsapp: false })

    const realCreatedAt = parseCreatedAt(row['Created'] || '')
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
      tags: row['Tags']?.trim() ? [row['Tags'].trim()] : [],
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
    const { updates: fieldUpdates, diff } = buildPatientUpdate(existing, patient, externalRef, realCreatedAt)
    if (Object.keys(fieldUpdates).length === 0) {
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
    }
  }

  toImport.value = mapped
  toUpdate.value = updates
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
        const { error } = await supabase.from('patients').update(row.updates).eq('id', row.id)
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
  toImport.value = []
  toUpdate.value = []
  importedCount.value = 0
  updatedCount.value = 0
  importErrors.value = []
}
</script>

<template>
  <div>
    <p class="text-sm text-ink-muted2">
      {{
        t(
          'Export "Patients" as CSV from PracticeHub (Settings → Data Exports), then drop it here.',
          'Exporta "Patients" como CSV desde PracticeHub (Settings → Data Exports) y luego suéltalo aquí.',
        )
      }}
    </p>

    <div v-if="stage === 'pick'" class="mt-4">
      <div
        class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center"
        :class="dragOver ? 'border-brand bg-brand-tint' : 'border-line-control bg-surface'"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop.prevent="onDrop"
      >
        <p class="text-sm text-ink-600">{{ t('Drag and drop a CSV file here, or', 'Arrastra y suelta un archivo CSV aquí, o') }}</p>
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
      </div>

      <div>
        <label class="block text-sm font-medium text-ink-700">{{ t('Import into clinic', 'Importar a la clínica') }}</label>
        <select
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
              <td class="px-3 py-2 text-ink-muted2">€{{ ((row.patient.balance_cents ?? 0) / 100).toFixed(2) }}</td>
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
          class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
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
      <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover" @click="retryImport">
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
        <NuxtLink to="/patients" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover">
          {{ t('View Patients', 'Ver pacientes') }}
        </NuxtLink>
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="reset">
          {{ t('Import another file', 'Importar otro archivo') }}
        </button>
      </div>
    </div>
  </div>
</template>

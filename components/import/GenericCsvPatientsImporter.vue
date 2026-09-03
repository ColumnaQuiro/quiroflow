<script setup lang="ts">
import Papa from 'papaparse'
import type { TablesInsert, TablesUpdate } from '~/types/database.types'

// The "Other system" patients importer -- unlike the PracticeHub CSV
// importers, this one can't hardcode column names (row['First Name'] etc.)
// since every export a clinic drags in here (Cliniko, MyClinic, Dentally, a
// hand-built spreadsheet) uses different headers. So there's an extra
// "mapping" stage between picking the file and previewing the diff, where
// the clinic points each QuiroFlow field at one of their file's actual
// columns -- pre-guessed from the header text where possible. Everything
// after that (dedupe by external_reference/email, diff-based update on
// re-run, chunked insert) follows the same convention as
// PracticeHubPatientsImporter.vue.

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

type CsvRow = Record<string, string>
type ContactNumber = { country_code: string; number: string; is_whatsapp: boolean }

interface TargetField {
  key: string
  label: string
  required: boolean
  // Substrings matched against a lowercased, accent-stripped header to
  // pre-select a column -- first field in TARGET_FIELDS order wins a given
  // header, so order matters a little (first_name before last_name, etc.).
  guesses: string[]
}
const TARGET_FIELDS: TargetField[] = [
  { key: 'first_name', label: t('First name', 'Nombre'), required: true, guesses: ['first name', 'firstname', 'nombre', 'name'] },
  { key: 'last_name', label: t('Last name', 'Apellidos'), required: false, guesses: ['last name', 'lastname', 'surname', 'apellido'] },
  { key: 'email', label: t('Email', 'Correo electrónico'), required: false, guesses: ['email', 'e-mail', 'correo'] },
  { key: 'phone', label: t('Phone', 'Teléfono'), required: false, guesses: ['phone', 'mobile', 'cell', 'telefono', 'teléfono', 'celular'] },
  { key: 'date_of_birth', label: t('Date of birth', 'Fecha de nacimiento'), required: false, guesses: ['birth', 'dob', 'nacimiento'] },
  { key: 'address', label: t('Street address', 'Dirección'), required: false, guesses: ['address', 'direccion', 'dirección', 'street'] },
  { key: 'postal_code', label: t('Postal code', 'Código postal'), required: false, guesses: ['postal', 'zip', 'postcode', 'codigo postal'] },
  { key: 'city', label: t('City', 'Ciudad'), required: false, guesses: ['city', 'ciudad', 'poblacion', 'población', 'town'] },
  { key: 'country', label: t('Country', 'País'), required: false, guesses: ['country', 'pais', 'país'] },
  { key: 'national_id', label: t('National ID', 'DNI/NIE'), required: false, guesses: ['dni', 'nie', 'national id', 'passport'] },
  { key: 'tags', label: t('Tags', 'Etiquetas'), required: false, guesses: ['tags', 'etiquetas'] },
  {
    key: 'external_id',
    label: t('Record ID (optional — enables safe re-import)', 'ID de registro (opcional — permite reimportar sin duplicar)'),
    required: false,
    guesses: ['patient id', 'patient number', 'record id', 'external id', 'id'],
  },
]

const stage = ref<'pick' | 'mapping' | 'preview' | 'importing' | 'done' | 'error'>('pick')
const dragOver = ref(false)
const fileError = ref('')
const fileName = ref('')
const runError = ref('')
const rawRows = ref<CsvRow[]>([])
const headers = ref<string[]>([])
const mapping = ref<Record<string, string>>({})

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
}

function guessMapping() {
  const used = new Set<string>()
  const guessed: Record<string, string> = {}
  for (const field of TARGET_FIELDS) {
    const match = headers.value.find((h) => !used.has(h) && field.guesses.some((g) => normalizeHeader(h).includes(g)))
    if (match) {
      guessed[field.key] = match
      used.add(match)
    }
  }
  mapping.value = guessed
}

async function handleFile(file: File) {
  fileError.value = ''
  fileName.value = file.name

  const text = await file.text()
  const parsed = Papa.parse<CsvRow>(text, { header: true, skipEmptyLines: true })
  if (parsed.errors.length > 0) {
    fileError.value = t(`Could not parse this file: ${parsed.errors[0].message}`, `No se pudo procesar este archivo: ${parsed.errors[0].message}`)
    return
  }
  if (parsed.data.length === 0) {
    fileError.value = t('This file has no rows.', 'Este archivo no tiene filas.')
    return
  }

  rawRows.value = parsed.data
  headers.value = parsed.meta.fields ?? Object.keys(parsed.data[0])
  guessMapping()
  stage.value = 'mapping'
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

const mappingComplete = computed(() => TARGET_FIELDS.filter((f) => f.required).every((f) => !!mapping.value[f.key]))

const targetClinicId = ref('')
const clinicManuallySet = ref(false)
watch(
  () => store.currentClinicId,
  (id) => {
    if (!clinicManuallySet.value && id) targetClinicId.value = id
  },
  { immediate: true },
)

interface MappedPatient { patient: TablesInsert<'patients'>; numbers: ContactNumber[]; sourceRow: number }
interface FieldDiff { field: string; from: string; to: string }
interface MappedUpdate { id: string; label: string; updates: TablesUpdate<'patients'>; diff: FieldDiff[]; numbers: ContactNumber[]; sourceRow: number }
interface ExistingPatient {
  id: string
  external_reference: string | null
  email: string | null
  first_name: string
  last_name: string | null
  date_of_birth: string | null
  address: string | null
  postal_code: string | null
  city: string | null
  country: string | null
  national_id: string | null
}
// Update-on-rematch fields -- tags are deliberately excluded (insert-only),
// same choice PracticeHubPatientsImporter.vue makes, so a re-import never
// clobbers tags a clinic has since added by hand in QuiroFlow.
const OVERWRITE_FIELDS = ['first_name', 'last_name', 'email', 'date_of_birth', 'address', 'postal_code', 'city', 'country', 'national_id'] as const

const toImport = ref<MappedPatient[]>([])
const toUpdate = ref<MappedUpdate[]>([])
const skippedDuplicate = ref(0)
const skippedNoName = ref(0)
const totalRows = ref(0)

function mappedValue(row: CsvRow, key: string): string {
  const header = mapping.value[key]
  if (!header) return ''
  return (row[header] ?? '').trim()
}
function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(blank)'
  return String(value)
}
function buildPatientUpdate(existing: ExistingPatient, incoming: TablesInsert<'patients'>, externalRef: string) {
  const updates: TablesUpdate<'patients'> = {}
  const diff: FieldDiff[] = []
  for (const field of OVERWRITE_FIELDS) {
    const value = (incoming as Record<string, unknown>)[field]
    if (value === null || value === undefined || value === '') continue
    const existingValue = (existing as unknown as Record<string, unknown>)[field]
    if (value !== existingValue) {
      ;(updates as Record<string, unknown>)[field] = value
      diff.push({ field, from: formatValue(existingValue), to: formatValue(value) })
    }
  }
  if (!existing.external_reference && externalRef) {
    updates.external_reference = externalRef
    diff.push({ field: 'external_reference', from: '(blank)', to: externalRef })
  }
  return { updates, diff }
}

async function computeDiff() {
  const rows = rawRows.value
  totalRows.value = rows.length

  const byRef = new Map<string, ExistingPatient>()
  const byEmail = new Map<string, ExistingPatient>()
  const PAGE_SIZE = 1000
  for (let page = 0; ; page++) {
    const { data: existing } = await supabase
      .from('patients')
      .select('id, external_reference, email, first_name, last_name, date_of_birth, address, postal_code, city, country, national_id')
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    for (const p of existing ?? []) {
      const row = p as ExistingPatient
      if (row.external_reference) byRef.set(row.external_reference, row)
      if (row.email) byEmail.set(row.email.toLowerCase(), row)
    }
    if (!existing || existing.length < PAGE_SIZE) break
  }

  skippedDuplicate.value = 0
  skippedNoName.value = 0
  const mapped: MappedPatient[] = []
  const updates: MappedUpdate[] = []
  const matchedIds: string[] = []

  rows.forEach((row, index) => {
    const firstName = mappedValue(row, 'first_name')
    if (!firstName) {
      skippedNoName.value++
      return
    }
    const email = mappedValue(row, 'email')
    const externalRef = mappedValue(row, 'external_id')
    const existing = (externalRef && byRef.get(externalRef)) || (email && byEmail.get(email.toLowerCase())) || undefined

    const phone = mappedValue(row, 'phone')
    const numbers: ContactNumber[] = phone ? [{ country_code: 'ES', number: phone, is_whatsapp: false }] : []

    const tagsRaw = mappedValue(row, 'tags')
    const patient: TablesInsert<'patients'> = {
      account_id: store.accountId!,
      clinic_id: targetClinicId.value || null,
      first_name: firstName,
      last_name: mappedValue(row, 'last_name') || null,
      email: email || null,
      date_of_birth: mappedValue(row, 'date_of_birth') || null,
      address: mappedValue(row, 'address') || null,
      postal_code: mappedValue(row, 'postal_code') || null,
      city: mappedValue(row, 'city') || null,
      country: mappedValue(row, 'country') || null,
      national_id: mappedValue(row, 'national_id') || null,
      tags: tagsRaw ? tagsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [],
      external_reference: externalRef || null,
    }

    if (!existing) {
      mapped.push({ sourceRow: index + 2, patient, numbers })
      return
    }
    matchedIds.push(existing.id)
    const { updates: fieldUpdates, diff } = buildPatientUpdate(existing, patient, externalRef)
    if (Object.keys(fieldUpdates).length === 0) {
      skippedDuplicate.value++
      return
    }
    updates.push({ id: existing.id, label: `${patient.first_name} ${patient.last_name ?? ''}`.trim(), updates: fieldUpdates, diff, numbers, sourceRow: index + 2 })
  })

  // Contact numbers are additive-only on an update, same as the PracticeHub
  // importer -- never touch a number the patient already has.
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

async function confirmMapping() {
  await computeDiff()
  stage.value = 'preview'
}

const importing = ref(false)
const importedCount = ref(0)
const updatedCount = ref(0)
const importErrors = ref<string[]>([])

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
    numbers.map((n) => ({ account_id: store.accountId!, patient_id: patientId, country_code: n.country_code, number: n.number, is_whatsapp: n.is_whatsapp })),
  )
  if (error) importErrors.value.push(`${t('Contact number for row', 'Número de contacto de la fila')} ${sourceRow}: ${error.message}`)
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
      const { data: inserted, error } = await supabase.from('patients').insert(chunk.map((c) => c.patient)).select('id')
      if (error) {
        importErrors.value.push(`${t('Rows', 'Filas')} ${chunk[0].sourceRow}-${chunk[chunk.length - 1].sourceRow}: ${error.message}`)
        continue
      }
      importedCount.value += inserted.length
      const numberRows = chunk.flatMap((c, idx) =>
        c.numbers.map((n) => ({ account_id: store.accountId!, patient_id: inserted[idx].id, country_code: n.country_code, number: n.number, is_whatsapp: n.is_whatsapp })),
      )
      if (numberRows.length > 0) {
        const { error: numbersError } = await supabase.from('patient_contact_numbers').insert(numberRows)
        if (numbersError) importErrors.value.push(`${t('Contact numbers for rows near', 'Números de contacto de filas cerca de')} ${chunk[0].sourceRow}: ${numbersError.message}`)
      }
    }

    const UPDATE_CHUNK_SIZE = 100
    const CONCURRENCY = 8
    for (let i = 0; i < toUpdate.value.length; i += UPDATE_CHUNK_SIZE) {
      const chunk = toUpdate.value.slice(i, i + UPDATE_CHUNK_SIZE)
      await runWithConcurrency(chunk, CONCURRENCY, async (row) => {
        const { error } = await supabase.from('patients').update(row.updates).eq('id', row.id)
        if (error) {
          importErrors.value.push(`${t('Row', 'Fila')} ${row.sourceRow} (${row.label}): ${error.message}`)
          return
        }
        updatedCount.value++
        await insertContactNumbers(row.id, row.numbers, row.sourceRow)
      })
    }

    importing.value = false
    stage.value = 'done'
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
  headers.value = []
  mapping.value = {}
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
      {{ t('Export your patients as a CSV from your current system, then drop it here — column names don\'t need to match, you\'ll map them next.', 'Exporta tus pacientes como CSV desde tu sistema actual y suéltalo aquí — los nombres de columna no tienen que coincidir, los mapearás a continuación.') }}
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

    <div v-else-if="stage === 'mapping'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-line bg-surface p-4">
        <p class="text-sm font-medium text-ink-900">{{ fileName }}</p>
        <p class="mt-1 text-sm text-ink-muted2">{{ t(`${rawRows.length} rows detected.`, `${rawRows.length} filas detectadas.`) }}</p>
      </div>

      <div class="overflow-hidden rounded-lg border border-line bg-surface">
        <table class="w-full text-sm">
          <thead class="border-b border-line bg-surface-subtle text-left text-xs font-medium uppercase tracking-wide text-ink-muted2">
            <tr>
              <th class="px-3 py-2">{{ t('QuiroFlow field', 'Campo de QuiroFlow') }}</th>
              <th class="px-3 py-2">{{ t('Column in your file', 'Columna en tu archivo') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <tr v-for="field in TARGET_FIELDS" :key="field.key">
              <td class="px-3 py-2 text-ink-900">
                {{ field.label }}
                <span v-if="field.required" class="text-danger-text">*</span>
              </td>
              <td class="px-3 py-2">
                <select
                  v-model="mapping[field.key]"
                  class="w-full rounded-md border border-line-control bg-surface px-2 py-1.5 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                >
                  <option value="">{{ t('— Not in file —', '— No está en el archivo —') }}</option>
                  <option v-for="h in headers" :key="h" :value="h">{{ h }}</option>
                </select>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!mappingComplete" class="text-sm text-danger-text">{{ t('Map at least First name to continue.', 'Mapea al menos Nombre para continuar.') }}</p>

      <div>
        <label class="block text-sm font-medium text-ink-700">{{ t('Import into clinic', 'Importar a la clínica') }}</label>
        <select
          v-model="targetClinicId"
          class="mt-1 w-full max-w-xs rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          @change="clinicManuallySet = true"
        >
          <option value="">{{ t('No primary clinic', 'Sin clínica principal') }}</option>
          <option v-for="c in store.clinics" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>

      <div class="flex gap-3">
        <button
          type="button"
          :disabled="!mappingComplete"
          class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
          @click="confirmMapping"
        >
          {{ t('Continue', 'Continuar') }}
        </button>
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="reset">
          {{ t('Cancel', 'Cancelar') }}
        </button>
      </div>
    </div>

    <div v-else-if="stage === 'preview'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-line bg-surface p-4">
        <p class="text-sm font-medium text-ink-900">{{ fileName }}</p>
        <dl class="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div><dt class="text-ink-muted2">{{ t('Total rows', 'Filas totales') }}</dt><dd class="font-medium text-ink-900">{{ totalRows }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('Will import', 'Se importarán') }}</dt><dd class="font-medium text-success-text">{{ toImport.length }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('Will update', 'Se actualizarán') }}</dt><dd class="font-medium text-brand-text">{{ toUpdate.length }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('No changes / no name', 'Sin cambios / sin nombre') }}</dt><dd class="font-medium text-ink-900">{{ skippedDuplicate + skippedNoName }}</dd></div>
        </dl>
      </div>

      <div class="overflow-hidden rounded-lg border border-line bg-surface">
        <table class="w-full text-sm">
          <thead class="border-b border-line bg-surface-subtle text-left text-xs font-medium uppercase tracking-wide text-ink-muted2">
            <tr>
              <th class="px-3 py-2">{{ t('Name', 'Nombre') }}</th>
              <th class="px-3 py-2">{{ t('Email', 'Correo electrónico') }}</th>
              <th class="px-3 py-2">{{ t('City', 'Ciudad') }}</th>
              <th class="px-3 py-2">{{ t('Tags', 'Etiquetas') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <tr v-for="(row, i) in toImport.slice(0, 10)" :key="i">
              <td class="px-3 py-2 text-ink-900">{{ row.patient.first_name }} {{ row.patient.last_name }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ row.patient.email ?? t('N/A', 'N/D') }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ row.patient.city ?? t('N/A', 'N/D') }}</td>
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
          {{ t('Sample of changes to existing patients', 'Muestra de cambios en pacientes existentes') }}
        </div>
        <table class="w-full text-sm">
          <thead class="border-b border-line bg-surface-subtle text-left text-xs font-medium uppercase tracking-wide text-ink-muted2">
            <tr>
              <th class="px-3 py-2">{{ t('Patient', 'Paciente') }}</th>
              <th class="px-3 py-2">{{ t('Field', 'Campo') }}</th>
              <th class="px-3 py-2">{{ t('Current', 'Actual') }}</th>
              <th class="px-3 py-2">{{ t('New', 'Nuevo') }}</th>
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
          + {{ toUpdate.length - 5 }} {{ t('more patients to update', 'pacientes más para actualizar') }}
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
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="stage = 'mapping'">
          {{ t('Back to mapping', 'Volver al mapeo') }}
        </button>
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="reset">
          {{ t('Cancel', 'Cancelar') }}
        </button>
      </div>
    </div>

    <div v-else-if="stage === 'importing'" class="mt-4 rounded-lg border border-line bg-surface p-8 text-center">
      <p class="text-sm text-ink-600">
        {{ t(`Importing… ${importedCount + updatedCount} / ${toImport.length + toUpdate.length}`, `Importando… ${importedCount + updatedCount} / ${toImport.length + toUpdate.length}`) }}
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
      <div class="rounded-lg border border-success-border bg-success-bg p-4 text-sm text-success-text">
        {{ t(`Imported ${importedCount} patients. Updated ${updatedCount} existing patients.`, `Se importaron ${importedCount} pacientes. Se actualizaron ${updatedCount} pacientes existentes.`) }}
      </div>
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

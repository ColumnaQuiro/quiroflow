<script setup lang="ts">
import Papa from 'papaparse'
import type { TablesInsert } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

type CsvRow = Record<string, string>

interface MappedPatient {
  patient: TablesInsert<'patients'>
  numbers: { country_code: string; number: string; is_whatsapp: boolean }[]
  sourceRow: number
}

const stage = ref<'pick' | 'preview' | 'importing' | 'done'>('pick')
const dragOver = ref(false)
const fileError = ref('')
const fileName = ref('')

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
const skippedDuplicate = ref(0)
const skippedDeleted = ref(0)
const skippedNoName = ref(0)
const totalRows = ref(0)

const importing = ref(false)
const importedCount = ref(0)
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

function buildMarketingChannels(row: CsvRow): string[] {
  const channels: string[] = []
  if (row['SMS Marketing'] === '1') channels.push('sms')
  if (row['Email Marketing'] === '1') channels.push('email')
  if (row['Other Marketing'] === '1') channels.push('other')
  return channels
}

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

  const rows = parsed.data
  totalRows.value = rows.length

  const existingEmails = new Set<string>()
  const existingRefs = new Set<string>()
  const PAGE_SIZE = 1000
  for (let page = 0; ; page++) {
    const { data: existing } = await supabase
      .from('patients')
      .select('email, external_reference')
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    for (const p of existing ?? []) {
      if (p.email) existingEmails.add(p.email.toLowerCase())
      if (p.external_reference) existingRefs.add(p.external_reference)
    }
    if (!existing || existing.length < PAGE_SIZE) break
  }

  skippedDuplicate.value = 0
  skippedDeleted.value = 0
  skippedNoName.value = 0
  const mapped: MappedPatient[] = []

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
    if ((email && existingEmails.has(email.toLowerCase())) || (externalRef && existingRefs.has(externalRef))) {
      skippedDuplicate.value++
      return
    }

    const numbers: MappedPatient['numbers'] = []
    if (row['Mobile']?.trim()) numbers.push({ country_code: 'ES', number: row['Mobile'].trim(), is_whatsapp: false })
    if (row['Home']?.trim()) numbers.push({ country_code: 'ES', number: row['Home'].trim(), is_whatsapp: false })

    mapped.push({
      sourceRow: index + 2, // +1 for header, +1 for 1-index
      patient: {
        account_id: store.accountId!,
        clinic_id: targetClinicId.value || null,
        first_name: firstName,
        last_name: row['First Name']?.trim() ? row['Last Name']?.trim() || null : null,
        email: email || null,
        date_of_birth: row['Date of Birth']?.trim() || null,
        // Explicit fallback rather than an `undefined` value -- a bulk
        // insert's request body doesn't reliably strip an `undefined`-valued
        // key the way a single-object insert would, and a NULL landing on
        // this NOT NULL column fails the whole batch's insert.
        created_at: parseCreatedAt(row['Created'] || '') ?? new Date().toISOString(),
        balance_cents: parseBalanceCents(row['Account Balance'] || '0'),
        tags: row['Tags']?.trim() ? [row['Tags'].trim()] : [],
        referral_source: row['Referral Source']?.trim() || null,
        preferred_language: parseLanguage(row['Preferred Language'] || ''),
        notes: buildNotes(row),
        external_reference: externalRef || null,
        marketing_channels: buildMarketingChannels(row),
        default_practitioner_id: matchPractitioner(row['Default Practitioner'] || ''),
      },
      numbers,
    })
  })

  toImport.value = mapped
  stage.value = 'preview'
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

async function runImport() {
  importing.value = true
  stage.value = 'importing'
  importedCount.value = 0
  importErrors.value = []

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

  importing.value = false
  stage.value = 'done'
}

function reset() {
  stage.value = 'pick'
  fileName.value = ''
  fileError.value = ''
  toImport.value = []
  importedCount.value = 0
  importErrors.value = []
}
</script>

<template>
  <div>
    <p class="text-sm text-gray-500">
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
        :class="dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 bg-white'"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop.prevent="onDrop"
      >
        <p class="text-sm text-gray-600">{{ t('Drag and drop a CSV file here, or', 'Arrastra y suelta un archivo CSV aquí, o') }}</p>
        <label class="mt-2 cursor-pointer text-sm font-medium text-indigo-600 hover:text-indigo-500">
          {{ t('browse for a file', 'busca un archivo') }}
          <input type="file" accept=".csv" class="hidden" @change="onFileInput" />
        </label>
      </div>
      <p v-if="fileError" class="mt-2 text-sm text-red-600">{{ fileError }}</p>
    </div>

    <div v-else-if="stage === 'preview'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-gray-200 bg-white p-4">
        <p class="text-sm font-medium text-gray-900">{{ fileName }}</p>
        <dl class="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div><dt class="text-gray-500">{{ t('Total rows', 'Filas totales') }}</dt><dd class="font-medium text-gray-900">{{ totalRows }}</dd></div>
          <div><dt class="text-gray-500">{{ t('Will import', 'Se importarán') }}</dt><dd class="font-medium text-green-700">{{ toImport.length }}</dd></div>
          <div><dt class="text-gray-500">{{ t('Duplicates skipped', 'Duplicados omitidos') }}</dt><dd class="font-medium text-gray-900">{{ skippedDuplicate }}</dd></div>
          <div><dt class="text-gray-500">{{ t('Deleted/no-name skipped', 'Eliminados/sin nombre omitidos') }}</dt><dd class="font-medium text-gray-900">{{ skippedDeleted + skippedNoName }}</dd></div>
        </dl>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700">{{ t('Import into clinic', 'Importar a la clínica') }}</label>
        <select
          v-model="targetClinicId"
          class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          @change="clinicManuallySet = true"
        >
          <option value="">{{ t('No primary clinic', 'Sin clínica principal') }}</option>
          <option v-for="c in store.clinics" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>

      <div class="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table class="w-full text-sm">
          <thead class="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th class="px-3 py-2">{{ t('Name', 'Nombre') }}</th>
              <th class="px-3 py-2">{{ t('Email', 'Correo electrónico') }}</th>
              <th class="px-3 py-2">{{ t('Balance', 'Saldo') }}</th>
              <th class="px-3 py-2">{{ t('Language', 'Idioma') }}</th>
              <th class="px-3 py-2">{{ t('Tags', 'Etiquetas') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="(row, i) in toImport.slice(0, 10)" :key="i">
              <td class="px-3 py-2 text-gray-900">{{ row.patient.first_name }} {{ row.patient.last_name }}</td>
              <td class="px-3 py-2 text-gray-500">{{ row.patient.email ?? t('N/A', 'N/D') }}</td>
              <td class="px-3 py-2 text-gray-500">€{{ ((row.patient.balance_cents ?? 0) / 100).toFixed(2) }}</td>
              <td class="px-3 py-2 text-gray-500">{{ row.patient.preferred_language }}</td>
              <td class="px-3 py-2 text-gray-500">{{ (row.patient.tags ?? []).join(', ') || t('N/A', 'N/D') }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="toImport.length > 10" class="border-t border-gray-100 px-3 py-2 text-xs text-gray-400">
          + {{ toImport.length - 10 }} {{ t('more rows', 'filas más') }}
        </p>
      </div>

      <div class="flex gap-3">
        <button
          type="button"
          :disabled="toImport.length === 0"
          class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          @click="runImport"
        >
          {{ t(`Import ${toImport.length} patients`, `Importar ${toImport.length} pacientes`) }}
        </button>
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50" @click="reset">
          {{ t('Cancel', 'Cancelar') }}
        </button>
      </div>
    </div>

    <div v-else-if="stage === 'importing'" class="mt-4 rounded-lg border border-gray-200 bg-white p-8 text-center">
      <p class="text-sm text-gray-600">{{ t(`Importing… ${importedCount} / ${toImport.length}`, `Importando… ${importedCount} / ${toImport.length}`) }}</p>
    </div>

    <div v-else-if="stage === 'done'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
        {{ t(`Imported ${importedCount} patients.`, `Se importaron ${importedCount} pacientes.`) }}
      </div>
      <div v-if="importErrors.length > 0" class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p class="font-medium">{{ t('Some rows failed:', 'Algunas filas fallaron:') }}</p>
        <ul class="mt-1 list-disc pl-5">
          <li v-for="(e, i) in importErrors" :key="i">{{ e }}</li>
        </ul>
      </div>
      <div class="flex gap-3">
        <NuxtLink to="/patients" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          {{ t('View Patients', 'Ver pacientes') }}
        </NuxtLink>
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50" @click="reset">
          {{ t('Import another file', 'Importar otro archivo') }}
        </button>
      </div>
    </div>
  </div>
</template>

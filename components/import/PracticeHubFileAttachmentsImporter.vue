<script setup lang="ts">
import Papa from 'papaparse'
import type { TablesInsert } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

type CsvRow = Record<string, string>

interface MappedFile {
  file: TablesInsert<'patient_files'>
  patientLabel: string
  sourceRow: number
}

const stage = ref<'pick' | 'preview' | 'importing' | 'done'>('pick')
const dragOver = ref(false)
const fileError = ref('')
const fileName = ref('')

const toImport = ref<MappedFile[]>([])
const skippedDuplicate = ref(0)
const skippedUnmatched = ref(0)
const totalRows = ref(0)

const importing = ref(false)
const importedCount = ref(0)
const importErrors = ref<string[]>([])

function parseSize(value: string): number | null {
  const n = parseInt(value, 10)
  return Number.isFinite(n) ? n : null
}

function parseDate(value: string): string | undefined {
  if (!value?.trim()) return undefined
  const d = new Date(value.trim().replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '')
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

  // PracticeHub's File Attachments export identifies patients by their raw
  // internal numeric ID ("Patient Unique Identifier"), but the Patients
  // export (and our external_reference) uses their formatted "Patient
  // Number" instead -- a different value for the same patient. There's no
  // shared ID to join on, so match by phone number (most reliable — present
  // on nearly every row and already imported into patient_contact_numbers),
  // falling back to email, then to name if it's unique.
  interface PatientMatch { id: string; label: string }
  const patientById = new Map<string, PatientMatch>()
  const byEmail = new Map<string, PatientMatch>()
  const byPhone = new Map<string, PatientMatch[]>()
  const byName = new Map<string, PatientMatch[]>()
  const existingFileRefs = new Set<string>()
  const PAGE_SIZE = 1000

  for (let page = 0; ; page++) {
    const { data: existing } = await supabase
      .from('patients')
      .select('id, first_name, last_name, email')
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    for (const p of existing ?? []) {
      const match: PatientMatch = { id: p.id, label: `${p.first_name} ${p.last_name ?? ''}`.trim() }
      patientById.set(p.id, match)
      if (p.email) byEmail.set(p.email.toLowerCase(), match)
      const nameKey = match.label.toLowerCase()
      if (nameKey) byName.set(nameKey, [...(byName.get(nameKey) ?? []), match])
    }
    if (!existing || existing.length < PAGE_SIZE) break
  }

  // Phone numbers aren't guaranteed unique per patient (household numbers,
  // duplicate records from repeated historical imports), so a number can
  // legitimately point at more than one patient -- keep every candidate
  // rather than letting a later row silently overwrite an earlier match.
  for (let page = 0; ; page++) {
    const { data: existing } = await supabase
      .from('patient_contact_numbers')
      .select('number, patient_id')
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    for (const n of existing ?? []) {
      const match = patientById.get(n.patient_id)
      if (!match) continue
      const key = normalizePhone(n.number)
      const list = byPhone.get(key) ?? []
      if (!list.some((m) => m.id === match.id)) list.push(match)
      byPhone.set(key, list)
    }
    if (!existing || existing.length < PAGE_SIZE) break
  }

  for (let page = 0; ; page++) {
    const { data: existing } = await supabase
      .from('patient_files')
      .select('external_reference')
      .not('external_reference', 'is', null)
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    for (const f of existing ?? []) {
      if (f.external_reference) existingFileRefs.add(f.external_reference)
    }
    if (!existing || existing.length < PAGE_SIZE) break
  }

  function nameKeyOf(row: CsvRow): string {
    return `${row['Patient First Name']?.trim() ?? ''} ${row['Patient Last Name']?.trim() ?? ''}`.trim().toLowerCase()
  }

  // Resolves a list of same-number candidates down to one using the row's
  // name as a tiebreaker; returns undefined (rather than guessing) if that
  // still doesn't narrow it to exactly one patient.
  function disambiguate(candidates: PatientMatch[], row: CsvRow): PatientMatch | undefined {
    if (candidates.length === 1) return candidates[0]
    const nameKey = nameKeyOf(row)
    const byNameWithinCandidates = candidates.filter((c) => c.label.toLowerCase() === nameKey)
    return byNameWithinCandidates.length === 1 ? byNameWithinCandidates[0] : undefined
  }

  function matchPatient(row: CsvRow): PatientMatch | undefined {
    const email = row['Patient Email']?.trim().toLowerCase()
    if (email && byEmail.has(email)) return byEmail.get(email)

    const mobile = row['Mobile Number']?.trim()
    const mobileCandidates = mobile ? byPhone.get(normalizePhone(mobile)) : undefined
    if (mobileCandidates) {
      const match = disambiguate(mobileCandidates, row)
      if (match) return match
    }

    const home = row['Home Number']?.trim()
    const homeCandidates = home ? byPhone.get(normalizePhone(home)) : undefined
    if (homeCandidates) {
      const match = disambiguate(homeCandidates, row)
      if (match) return match
    }

    const nameKey = nameKeyOf(row)
    const nameMatches = nameKey ? byName.get(nameKey) : undefined
    if (nameMatches?.length === 1) return nameMatches[0]

    return undefined
  }

  skippedDuplicate.value = 0
  skippedUnmatched.value = 0
  const mapped: MappedFile[] = []

  rows.forEach((row, index) => {
    const fileId = row['File ID']?.trim() || ''
    if (fileId && existingFileRefs.has(fileId)) {
      skippedDuplicate.value++
      return
    }

    const patient = matchPatient(row)
    if (!patient) {
      skippedUnmatched.value++
      return
    }

    mapped.push({
      sourceRow: index + 2,
      patientLabel: patient.label,
      file: {
        account_id: store.accountId!,
        patient_id: patient.id,
        file_name: row['Filename']?.trim() || t('Untitled', 'Sin título'),
        file_type: row['Mime Type']?.trim() || null,
        size_bytes: parseSize(row['Size (bytes)'] || ''),
        external_reference: fileId || null,
        storage_path: null,
        created_at: parseDate(row['Created'] || ''),
      },
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

  const CHUNK_SIZE = 200
  for (let i = 0; i < toImport.value.length; i += CHUNK_SIZE) {
    const chunk = toImport.value.slice(i, i + CHUNK_SIZE)
    const { data: inserted, error } = await supabase
      .from('patient_files')
      .insert(chunk.map((c) => c.file))
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
  }

  importing.value = false
  stage.value = 'done'
  showToast(
    t(`Imported ${importedCount.value} file records.`, `Se importaron ${importedCount.value} registros de archivos.`),
    importErrors.value.length > 0 ? 'error' : 'success',
  )
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
    <p class="text-sm text-ink-muted2">
      {{
        t(
          "Export \"File Attachments - List\" as CSV from PracticeHub (Reports → Data Exports), then drop it here. Patients must already be imported first, since files are matched by PracticeHub's patient ID. PracticeHub's export only lists file metadata (name, size, type) — it doesn't include the actual file content, so these import as placeholder records; the real files need to be attached per patient afterward from their Files tab.",
          'Exporta "File Attachments - List" como CSV desde PracticeHub (Reports → Data Exports) y luego suéltalo aquí. Los pacientes deben haberse importado ya, puesto que los archivos se emparejan por el ID de paciente de PracticeHub. La exportación de PracticeHub solo incluye los metadatos del archivo (nombre, tamaño, tipo); no incluye el contenido real del archivo, así que se importan como registros de marcador de posición; los archivos reales deberán adjuntarse por paciente después desde su pestaña de archivos.',
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
        <dl class="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div><dt class="text-ink-muted2">{{ t('Total rows', 'Filas totales') }}</dt><dd class="font-medium text-ink-900">{{ totalRows }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('Will import', 'Se importarán') }}</dt><dd class="font-medium text-success-text">{{ toImport.length }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('Already imported', 'Ya importados') }}</dt><dd class="font-medium text-ink-900">{{ skippedDuplicate }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('No matching patient', 'Sin paciente coincidente') }}</dt><dd class="font-medium text-ink-900">{{ skippedUnmatched }}</dd></div>
        </dl>
      </div>

      <div class="overflow-hidden rounded-lg border border-line bg-surface">
        <table class="w-full text-sm">
          <thead class="border-b border-line bg-surface-subtle text-left text-xs font-medium uppercase tracking-wide text-ink-muted2">
            <tr>
              <th class="px-3 py-2">{{ t('Patient', 'Paciente') }}</th>
              <th class="px-3 py-2">{{ t('Filename', 'Nombre de archivo') }}</th>
              <th class="px-3 py-2">{{ t('Type', 'Tipo') }}</th>
              <th class="px-3 py-2">{{ t('Size', 'Tamaño') }}</th>
              <th class="px-3 py-2">{{ t('Created', 'Creado') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <tr v-for="(row, i) in toImport.slice(0, 10)" :key="i">
              <td class="px-3 py-2 text-ink-900">{{ row.patientLabel }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ row.file.file_name }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ row.file.file_type ?? t('N/A', 'N/D') }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ row.file.size_bytes ? `${(row.file.size_bytes / 1024).toFixed(0)} KB` : t('N/A', 'N/D') }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ row.file.created_at ? new Date(row.file.created_at).toLocaleDateString() : t('N/A', 'N/D') }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="toImport.length > 10" class="border-t border-line-divider px-3 py-2 text-xs text-ink-faint">
          + {{ toImport.length - 10 }} {{ t('more rows', 'filas más') }}
        </p>
      </div>

      <div class="flex gap-3">
        <button
          type="button"
          :disabled="toImport.length === 0"
          class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
          @click="runImport"
        >
          {{ t(`Import ${toImport.length} file records`, `Importar ${toImport.length} registros de archivos`) }}
        </button>
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="reset">
          {{ t('Cancel', 'Cancelar') }}
        </button>
      </div>
    </div>

    <div v-else-if="stage === 'importing'" class="mt-4 rounded-lg border border-line bg-surface p-8 text-center">
      <p class="text-sm text-ink-600">{{ t(`Importing… ${importedCount} / ${toImport.length}`, `Importando… ${importedCount} / ${toImport.length}`) }}</p>
    </div>

    <div v-else-if="stage === 'done'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-line bg-surface-subtle p-4 text-sm text-ink-muted2">
        {{
          t(
            'These are placeholders (name/size/type known, content not yet attached) — PracticeHub has no bulk file-download API, so pulling in the actual content is a separate step.',
            'Son marcadores de posición (se conoce el nombre/tamaño/tipo, el contenido aún no está adjunto); PracticeHub no tiene una API de descarga masiva de archivos, así que traer el contenido real es un paso aparte.',
          )
        }}
        {{ t('Head to', 'Ve a') }}
        <NuxtLink to="/settings/migrate-attachments" class="font-medium text-brand-text underline">{{ t('Settings → Migrate Attachments', 'Ajustes → Migrar archivos adjuntos') }}</NuxtLink>
        {{ t('for the download and instructions.', 'para la descarga y las instrucciones.') }}
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

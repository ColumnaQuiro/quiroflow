<script setup lang="ts">
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

interface SoapItem { key?: string; val?: string; label?: string; value?: string }
interface PHClinicalNote {
  id: number
  patient_id: number
  state: string
  type: string
  data: { soap_data?: SoapItem[] } | null
  created: string
}

interface NoteCandidate {
  patientLabel: string
  type: string
  created: string
  row: {
    account_id: string
    patient_id: string
    action: string
    note: string
    external_reference: string
    created_at: string
  }
}

const stage = ref<'connect' | 'scanning' | 'preview' | 'importing' | 'done' | 'error'>('connect')
const phase = ref('')
const progress = ref({ done: 0, total: 0 })
const runError = ref('')
const lastConn = ref<{ baseUrl: string; apiKey: string; appDetails: string } | null>(null)

const candidates = ref<NoteCandidate[]>([])
const skippedDuplicate = ref(0)
const skippedUnmatched = ref(0)

const importedCount = ref(0)
const importErrors = ref<string[]>([])

function stripHtml(value: string): string {
  return value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
}

function formatNote(note: PHClinicalNote): string {
  const items = note.data?.soap_data ?? []
  const lines = items
    .map((item) => {
      const label = item.key ?? item.label ?? ''
      const value = stripHtml(item.val ?? item.value ?? '')
      return value ? `${label}: ${value}` : ''
    })
    .filter(Boolean)
  return lines.join('\n') || '(empty)'
}

function formatDate(value: string): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString()
}

function truncate(value: string): string {
  return value.length > 90 ? `${value.slice(0, 90)}…` : value
}

const previewColumns = computed(() => [
  { key: 'date', label: t('Date', 'Fecha') },
  { key: 'patient', label: t('Patient', 'Paciente') },
  { key: 'type', label: t('Type', 'Tipo') },
  { key: 'note', label: t('Note', 'Nota'), wrap: true },
])

const previewRows = computed(() =>
  candidates.value.map((c) => ({
    date: formatDate(c.created),
    patient: c.patientLabel,
    type: c.type,
    note: truncate(c.row.note),
  })),
)

const previewStats = computed(() => [
  { label: t('Will import', 'Se importarán'), value: candidates.value.length, tone: 'good' as const },
  { label: t('Already imported', 'Ya importadas'), value: skippedDuplicate.value },
  { label: t('No matching patient', 'Sin paciente coincidente'), value: skippedUnmatched.value },
])

async function run(conn: { baseUrl: string; apiKey: string; appDetails: string }) {
  lastConn.value = conn
  stage.value = 'scanning'
  runError.value = ''
  candidates.value = []
  skippedDuplicate.value = 0
  skippedUnmatched.value = 0
  importedCount.value = 0
  importErrors.value = []
  const api = usePracticeHubApi(conn)

  try {
    phase.value = t('Matching patients…', 'Emparejando pacientes…')
    const phPatients = await api.fetchAll<{ id: number; patient_number: string }>('/patients', (done, total) => (progress.value = { done, total }))
    const patientNumberById = new Map(phPatients.map((p) => [p.id, p.patient_number]))

    const PAGE_SIZE = 1000
    const ourPatientByRef = new Map<string, { id: string; label: string }>()
    for (let page = 0; ; page++) {
      const { data } = await supabase
        .from('patients')
        .select('id, external_reference, first_name, last_name')
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const p of data ?? [])
        if (p.external_reference)
          ourPatientByRef.set(p.external_reference, { id: p.id, label: `${p.first_name} ${p.last_name ?? ''}`.trim() })
      if (!data || data.length < PAGE_SIZE) break
    }

    phase.value = t('Checking for already-imported notes…', 'Comprobando notas ya importadas…')
    const existingRefs = new Set<string>()
    for (let page = 0; ; page++) {
      const { data } = await supabase
        .from('contact_log')
        .select('external_reference')
        .not('external_reference', 'is', null)
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const c of data ?? []) if (c.external_reference) existingRefs.add(c.external_reference)
      if (!data || data.length < PAGE_SIZE) break
    }

    phase.value = t('Fetching clinical notes…', 'Obteniendo notas clínicas…')
    progress.value = { done: 0, total: 0 }
    const notes = await api.fetchAll<PHClinicalNote>('/clinical_notes', (done, total) => (progress.value = { done, total }))

    const planned: NoteCandidate[] = []
    for (const note of notes) {
      const ref = `PH-clinicalnote-${note.id}`
      if (existingRefs.has(ref)) {
        skippedDuplicate.value++
        continue
      }
      const patientNumber = patientNumberById.get(note.patient_id)
      const patient = patientNumber ? ourPatientByRef.get(patientNumber) : undefined
      if (!patient) {
        skippedUnmatched.value++
        continue
      }
      planned.push({
        patientLabel: patient.label,
        type: note.type,
        created: note.created,
        row: {
          account_id: store.accountId!,
          patient_id: patient.id,
          action: 'other',
          note: `[clinical_note/${note.type}] ${formatNote(note)}`,
          external_reference: ref,
          created_at: note.created,
        },
      })
    }

    candidates.value = planned
    stage.value = 'preview'
  } catch (err) {
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
  }
}

async function apply() {
  stage.value = 'importing'
  importedCount.value = 0
  importErrors.value = []
  progress.value = { done: 0, total: candidates.value.length }

  try {
    const CHUNK_SIZE = 200
    for (let i = 0; i < candidates.value.length; i += CHUNK_SIZE) {
      const rows = candidates.value.slice(i, i + CHUNK_SIZE).map((c) => c.row)
      const { error } = await supabase.from('contact_log').insert(rows)
      if (error) importErrors.value.push(`Notes near row ${i}: ${error.message}`)
      else importedCount.value += rows.length
      progress.value = { done: Math.min(i + CHUNK_SIZE, candidates.value.length), total: candidates.value.length }
    }
  } catch (err) {
    // Re-running is safe: notes already written are skipped as duplicates on
    // the next scan, so surfacing the error beats a stuck "Importing…".
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
    return
  }

  stage.value = 'done'
  showToast(
    t(
      `Imported ${importedCount.value} clinical notes. Skipped ${skippedDuplicate.value} already-imported, ${skippedUnmatched.value} with no matching patient.`,
      `Se importaron ${importedCount.value} notas clínicas. Se omitieron ${skippedDuplicate.value} ya importadas, ${skippedUnmatched.value} sin paciente coincidente.`,
    ),
    importErrors.value.length > 0 ? 'error' : 'success',
  )
}

function retryRun() {
  if (lastConn.value) run(lastConn.value)
}

function reset() {
  stage.value = 'connect'
  candidates.value = []
  importedCount.value = 0
  skippedDuplicate.value = 0
  skippedUnmatched.value = 0
  importErrors.value = []
  progress.value = { done: 0, total: 0 }
}
</script>

<template>
  <div>
    <p class="text-sm text-ink-muted2">
      {{
        t(
          "Pulls clinical/SOAP notes directly from PracticeHub's API into each patient's contact log here. Nothing is written until you review the summary and confirm. Safe to re-run — already-imported notes are skipped.",
          'Obtiene las notas clínicas/SOAP directamente de la API de PracticeHub y las añade al registro de contacto de cada paciente. No se escribe nada hasta que revises el resumen y confirmes. Se puede volver a ejecutar sin riesgo: las notas ya importadas se omiten.',
        )
      }}
    </p>

    <div v-if="stage === 'connect'" class="mt-4 max-w-md">
      <ImportPracticeHubConnectForm @connect="run" />
    </div>

    <div v-else-if="stage === 'scanning' || stage === 'importing'" class="mt-4 rounded-lg border border-line bg-surface p-8 text-center">
      <p class="text-sm text-ink-600">{{ stage === 'importing' ? t('Importing…', 'Importando…') : phase }}</p>
      <p v-if="progress.total > 0" class="mt-1 text-xs text-ink-faint">{{ progress.done }} / {{ progress.total }}</p>
    </div>

    <ImportPreviewPanel
      v-else-if="stage === 'preview'"
      class="mt-4"
      :stats="previewStats"
      :columns="previewColumns"
      :rows="previewRows"
      :apply-label="t(`Import ${candidates.length} note(s)`, `Importar ${candidates.length} nota(s)`)"
      :more-label="t('more notes', 'notas más')"
      @apply="apply"
      @cancel="reset"
    />

    <div v-else-if="stage === 'error'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
        <p class="font-medium">{{ t('Import failed:', 'Error al importar:') }}</p>
        <p class="mt-1">{{ runError }}</p>
      </div>
      <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover" @click="retryRun">
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
          {{ t('Run again', 'Ejecutar de nuevo') }}
        </button>
      </div>
    </div>
  </div>
</template>

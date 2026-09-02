<script setup lang="ts">
import type { DocField } from '~/utils/docFields'

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

interface PHFormField { name: string; value: string; label: string; help_text?: string }
interface PHFormResponse {
  id: number
  form_id: string
  form_name: string
  patient_id: string
  data: PHFormField[]
  created: string
}

const stage = ref<'connect' | 'importing' | 'done'>('connect')
const phase = ref('')
const progress = ref({ done: 0, total: 0 })

const importedCount = ref(0)
const skippedDuplicate = ref(0)
const skippedUnmatched = ref(0)
const importErrors = ref<string[]>([])

function stripHtml(value: string): string {
  return value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
}

// PracticeHub's custom form export gives raw {name, value, label} rows with
// no explicit type -- these were originally captured via a form builder, so
// we infer the block type from the field's internal name and shape it into
// our own DocField format. There's no real signature image in this data
// (just an internal widget id), so a signature field becomes a text note
// recording that it was signed, rather than a fake filled-in pad.
function mapField(f: PHFormField): DocField {
  const key = f.name.toLowerCase()
  const text = stripHtml(f.value ?? '')

  if (key.includes('signature')) {
    return { id: crypto.randomUUID(), type: 'text', label: `${f.label || 'Signature'}: signed (via PracticeHub)`, value: null }
  }
  if (key.includes('sketchpad') || key.includes('drawableimage') || key.includes('image')) {
    return { id: crypto.randomUUID(), type: 'text', label: `${f.label || 'Diagram'}: drawing captured (not available via PracticeHub's API)`, value: null }
  }
  if (key.includes('date')) {
    return { id: crypto.randomUUID(), type: 'date', label: f.label || 'Date', value: f.value || null }
  }
  if (key.includes('checkbox')) {
    return { id: crypto.randomUUID(), type: 'checkbox', label: f.label || text || 'Consent', value: !!f.value }
  }
  if (!f.label && text.length > 120) {
    // Static legal/informational paragraph, not an actual answer.
    return { id: crypto.randomUUID(), type: 'text', label: text, value: null }
  }
  return {
    id: crypto.randomUUID(),
    type: text.length > 80 ? 'long_text' : 'short_text',
    label: f.label || 'Answer',
    value: text || null,
  }
}

async function run(conn: { baseUrl: string; apiKey: string; appDetails: string }) {
  stage.value = 'importing'
  const api = usePracticeHubApi(conn)

  phase.value = t('Matching patients…', 'Emparejando pacientes…')
  const phPatients = await api.fetchAll<{ id: number; patient_number: string }>('/patients', (done, total) => (progress.value = { done, total }))
  const patientNumberById = new Map(phPatients.map((p) => [String(p.id), p.patient_number]))

  const PAGE_SIZE = 1000
  const ourPatientByRef = new Map<string, string>()
  for (let page = 0; ; page++) {
    const { data } = await supabase.from('patients').select('id, external_reference').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    for (const p of data ?? []) if (p.external_reference) ourPatientByRef.set(p.external_reference, p.id)
    if (!data || data.length < PAGE_SIZE) break
  }

  phase.value = t('Checking for already-imported forms…', 'Comprobando formularios ya importados…')
  const existingRefs = new Set<string>()
  for (let page = 0; ; page++) {
    const { data } = await supabase
      .from('patient_docs')
      .select('external_reference')
      .not('external_reference', 'is', null)
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    for (const d of data ?? []) if (d.external_reference) existingRefs.add(d.external_reference)
    if (!data || data.length < PAGE_SIZE) break
  }

  phase.value = t('Fetching form responses…', 'Obteniendo respuestas de formularios…')
  progress.value = { done: 0, total: 0 }
  const responses = await api.fetchAll<PHFormResponse>('/custom_form_responses', (done, total) => (progress.value = { done, total }))

  phase.value = t('Importing…', 'Importando…')
  progress.value = { done: 0, total: responses.length }

  const CHUNK_SIZE = 100
  for (let i = 0; i < responses.length; i += CHUNK_SIZE) {
    const chunk = responses.slice(i, i + CHUNK_SIZE)
    const rows = []
    for (const r of chunk) {
      const ref = `PH-form-${r.id}`
      if (existingRefs.has(ref)) {
        skippedDuplicate.value++
        continue
      }
      const patientNumber = patientNumberById.get(r.patient_id)
      const patientId = patientNumber ? ourPatientByRef.get(patientNumber) : undefined
      if (!patientId) {
        skippedUnmatched.value++
        continue
      }
      rows.push({
        account_id: store.accountId!,
        patient_id: patientId,
        title: r.form_name,
        fields: (r.data ?? []).map(mapField),
        completed_at: r.created,
        external_reference: ref,
        created_at: r.created,
      })
    }

    if (rows.length > 0) {
      const { error } = await supabase.from('patient_docs').insert(rows)
      if (error) {
        importErrors.value.push(t(`Forms near row ${i}: ${error.message}`, `Formularios cerca de la fila ${i}: ${error.message}`))
      } else {
        importedCount.value += rows.length
      }
    }

    progress.value = { done: Math.min(i + CHUNK_SIZE, responses.length), total: responses.length }
  }

  stage.value = 'done'
}

function reset() {
  stage.value = 'connect'
  importedCount.value = 0
  skippedDuplicate.value = 0
  skippedUnmatched.value = 0
  importErrors.value = []
  progress.value = { done: 0, total: 0 }
}
</script>

<template>
  <div>
    <p class="text-sm text-gray-500">
      {{
        t(
          "Pulls submitted custom forms (consent forms, health questionnaires, signed documents) directly from PracticeHub's API into each patient's Docs tab here. Safe to re-run — already-imported forms are skipped.",
          'Obtiene los formularios personalizados enviados (formularios de consentimiento, cuestionarios de salud, documentos firmados) directamente de la API de PracticeHub y los añade a la pestaña de documentos de cada paciente. Se puede volver a ejecutar sin riesgo: los formularios ya importados se omiten.',
        )
      }}
    </p>

    <div v-if="stage === 'connect'" class="mt-4 max-w-md">
      <ImportPracticeHubConnectForm @connect="run" />
    </div>

    <div v-else-if="stage === 'importing'" class="mt-4 rounded-lg border border-gray-200 bg-white p-8 text-center">
      <p class="text-sm text-gray-600">{{ phase }}</p>
      <p v-if="progress.total > 0" class="mt-1 text-xs text-gray-400">{{ progress.done }} / {{ progress.total }}</p>
    </div>

    <div v-else-if="stage === 'done'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
        {{
          t(
            `Imported ${importedCount} forms. Skipped ${skippedDuplicate} already-imported, ${skippedUnmatched} with no matching patient.`,
            `Se importaron ${importedCount} formularios. Se omitieron ${skippedDuplicate} ya importados, ${skippedUnmatched} sin paciente coincidente.`,
          )
        }}
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
          {{ t('Run again', 'Ejecutar de nuevo') }}
        </button>
      </div>
    </div>
  </div>
</template>

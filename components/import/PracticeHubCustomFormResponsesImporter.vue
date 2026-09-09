<script setup lang="ts">
import type { DocField } from '~/utils/docFields'
import type { Json } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

interface PHFormField { name: string; value: string; label: string; help_text?: string }
interface PHFormResponse {
  id: number
  form_id: string
  form_name: string
  patient_id: string
  data: PHFormField[]
  created: string
}

interface FormCandidate {
  response: PHFormResponse
  patientId: string
  patientLabel: string
  externalRef: string
}

interface TemplateCandidate {
  formId: string
  formName: string
  fields: DocField[]
}

const stage = ref<'connect' | 'scanning' | 'preview' | 'importing' | 'done' | 'error'>('connect')
const phase = ref('')
const progress = ref({ done: 0, total: 0 })
const runError = ref('')
const lastConn = ref<{ baseUrl: string; apiKey: string; appDetails: string } | null>(null)

const candidates = ref<FormCandidate[]>([])
const newTemplates = ref<TemplateCandidate[]>([])
// Templates that already exist here, keyed by PracticeHub form_id -- filled
// during the scan and topped up with the ones apply() creates.
const existingTemplateIdByFormId = ref(new Map<string, string>())
const skippedDuplicate = ref(0)
const skippedUnmatched = ref(0)

const importedCount = ref(0)
const templatesCreated = ref(0)
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
//
// blank=true produces the TEMPLATE's copy of this field (see
// buildTemplateFields below): same label/type, but with any actual answer
// stripped out, since a template is what gets reused for a patient who
// never answered anything. Static content (headings, legal paragraphs,
// the signature/sketchpad notes) already carries no real answer in `value`
// either way, so blank only changes date/checkbox/text-answer fields.
function mapField(f: PHFormField, blank = false): DocField {
  const key = f.name.toLowerCase()
  const text = stripHtml(f.value ?? '')

  if (key.includes('signature')) {
    return { id: crypto.randomUUID(), type: 'text', label: `${f.label || 'Signature'}: signed (via PracticeHub)`, value: null }
  }
  if (key.includes('sketchpad') || key.includes('drawableimage') || key.includes('image')) {
    return { id: crypto.randomUUID(), type: 'text', label: `${f.label || 'Diagram'}: drawing captured (not available via PracticeHub's API)`, value: null }
  }
  if (key.includes('date')) {
    return { id: crypto.randomUUID(), type: 'date', label: f.label || 'Date', value: blank ? null : f.value || null }
  }
  if (key.includes('checkbox')) {
    return { id: crypto.randomUUID(), type: 'checkbox', label: f.label || text || 'Consent', value: blank ? false : !!f.value }
  }
  if (!f.label && text.length > 120) {
    // Static legal/informational paragraph, not an actual answer.
    return { id: crypto.randomUUID(), type: 'text', label: text, value: null }
  }
  return {
    id: crypto.randomUUID(),
    type: text.length > 80 ? 'long_text' : 'short_text',
    label: f.label || 'Answer',
    value: blank ? null : text || null,
  }
}

function buildTemplateFields(data: PHFormField[]): DocField[] {
  return (data ?? []).map((f) => mapField(f, true))
}

function formatDate(value: string): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString()
}

const previewColumns = computed(() => [
  { key: 'date', label: t('Date', 'Fecha') },
  { key: 'patient', label: t('Patient', 'Paciente') },
  { key: 'form', label: t('Form', 'Formulario') },
  { key: 'answers', label: t('Answers', 'Respuestas') },
])

const previewRows = computed(() =>
  candidates.value.map((c) => ({
    date: formatDate(c.response.created),
    patient: c.patientLabel,
    form: c.response.form_name,
    answers: String((c.response.data ?? []).length),
  })),
)

const previewStats = computed(() => [
  { label: t('Will import', 'Se importarán'), value: candidates.value.length, tone: 'good' as const },
  { label: t('New templates', 'Plantillas nuevas'), value: newTemplates.value.length },
  { label: t('Already imported', 'Ya importados'), value: skippedDuplicate.value },
  { label: t('No matching patient', 'Sin paciente coincidente'), value: skippedUnmatched.value },
])

async function run(conn: { baseUrl: string; apiKey: string; appDetails: string }) {
  lastConn.value = conn
  stage.value = 'scanning'
  runError.value = ''
  candidates.value = []
  newTemplates.value = []
  existingTemplateIdByFormId.value = new Map()
  skippedDuplicate.value = 0
  skippedUnmatched.value = 0
  importedCount.value = 0
  templatesCreated.value = 0
  importErrors.value = []
  const api = usePracticeHubApi(conn)

  try {
    phase.value = t('Matching patients…', 'Emparejando pacientes…')
    const phPatients = await api.fetchAll<{ id: number; patient_number: string }>('/patients', (done, total) => (progress.value = { done, total }))
    const patientNumberById = new Map(phPatients.map((p) => [String(p.id), p.patient_number]))

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

    // A response only ever tells us what ONE patient answered -- but the
    // form itself (its questions, in order) is the same for every patient
    // who filled it in. Without a template left behind, migrated forms only
    // ever exist as already-filled history: a patient who was never in
    // PracticeHub could never be sent "Protección de Datos" again, because
    // nothing reusable exists in Settings > Docs. One doc_templates row per
    // distinct PracticeHub form_id, built from the first response seen for
    // it, fixes that -- external_reference makes re-running this importer
    // safe instead of creating a duplicate template every time.
    phase.value = t('Checking for already-imported templates…', 'Comprobando plantillas ya importadas…')
    const { data: existingTemplates } = await supabase.from('doc_templates').select('id, external_reference').not('external_reference', 'is', null)
    const templateIdByRef = new Map((existingTemplates ?? []).map((tpl) => [tpl.external_reference as string, tpl.id]))
    const firstResponseByFormId = new Map<string, PHFormResponse>()
    for (const r of responses) if (!firstResponseByFormId.has(r.form_id)) firstResponseByFormId.set(r.form_id, r)

    const plannedTemplates: TemplateCandidate[] = []
    for (const [formId, sample] of firstResponseByFormId) {
      const existingId = templateIdByRef.get(`PH-form-template-${formId}`)
      if (existingId) existingTemplateIdByFormId.value.set(formId, existingId)
      else plannedTemplates.push({ formId, formName: sample.form_name, fields: buildTemplateFields(sample.data) })
    }

    const planned: FormCandidate[] = []
    for (const r of responses) {
      const ref = `PH-form-${r.id}`
      if (existingRefs.has(ref)) {
        skippedDuplicate.value++
        continue
      }
      const patientNumber = patientNumberById.get(r.patient_id)
      const patient = patientNumber ? ourPatientByRef.get(patientNumber) : undefined
      if (!patient) {
        skippedUnmatched.value++
        continue
      }
      planned.push({ response: r, patientId: patient.id, patientLabel: patient.label, externalRef: ref })
    }

    newTemplates.value = plannedTemplates
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
  templatesCreated.value = 0
  importErrors.value = []
  progress.value = { done: 0, total: candidates.value.length }

  try {
    const templateIdByFormId = new Map(existingTemplateIdByFormId.value)

    phase.value = t('Creating form templates…', 'Creando plantillas de formulario…')
    for (const tpl of newTemplates.value) {
      const { data: newTemplate, error } = await supabase
        .from('doc_templates')
        .insert({
          account_id: store.accountId!,
          title: tpl.formName,
          fields: tpl.fields as unknown as Json,
          external_reference: `PH-form-template-${tpl.formId}`,
        })
        .select('id')
        .single()
      if (error) {
        importErrors.value.push(`Template "${tpl.formName}": ${error.message}`)
        continue
      }
      templatesCreated.value++
      templateIdByFormId.set(tpl.formId, newTemplate.id)
    }

    phase.value = t('Importing…', 'Importando…')
    const CHUNK_SIZE = 100
    for (let i = 0; i < candidates.value.length; i += CHUNK_SIZE) {
      const rows = candidates.value.slice(i, i + CHUNK_SIZE).map((c) => ({
        account_id: store.accountId!,
        patient_id: c.patientId,
        template_id: templateIdByFormId.get(c.response.form_id) ?? null,
        title: c.response.form_name,
        fields: (c.response.data ?? []).map((f) => mapField(f)) as unknown as Json,
        completed_at: c.response.created,
        external_reference: c.externalRef,
        created_at: c.response.created,
      }))

      const { error } = await supabase.from('patient_docs').insert(rows)
      if (error) importErrors.value.push(`Forms near row ${i}: ${error.message}`)
      else importedCount.value += rows.length

      progress.value = { done: Math.min(i + CHUNK_SIZE, candidates.value.length), total: candidates.value.length }
    }
  } catch (err) {
    // Re-running is safe: forms and templates already written are skipped as
    // duplicates on the next scan, so surfacing the error beats a stuck
    // "Importing…".
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
    return
  }

  stage.value = 'done'
  showToast(
    t(
      `Imported ${importedCount.value} forms (${templatesCreated.value} new templates). Skipped ${skippedDuplicate.value} already-imported, ${skippedUnmatched.value} with no matching patient.`,
      `Se importaron ${importedCount.value} formularios (${templatesCreated.value} plantillas nuevas). Se omitieron ${skippedDuplicate.value} ya importados, ${skippedUnmatched.value} sin paciente coincidente.`,
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
  newTemplates.value = []
  existingTemplateIdByFormId.value = new Map()
  importedCount.value = 0
  skippedDuplicate.value = 0
  skippedUnmatched.value = 0
  templatesCreated.value = 0
  importErrors.value = []
  progress.value = { done: 0, total: 0 }
}
</script>

<template>
  <div>
    <p class="text-sm text-ink-muted2">
      {{
        t(
          "Pulls submitted custom forms (consent forms, health questionnaires, signed documents) directly from PracticeHub's API into each patient's Docs tab here, and creates a reusable template in Settings > Docs the first time it sees each distinct form — so it's ready to send to new patients too, not just imported history. Nothing is written until you review the summary and confirm. Safe to re-run — already-imported forms and templates are skipped.",
          'Obtiene los formularios personalizados enviados (formularios de consentimiento, cuestionarios de salud, documentos firmados) directamente de la API de PracticeHub y los añade a la pestaña de documentos de cada paciente, y crea una plantilla reutilizable en Ajustes > Documentos la primera vez que ve cada formulario distinto, lista para enviar también a pacientes nuevos, no solo como historial importado. No se escribe nada hasta que revises el resumen y confirmes. Se puede volver a ejecutar sin riesgo: los formularios y plantillas ya importados se omiten.',
        )
      }}
    </p>

    <div v-if="stage === 'connect'" class="mt-4 max-w-md">
      <ImportPracticeHubConnectForm @connect="run" />
    </div>

    <div v-else-if="stage === 'scanning' || stage === 'importing'" class="mt-4 rounded-lg border border-line bg-surface p-8 text-center">
      <p class="text-sm text-ink-600">{{ stage === 'importing' ? phase || t('Importing…', 'Importando…') : phase }}</p>
      <p v-if="progress.total > 0" class="mt-1 text-xs text-ink-faint">{{ progress.done }} / {{ progress.total }}</p>
    </div>

    <ImportPreviewPanel
      v-else-if="stage === 'preview'"
      class="mt-4"
      :stats="previewStats"
      :columns="previewColumns"
      :rows="previewRows"
      :allow-empty-apply="newTemplates.length > 0"
      :apply-label="t(`Import ${candidates.length} form(s)`, `Importar ${candidates.length} formulario(s)`)"
      :more-label="t('more forms', 'formularios más')"
      @apply="apply"
      @cancel="reset"
    >
      <template v-if="newTemplates.length > 0" #summary-footer>
        <div class="mt-3 border-t border-line-divider pt-2">
          <p class="text-xs font-medium uppercase tracking-wide text-ink-muted2">
            {{ t('Templates that will be created in Settings > Docs', 'Plantillas que se crearán en Ajustes > Documentos') }}
          </p>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <span v-for="tpl in newTemplates" :key="tpl.formId" class="rounded-pill bg-surface-subtle px-2 py-0.5 text-[11px] text-ink-700">
              {{ tpl.formName }}
            </span>
          </div>
        </div>
      </template>
    </ImportPreviewPanel>

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

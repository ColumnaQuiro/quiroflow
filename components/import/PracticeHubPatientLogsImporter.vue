<script setup lang="ts">
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

interface PHPatient { id: number; patient_number: string }
interface PHPatientLog {
  id: number
  patient_id: number
  type: string
  sub_type: string | null
  data: string | null
  created: string
}

const stage = ref<'connect' | 'importing' | 'done' | 'error'>('connect')
const phase = ref('')
const progress = ref({ done: 0, total: 0 })
const runError = ref('')
const lastConn = ref<{ baseUrl: string; apiKey: string; appDetails: string } | null>(null)

const importedCount = ref(0)
const skippedDuplicate = ref(0)
const skippedUnmatched = ref(0)
const importErrors = ref<string[]>([])

function stripHtml(value: string | null): string | null {
  if (!value) return null
  const text = value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim()
  return text || null
}

async function run(conn: { baseUrl: string; apiKey: string; appDetails: string }) {
  lastConn.value = conn
  stage.value = 'importing'
  runError.value = ''
  importedCount.value = 0
  skippedDuplicate.value = 0
  skippedUnmatched.value = 0
  importErrors.value = []
  const api = usePracticeHubApi(conn)

  try {
    phase.value = t('Matching patients…', 'Emparejando pacientes…')
    const phPatients = await api.fetchAll<PHPatient>('/patients', (done, total) => (progress.value = { done, total }))
    const patientNumberById = new Map(phPatients.map((p) => [p.id, p.patient_number]))

    const PAGE_SIZE = 1000
    const ourPatientByRef = new Map<string, string>()
    for (let page = 0; ; page++) {
      const { data } = await supabase.from('patients').select('id, external_reference').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const p of data ?? []) if (p.external_reference) ourPatientByRef.set(p.external_reference, p.id)
      if (!data || data.length < PAGE_SIZE) break
    }

    phase.value = t('Checking for already-imported logs…', 'Comprobando registros ya importados…')
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

    phase.value = 'Fetching patient logs…'
    progress.value = { done: 0, total: 0 }
    const logs = await api.fetchAll<PHPatientLog>('/patient_logs', (done, total) => (progress.value = { done, total }))

    phase.value = 'Importing…'
    progress.value = { done: 0, total: logs.length }

    const CHUNK_SIZE = 200
    for (let i = 0; i < logs.length; i += CHUNK_SIZE) {
      const chunk = logs.slice(i, i + CHUNK_SIZE)
      const rows = []
      for (const log of chunk) {
        const ref = `PH-log-${log.id}`
        if (existingRefs.has(ref)) {
          skippedDuplicate.value++
          continue
        }
        const patientNumber = patientNumberById.get(log.patient_id)
        const patientId = patientNumber ? ourPatientByRef.get(patientNumber) : undefined
        if (!patientId) {
          skippedUnmatched.value++
          continue
        }
        // contact_log.action is a fixed enum for staff outreach actions
        // (sent_whatsapp, called_no_answer, ...) and doesn't have a slot for
        // PracticeHub's log types (note, appt, sms, ...) -- everything
        // imported here lands as 'other', with the original type kept as a
        // prefix on the note text instead so it isn't lost.
        const typeLabel = log.sub_type ? `${log.type}/${log.sub_type}` : log.type
        const body = stripHtml(log.data)
        rows.push({
          account_id: store.accountId!,
          patient_id: patientId,
          action: 'other',
          note: `[${typeLabel}] ${body ?? ''}`.trim(),
          external_reference: ref,
          created_at: log.created,
        })
      }

      if (rows.length > 0) {
        const { error } = await supabase.from('contact_log').insert(rows)
        if (error) {
          importErrors.value.push(`Logs near row ${i}: ${error.message}`)
        } else {
          importedCount.value += rows.length
        }
      }

      progress.value = { done: Math.min(i + CHUNK_SIZE, logs.length), total: logs.length }
    }

    stage.value = 'done'
    showToast(
      t(
        `Imported ${importedCount.value} log entries. Skipped ${skippedDuplicate.value} already-imported, ${skippedUnmatched.value} with no matching patient.`,
        `Se importaron ${importedCount.value} entradas de registro. Se omitieron ${skippedDuplicate.value} ya importadas, ${skippedUnmatched.value} sin paciente coincidente.`,
      ),
      importErrors.value.length > 0 ? 'error' : 'success',
    )
  } catch (err) {
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
  }
}

function retryRun() {
  if (lastConn.value) run(lastConn.value)
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
    <p class="text-sm text-ink-muted2">
      {{
        t(
          "Pulls the patient activity log directly from PracticeHub's API (notes, appointment activity, and other logged events) into each patient's contact log here. Safe to re-run — already-imported entries are skipped.",
          'Obtiene el registro de actividad de pacientes directamente de la API de PracticeHub (notas, actividad de citas y otros eventos registrados) y lo añade al registro de contacto de cada paciente. Se puede volver a ejecutar sin riesgo: las entradas ya importadas se omiten.',
        )
      }}
    </p>

    <div v-if="stage === 'connect'" class="mt-4 max-w-md">
      <ImportPracticeHubConnectForm @connect="run" />
    </div>

    <div v-else-if="stage === 'importing'" class="mt-4 rounded-lg border border-line bg-surface p-8 text-center">
      <p class="text-sm text-ink-600">{{ phase }}</p>
      <p v-if="progress.total > 0" class="mt-1 text-xs text-ink-faint">{{ progress.done }} / {{ progress.total }}</p>
    </div>

    <div v-else-if="stage === 'error'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
        <p class="font-medium">Import failed:</p>
        <p class="mt-1">{{ runError }}</p>
      </div>
      <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover" @click="retryRun">
        Retry
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

<script setup lang="ts">
import {
  buildStickyNotePlan,
  collectFieldNames,
  detectStickyField,
  type ExistingPatient,
  type PracticeHubPatientRecord,
  type StickyNoteCandidate,
} from '~/utils/practiceHubStickyNotes'

const supabase = useSupabaseClient()
const t = useT()
const { showToast } = useToast()

const stage = ref<'connect' | 'scanning' | 'preview' | 'importing' | 'done' | 'error'>('connect')
const phase = ref('')
const progress = ref({ done: 0, total: 0 })
const runError = ref('')
const lastConn = ref<{ baseUrl: string; apiKey: string; appDetails: string } | null>(null)

const candidates = ref<StickyNoteCandidate[]>([])
const stickyField = ref<string | null>(null)
const availableFields = ref<string[]>([])
const skippedUnchanged = ref(0)
const skippedUnmatched = ref(0)
const skippedEmpty = ref(0)

const updatedCount = ref(0)
const importErrors = ref<string[]>([])

async function run(conn: { baseUrl: string; apiKey: string; appDetails: string }) {
  lastConn.value = conn
  stage.value = 'scanning'
  runError.value = ''
  candidates.value = []
  stickyField.value = null
  availableFields.value = []
  skippedUnchanged.value = 0
  skippedUnmatched.value = 0
  skippedEmpty.value = 0
  importErrors.value = []
  const api = usePracticeHubApi(conn)

  try {
    phase.value = t('Fetching patients from PracticeHub…', 'Obteniendo pacientes de PracticeHub…')
    const phPatients = await api.fetchAll<PracticeHubPatientRecord>('/patients', (done, total) => (progress.value = { done, total }))

    availableFields.value = collectFieldNames(phPatients)
    stickyField.value = detectStickyField(phPatients)
    if (!stickyField.value) {
      stage.value = 'preview'
      return
    }

    phase.value = t('Matching patients…', 'Emparejando pacientes…')
    const PAGE_SIZE = 1000
    const ourPatients = new Map<string, ExistingPatient>()
    for (let page = 0; ; page++) {
      const { data } = await supabase
        .from('patients')
        .select('id, external_reference, first_name, last_name, sticky_note')
        .not('external_reference', 'is', null)
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const p of data ?? []) {
        if (!p.external_reference) continue
        ourPatients.set(p.external_reference, {
          id: p.id,
          label: `${p.first_name} ${p.last_name ?? ''}`.trim(),
          sticky: p.sticky_note,
        })
      }
      if (!data || data.length < PAGE_SIZE) break
    }

    const plan = buildStickyNotePlan(phPatients, stickyField.value, ourPatients)
    candidates.value = plan.candidates
    skippedEmpty.value = plan.skippedEmpty
    skippedUnmatched.value = plan.skippedUnmatched
    skippedUnchanged.value = plan.skippedUnchanged
    stage.value = 'preview'
  } catch (err) {
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
  }
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

async function apply() {
  stage.value = 'importing'
  updatedCount.value = 0
  importErrors.value = []
  progress.value = { done: 0, total: candidates.value.length }

  const CHUNK_SIZE = 100
  const CONCURRENCY = 8
  try {
    for (let i = 0; i < candidates.value.length; i += CHUNK_SIZE) {
      const chunk = candidates.value.slice(i, i + CHUNK_SIZE)
      await runWithConcurrency(chunk, CONCURRENCY, async (row) => {
        const { error } = await supabase.from('patients').update({ sticky_note: row.next }).eq('id', row.patientId)
        if (error) {
          importErrors.value.push(`${row.label} (${row.patientNumber}): ${error.message}`)
          return
        }
        updatedCount.value++
      })
      progress.value = { done: Math.min(i + CHUNK_SIZE, candidates.value.length), total: candidates.value.length }
    }
  } catch (err) {
    // Anything that escapes the per-row error collection above (a dropped
    // connection mid-run, say) would otherwise leave the UI stuck on
    // "Importing…" with no way back. Re-running is safe -- notes already
    // written are skipped as unchanged on the next pass.
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
    return
  }

  stage.value = 'done'
  showToast(
    t(
      `Imported ${updatedCount.value} sticky note(s).`,
      `Se importaron ${updatedCount.value} nota(s) adhesiva(s).`,
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
  updatedCount.value = 0
  importErrors.value = []
  progress.value = { done: 0, total: 0 }
}

function truncate(value: string | null): string {
  if (!value) return t('(blank)', '(vacío)')
  return value.length > 80 ? `${value.slice(0, 80)}…` : value
}
</script>

<template>
  <div>
    <p class="text-sm text-ink-muted2">
      {{
        t(
          "Pulls each patient's sticky note from PracticeHub's API into the patient note here — the one that shows on the calendar when you hover an appointment. Only updates patients already imported, and is safe to re-run: notes that already match are skipped.",
          'Obtiene la nota adhesiva de cada paciente desde la API de PracticeHub y la guarda como nota del paciente aquí: la que aparece en el calendario al pasar el ratón por una cita. Solo actualiza pacientes ya importados y se puede volver a ejecutar sin riesgo: las notas que ya coinciden se omiten.',
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

    <div v-else-if="stage === 'preview'" class="mt-4 space-y-4">
      <div v-if="!stickyField" class="space-y-3">
        <div class="rounded-lg border border-warning-border bg-warning-bg p-4 text-sm text-warning-text">
          <p class="font-medium">{{ t('No sticky note field found', 'No se encontró el campo de nota adhesiva') }}</p>
          <p class="mt-1">
            {{
              t(
                "PracticeHub's patient records came back without any field whose name looks like a sticky note, so there's nothing to import. The full list of fields they returned is below — if one of these is the sticky note under a different name, say which and it can be mapped.",
                'Los registros de pacientes de PracticeHub no incluyen ningún campo cuyo nombre parezca una nota adhesiva, así que no hay nada que importar. Abajo está la lista completa de campos que devolvieron: si alguno es la nota adhesiva con otro nombre, indícalo y se puede mapear.',
              )
            }}
          </p>
        </div>
        <div class="rounded-lg border border-line bg-surface p-3">
          <p class="text-xs font-medium uppercase tracking-wide text-ink-muted2">
            {{ t('Fields PracticeHub returned', 'Campos devueltos por PracticeHub') }}
          </p>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <span v-for="f in availableFields" :key="f" class="rounded-pill bg-surface-subtle px-2 py-0.5 font-mono text-[11px] text-ink-700">{{ f }}</span>
          </div>
        </div>
      </div>

      <template v-else>
        <div class="rounded-lg border border-line bg-surface p-4">
          <dl class="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <dt class="text-ink-muted2">{{ t('Will import', 'Se importarán') }}</dt>
              <dd class="font-medium text-success-text">{{ candidates.length }}</dd>
            </div>
            <div>
              <dt class="text-ink-muted2">{{ t('Already up to date', 'Ya actualizadas') }}</dt>
              <dd class="font-medium text-ink-900">{{ skippedUnchanged }}</dd>
            </div>
            <div>
              <dt class="text-ink-muted2">{{ t('No matching patient', 'Sin paciente coincidente') }}</dt>
              <dd class="font-medium text-ink-900">{{ skippedUnmatched }}</dd>
            </div>
            <div>
              <dt class="text-ink-muted2">{{ t('No sticky note', 'Sin nota adhesiva') }}</dt>
              <dd class="font-medium text-ink-900">{{ skippedEmpty }}</dd>
            </div>
          </dl>
          <p class="mt-3 border-t border-line-divider pt-2 text-xs text-ink-faint">
            {{ t('Reading from PracticeHub field', 'Leyendo del campo de PracticeHub') }}
            <span class="font-mono text-ink-700">{{ stickyField }}</span>
          </p>
        </div>

        <div v-if="candidates.length > 0" class="overflow-hidden rounded-lg border border-line bg-surface">
          <div class="border-b border-line-divider px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted2">
            {{ t('Sample of changes', 'Muestra de cambios') }}
          </div>
          <table class="w-full text-sm">
            <thead class="border-b border-line bg-surface-subtle text-left text-xs font-medium uppercase tracking-wide text-ink-muted2">
              <tr>
                <th class="px-3 py-2">{{ t('Patient', 'Paciente') }}</th>
                <th class="px-3 py-2">{{ t('Current note', 'Nota actual') }}</th>
                <th class="px-3 py-2">{{ t('New note', 'Nota nueva') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line-divider">
              <tr v-for="row in candidates.slice(0, 10)" :key="row.patientId">
                <td class="px-3 py-2 text-ink-900">{{ row.label }}</td>
                <td class="px-3 py-2 text-ink-muted2">{{ truncate(row.current) }}</td>
                <td class="whitespace-pre-line px-3 py-2 text-ink-900">{{ truncate(row.next) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="candidates.length > 10" class="border-t border-line-divider px-3 py-2 text-xs text-ink-faint">
            + {{ candidates.length - 10 }} {{ t('more patients', 'pacientes más') }}
          </p>
        </div>

        <p v-if="candidates.some((c) => c.current)" class="text-xs text-ink-faint">
          {{
            t(
              'Patients with a note already filled in here will have it replaced by the PracticeHub one, matching how the Patients import treats PracticeHub as the source of truth until cutover.',
              'A los pacientes que ya tengan una nota aquí se les reemplazará por la de PracticeHub, igual que la importación de pacientes trata a PracticeHub como fuente de verdad hasta el cambio definitivo.',
            )
          }}
        </p>

        <div class="flex gap-3">
          <button
            type="button"
            :disabled="candidates.length === 0"
            class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
            @click="apply"
          >
            {{ t(`Import ${candidates.length} sticky note(s)`, `Importar ${candidates.length} nota(s) adhesiva(s)`) }}
          </button>
          <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="reset">
            {{ t('Cancel', 'Cancelar') }}
          </button>
        </div>
      </template>
    </div>

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
        <p class="font-medium">{{ t('Some patients failed:', 'Algunos pacientes fallaron:') }}</p>
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

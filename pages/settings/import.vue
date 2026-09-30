<script setup lang="ts">
interface Step {
  key: string
  label: string
  hint: string
  // How many records this step has brought across so far, by the reference
  // each importer stamps on what it writes. Absent for a step that writes
  // nothing countable (a repair, a read-only check).
  count?: () => PromiseLike<{ count: number | null }>
}

interface StepGroup {
  key: string
  label: string
  note?: string
  steps: Step[]
}

interface Source {
  key: string
  label: string
  sub: string
  groups: StepGroup[]
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const route = useRoute()
const router = useRouter()
const connection = usePracticeHubConnection()

// Head counts scoped to the account: a select of the rows would stop at
// PostgREST's 1,000-row cap and show that as the total.
function counted(table: 'patients' | 'appointments' | 'payments' | 'package_purchases' | 'contact_log' | 'patient_docs' | 'patient_files', prefix?: string) {
  return () => {
    const q = supabase.from(table).select('*', { count: 'exact', head: true }).eq('account_id', store.accountId!)
    return prefix ? q.like('external_reference', `${prefix}%`) : q.not('external_reference', 'is', null)
  }
}

// Grouped, and ordered the way a migration actually runs. Everything
// downstream matches a record to its patient by external_reference, so
// Patients genuinely has to go first -- Rodrigo Palau's bono sat unimportable
// because his patient reference had never been stored, and nothing in the UI
// said that was the dependency.
const sources = computed<Source[]>(() => [
  {
    key: 'practicehub',
    label: 'PracticeHub',
    sub: connection.value ? t(`Connected · ${connection.value.baseUrl.replace(/^https?:\/\//, '')}`, `Conectado · ${connection.value.baseUrl.replace(/^https?:\/\//, '')}`) : t('Not connected yet', 'Aún sin conectar'),
    groups: [
      {
        key: 'setup',
        label: t('Set up', 'Configurar'),
        steps: [{ key: 'general', label: t('Connection', 'Conexión'), hint: t('API key and clinic URL, saved once for every step.', 'Clave API y URL de la clínica, guardadas una vez para todos los pasos.') }],
      },
      {
        key: 'records',
        label: t('1 · Records', '1 · Registros'),
        note: t('Start here: everything else is matched to a patient.', 'Empieza aquí: todo lo demás se empareja con un paciente.'),
        steps: [
          { key: 'patients', label: t('Patients', 'Pacientes'), hint: t('Runs first: everything after it finds its patient by the PracticeHub reference stored here.', 'Va primero: todo lo demás encuentra a su paciente por la referencia de PracticeHub guardada aquí.'), count: counted('patients') },
          { key: 'appointment_types', label: t('Appointment types', 'Tipos de cita'), hint: t('Repairs visits attached to the wrong type.', 'Corrige visitas asociadas al tipo equivocado.') },
          { key: 'appointments', label: t('Appointments', 'Citas'), hint: t('Past and upcoming visits.', 'Visitas pasadas y futuras.'), count: counted('appointments') },
        ],
      },
      {
        key: 'money',
        label: t('2 · Money', '2 · Dinero'),
        note: t('Payments first, so a bono knows what is still owed on it.', 'Primero los pagos, para que el bono sepa lo que queda pendiente.'),
        steps: [
          { key: 'ledger', label: t('Ledger', 'Libro mayor'), hint: t('PracticeHub’s own invoices and payments, as it holds them. Needs Patients and Appointments first.', 'Las facturas y pagos propios de PracticeHub, tal y como los tiene. Requiere Pacientes y Citas antes.'), count: counted('payments', 'phpay-') },
          { key: 'patient_packages', label: t('Packages / bonos', 'Bonos'), hint: t('Sessions, price, family sharing and autopay.', 'Sesiones, precio, bonos compartidos y cobro automático.'), count: counted('package_purchases', 'PH-package-') },
        ],
      },
      {
        key: 'clinical',
        label: t('3 · Clinical', '3 · Clínico'),
        steps: [
          { key: 'treatment_notes', label: t('Treatment notes', 'Notas de tratamiento'), hint: t('Notes written at a visit.', 'Notas escritas en la visita.'), count: counted('contact_log', 'PH-clinicalnote-') },
          { key: 'care_plans', label: t('Care plans', 'Planes de tratamiento'), hint: t('Course of treatment.', 'Plan de tratamiento.'), count: counted('contact_log', 'PH-careplan-') },
          { key: 'patient_logs', label: t('Patient logs', 'Registros de pacientes'), hint: t('History entries.', 'Entradas del historial.'), count: counted('contact_log', 'PH-log-') },
          { key: 'sticky_notes', label: t('Sticky notes', 'Notas adhesivas'), hint: t('Front-desk reminders.', 'Recordatorios de recepción.') },
          { key: 'custom_form_responses', label: t('Form responses', 'Respuestas de formularios'), hint: t('Also creates a reusable document template per form.', 'También crea una plantilla de documento por formulario.'), count: counted('patient_docs', 'PH-form-') },
          { key: 'file_attachments', label: t('Files', 'Archivos'), hint: t('Scans, photos and PDFs, straight from PracticeHub’s API. Skips every file already here.', 'Escaneos, fotos y PDF, directo desde la API de PracticeHub. Se salta los que ya están aquí.'), count: () => counted('patient_files')().not('storage_path', 'is', null) },
        ],
      },
      {
        key: 'verify',
        label: t('Check', 'Comprobar'),
        note: t('Read-only. Nothing here changes a record.', 'Solo lectura. Aquí no se modifica ningún registro.'),
        steps: [
          { key: 'reconciliation', label: t('Check migration', 'Comprobar migración'), hint: t('What arrived and what did not.', 'Qué llegó y qué no.') },
          { key: 'patient_check', label: t('Check a patient', 'Comprobar un paciente'), hint: t('One patient, both systems side by side.', 'Un paciente, los dos sistemas lado a lado.') },
        ],
      },
    ],
  },
  {
    key: 'other',
    label: t('Another system', 'Otro sistema'),
    sub: t('Patients from a CSV file', 'Pacientes desde un archivo CSV'),
    groups: [
      {
        key: 'records',
        label: t('Records', 'Registros'),
        steps: [{ key: 'patients', label: t('Patients', 'Pacientes'), hint: t('From a CSV file.', 'Desde un archivo CSV.') }],
      },
    ],
  },
])

// Kept in the URL so a reload, a bookmark, or a link sent to whoever is running
// the migration lands on the same step. Settings > Files links straight to
// PracticeHub's Files step this way.
const sourceKey = ref(typeof route.query.source === 'string' && sources.value.some((s) => s.key === route.query.source) ? route.query.source : 'practicehub')
const activeSource = computed(() => sources.value.find((s) => s.key === sourceKey.value) ?? sources.value[0]!)
const allSteps = computed(() => activeSource.value.groups.flatMap((g) => g.steps))
const stepKey = ref(typeof route.query.type === 'string' ? route.query.type : 'general')
// An address naming a step that does not exist opens the first one, rather
// than a blank panel.
const activeStep = computed(() => allSteps.value.find((s) => s.key === stepKey.value) ?? allSteps.value[0]!)

watch([sourceKey, () => activeStep.value.key], ([source, type]) => {
  router.replace({ query: { ...route.query, source, type } })
})

function selectSource(key: string) {
  if (key === sourceKey.value) return
  sourceKey.value = key
  stepKey.value = sources.value.find((s) => s.key === key)?.groups[0]?.steps[0]?.key ?? ''
}

const counts = ref<Record<string, number>>({})
const countsLoaded = ref(false)
async function loadCounts() {
  const steps = sources.value.find((s) => s.key === 'practicehub')!.groups.flatMap((g) => g.steps).filter((s) => s.count)
  const results = await Promise.all(steps.map((s) => s.count!()))
  counts.value = Object.fromEntries(steps.map((s, i) => [s.key, results[i]?.count ?? 0]))
  countsLoaded.value = true
}

onMounted(() => {
  loadSavedPracticeHubConnection()
  loadCounts()
})

const nf = new Intl.NumberFormat('es-ES')
function statusOf(step: Step): { text: string; done: boolean } | null {
  if (sourceKey.value !== 'practicehub') return null
  if (step.key === 'general') return connection.value ? { text: t('Saved', 'Guardada'), done: true } : { text: t('Not set up yet', 'Aún sin configurar'), done: false }
  if (!step.count) return null
  if (!countsLoaded.value) return { text: '…', done: false }
  const n = counts.value[step.key] ?? 0
  return n ? { text: t(`${nf.format(n)} imported`, `${nf.format(n)} importados`), done: true } : { text: t('Not run yet', 'Aún sin ejecutar'), done: false }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Import', 'Importar')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[1040px] flex-1 flex-col gap-4" data-cy="import-settings" :data-ready="countsLoaded ? 'true' : undefined">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('Bring records across from the system the clinic is moving off. Every step shows a preview first; nothing is written until you confirm it.', 'Trae los registros del sistema del que se está mudando la clínica. Cada paso muestra primero una vista previa: no se escribe nada hasta que lo confirmes.') }}
          </p>

          <div role="radiogroup" :aria-label="t('Import from', 'Importar desde')" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              v-for="s in sources"
              :key="s.key"
              type="button"
              role="radio"
              :aria-checked="sourceKey === s.key"
              :data-cy="`import-source-${s.key}`"
              class="flex items-center gap-3.5 rounded-card border bg-surface px-4 py-3.5 text-left"
              :class="sourceKey === s.key ? 'border-brand ring-1 ring-brand' : 'border-line hover:border-line-controlHover'"
              @click="selectSource(s.key)"
            >
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] text-[14px] font-bold" :class="s.key === 'practicehub' ? 'bg-brand-tint text-brand-text' : 'bg-surface-subtle text-ink-muted'" aria-hidden="true">
                <template v-if="s.key === 'practicehub'">PH</template>
                <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6" /></svg>
              </span>
              <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                <strong class="text-[15px] text-ink-900">{{ s.label }}</strong>
                <span class="truncate text-[12.5px]" :class="s.key === 'practicehub' && connection ? 'text-success-text' : 'text-ink-muted'">{{ s.sub }}</span>
              </span>
            </button>
          </div>

          <section class="flex flex-col overflow-hidden rounded-card border border-line bg-surface md:flex-row">
            <!-- The steps, each saying how far it got -->
            <nav :aria-label="t('Steps', 'Pasos')" class="shrink-0 border-line py-2 max-md:border-b md:w-[280px] md:border-r">
              <div v-for="group in activeSource.groups" :key="group.key" class="pb-1">
                <p class="px-4 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[.06em] text-ink-faint">{{ group.label }}</p>
                <button
                  v-for="step in group.steps"
                  :key="step.key"
                  type="button"
                  data-cy="import-step"
                  :data-step="step.key"
                  :aria-current="activeStep.key === step.key ? 'step' : undefined"
                  :title="step.hint"
                  class="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-subtle"
                  :class="activeStep.key === step.key ? 'bg-brand-tint shadow-[inset_3px_0_0_rgb(var(--color-brand))]' : ''"
                  @click="stepKey = step.key"
                >
                  <span
                    class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                    :class="statusOf(step)?.done ? 'bg-success-bg text-success-text' : 'border-[1.5px] border-line-control'"
                    aria-hidden="true"
                  >
                    <template v-if="statusOf(step)?.done">✓</template>
                  </span>
                  <span class="flex min-w-0 flex-1 flex-col">
                    <strong class="text-[14px] font-semibold text-ink-900">{{ step.label }}</strong>
                    <span v-if="statusOf(step)" data-cy="import-step-status" class="text-[12.5px]" :class="statusOf(step)!.done ? 'text-success-text' : 'text-ink-faint'">{{ statusOf(step)!.text }}</span>
                  </span>
                </button>
                <p v-if="group.note" class="px-4 pb-1 pt-0.5 text-[11.5px] leading-snug text-ink-faint">{{ group.note }}</p>
              </div>
            </nav>

            <!-- The open step -->
            <div class="flex min-w-0 flex-1 flex-col gap-4 p-5" data-cy="import-panel">
              <!-- Each importer opens with its own explanation; the hint is the step button's tooltip. -->
              <h2 class="text-[16px] font-bold text-ink-900">{{ activeStep.label }}</h2>
              <template v-if="sourceKey === 'practicehub'">
                <ImportPracticeHubGeneralSettings v-if="activeStep.key === 'general'" />
                <ImportPracticeHubReconciliation v-else-if="activeStep.key === 'reconciliation'" />
                <ImportPracticeHubPatientCheck v-else-if="activeStep.key === 'patient_check'" />
                <ImportPracticeHubPatientsImporter v-else-if="activeStep.key === 'patients'" />
                <ImportPracticeHubAppointmentsImporter v-else-if="activeStep.key === 'appointments'" />
                <ImportPracticeHubAppointmentTypesImporter v-else-if="activeStep.key === 'appointment_types'" />
                <ImportPracticeHubLedgerImporter v-else-if="activeStep.key === 'ledger'" />
                <ImportPracticeHubPatientPackagesImporter v-else-if="activeStep.key === 'patient_packages'" />
                <ImportPracticeHubPatientLogsImporter v-else-if="activeStep.key === 'patient_logs'" />
                <ImportPracticeHubStickyNotesImporter v-else-if="activeStep.key === 'sticky_notes'" />
                <ImportPracticeHubClinicalNotesImporter v-else-if="activeStep.key === 'treatment_notes'" />
                <ImportPracticeHubCarePlansImporter v-else-if="activeStep.key === 'care_plans'" />
                <ImportPracticeHubCustomFormResponsesImporter v-else-if="activeStep.key === 'custom_form_responses'" />
                <ImportPracticeHubFilesImporter v-else-if="activeStep.key === 'file_attachments'" />
              </template>
              <ImportGenericCsvPatientsImporter v-else />
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { QuirocitasStepKind } from '~/composables/useQuirocitasImport'

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
const quirocitas = useQuirocitasConnection()
const quirocitasCopy = useQuirocitasSnapshot()

// Head counts scoped to the account: a select of the rows would stop at
// PostgREST's 1,000-row cap and show that as the total.
function counted(table: 'patients' | 'appointments' | 'payments' | 'package_purchases' | 'contact_log' | 'patient_docs' | 'patient_files', prefix?: string) {
  return () => {
    const q = supabase.from(table).select('*', { count: 'exact', head: true }).eq('account_id', store.accountId!)
    // Unprefixed is PracticeHub's (bare numbers): not the "QC-" rows Quirocitas writes.
    return prefix ? q.like('external_reference', `${prefix}%`) : q.not('external_reference', 'is', null).not('external_reference', 'like', 'QC-%')
  }
}

// Grouped, and ordered the way a migration actually runs. Everything
// downstream matches a record to its patient by external_reference, so
// Patients genuinely has to go first -- one patient's bono sat unimportable
// because their patient reference had never been stored, and nothing in the UI
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
          { key: 'appointment_types', label: t('Appointment types', 'Tipos de cita'), hint: t('Creates the types, and repairs visits attached to the wrong one.', 'Crea los tipos y corrige visitas asociadas al equivocado.') },
          { key: 'appointments', label: t('Appointments', 'Citas'), hint: t('Past and upcoming visits.', 'Visitas pasadas y futuras.'), count: counted('appointments') },
        ],
      },
      {
        key: 'money',
        label: t('2 · Money', '2 · Dinero'),
        // The Ledger marks a visit paid by pooling each family's payments
        // through their shared bonos (settle_imported_invoices), so a visit
        // paid from a relative's bono stays unpaid until Bonos has run.
        note: t('A visit paid from a family member’s shared bono is only marked paid once that bono is here: run Bonos before the Ledger, or the Ledger again after Bonos.', 'Una visita pagada con el bono compartido de un familiar solo queda pagada cuando ese bono ya está aquí: ejecuta Bonos antes del Libro mayor, o el Libro mayor otra vez después de Bonos.'),
        steps: [
          { key: 'ledger', label: t('Ledger', 'Libro mayor'), hint: t('PracticeHub’s own invoices and payments, as it holds them. Needs Patients and Appointments first.', 'Las facturas y pagos propios de PracticeHub, tal y como los tiene. Requiere Pacientes y Citas antes.'), count: counted('payments', 'phpay-') },
          { key: 'patient_packages', label: t('Packages / bonos', 'Bonos'), hint: t('Sessions, price, family sharing and autopay.', 'Sesiones, precio, bonos compartidos y cobro automático.'), count: counted('package_purchases', 'PH-package-') },
          { key: 'care_plans_v3', label: t('2.0 care plans', 'Planes 2.0'), hint: t('For a clinic already on PracticeHub 2.0: its bonos and memberships, read through the 2.0 API. Read-only for now.', 'Para una clínica ya en PracticeHub 2.0: sus bonos y membresías, leídos con la API 2.0. Solo lectura por ahora.') },
        ],
      },
      {
        key: 'clinical',
        label: t('3 · Clinical', '3 · Clínico'),
        steps: [
          { key: 'treatment_notes', label: t('Treatment notes', 'Notas de tratamiento'), hint: t('Notes written at a visit.', 'Notas escritas en la visita.'), count: counted('contact_log', 'PH-clinicalnote-') },
          { key: 'care_plans', label: t('Care plans', 'Planes de cuidados'), hint: t('Course of treatment.', 'Plan de cuidados.'), count: counted('contact_log', 'PH-careplan-') },
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
    key: 'quirocitas',
    label: 'Quirocitas',
    sub: quirocitasConnected(quirocitas.value) ? t(`Connected · ${quirocitas.value!.baseUrl!.replace(/^https?:\/\//, '')}`, `Conectado · ${quirocitas.value!.baseUrl!.replace(/^https?:\/\//, '')}`) : t('Not connected yet', 'Aún sin conectar'),
    groups: [
      {
        key: 'setup',
        label: t('Set up', 'Configurar'),
        note: t('Quirocitas has no export of its own beyond patients: QuiroFlow reads it page by page, once, then imports from that copy.', 'Quirocitas no exporta más que los pacientes: QuiroFlow lo lee página a página, una vez, y luego importa desde esa copia.'),
        steps: [
          { key: 'general', label: t('Connection', 'Conexión'), hint: t('Quirocitas address and a staff login.', 'Dirección de Quirocitas y un usuario del personal.') },
          { key: 'read', label: t('Read Quirocitas', 'Leer Quirocitas'), hint: t('Reads every record into this browser. Writes nothing.', 'Lee cada ficha a este navegador. No escribe nada.') },
        ],
      },
      {
        key: 'records',
        label: t('1 · Records', '1 · Registros'),
        note: t('Patients first: everything else is matched to a patient.', 'Primero los pacientes: todo lo demás se empareja con uno.'),
        steps: [
          { key: 'patients', label: t('Patients', 'Pacientes'), hint: t('Details, phones, consent and chiropractor.', 'Datos, teléfonos, consentimiento y quiropráctico.'), count: counted('patients', 'QC-') },
          { key: 'appointments', label: t('Appointments', 'Citas'), hint: t('Past and upcoming visits.', 'Visitas pasadas y futuras.'), count: counted('appointments', 'QC-') },
        ],
      },
      {
        key: 'clinical',
        label: t('2 · Clinical', '2 · Clínico'),
        steps: [
          { key: 'clinical', label: t('Clinical history and calls', 'Historial clínico y llamadas'), hint: t('Visit notes with segments adjusted, plans, anamnesis, follow-up calls.', 'Notas de visita con segmentos, planes, anamnesis, llamadas.'), count: counted('contact_log', 'QC-') },
          { key: 'files', label: t('Files and photos', 'Archivos y fotos'), hint: t('Attached tests, x-rays and photos.', 'Pruebas adjuntas, radiografías y fotos.'), count: () => counted('patient_files', 'QC-test-')().not('storage_path', 'is', null) },
        ],
      },
      {
        key: 'money',
        label: t('3 · Money', '3 · Dinero'),
        note: t('Bonos first, so each bono payment finds its bono.', 'Primero los bonos, para que cada pago encuentre su bono.'),
        steps: [
          { key: 'bonos', label: 'Bonos', hint: t('Sessions, price, what is owed, family sharing.', 'Sesiones, precio, pendiente, familia.'), count: counted('package_purchases', 'QC-bono-') },
          { key: 'ledger', label: t('Payments and invoices', 'Pagos y facturas'), hint: t('The cash ledger and Quirocitas invoices.', 'La caja y las facturas de Quirocitas.'), count: counted('payments', 'QC-pay-') },
        ],
      },
    ],
  },
  {
    key: 'other',
    label: t('Another system', 'Otro sistema'),
    sub: t('Patients from a CSV or Excel file', 'Pacientes desde un archivo CSV o Excel'),
    groups: [
      {
        key: 'records',
        label: t('Records', 'Registros'),
        steps: [{ key: 'patients', label: t('Patients', 'Pacientes'), hint: t('From a CSV or Excel file.', 'Desde un archivo CSV o Excel.') }],
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
// quiet: keep showing the numbers already there while the new ones load,
// rather than blanking every step to "…" each time an import finishes.
async function loadCounts(opts: { quiet?: boolean } = {}) {
  if (!opts.quiet) countsLoaded.value = false
  const source = sourceKey.value
  const steps = activeSource.value.groups.flatMap((g) => g.steps).filter((s) => s.count)
  const results = await Promise.all(steps.map((s) => s.count!()))
  // Switched source while counting: these numbers belong to the other one.
  if (source !== sourceKey.value) return
  counts.value = Object.fromEntries(steps.map((s, i) => [s.key, results[i]?.count ?? 0]))
  countsLoaded.value = true
}

// While the open step writes, re-count just that step every few seconds so its
// number climbs as records land; when it stops (done, error or stopped), count
// every step once more. See useImportWriting.
const LIVE_COUNT_MS = 3000
let liveTimer: ReturnType<typeof setInterval> | null = null
function stopLiveCount() {
  if (liveTimer) clearInterval(liveTimer)
  liveTimer = null
}
async function countStep(source: string, step: Step) {
  const { count } = await step.count!()
  if (source !== sourceKey.value || count == null) return
  counts.value = { ...counts.value, [step.key]: count }
}
provideImportWriting((writing) => {
  stopLiveCount()
  if (!writing) {
    loadCounts({ quiet: true })
    return
  }
  const source = sourceKey.value
  const step = activeStep.value
  if (!step.count) return
  liveTimer = setInterval(() => { countStep(source, step).catch(() => {}) }, LIVE_COUNT_MS)
})
onBeforeUnmount(stopLiveCount)

onMounted(() => {
  loadSavedPracticeHubConnection()
  loadQuirocitasConnection()
  if (store.accountId) loadQuirocitasSnapshot(store.accountId)
  loadCounts()
})
// Each source counts its own steps.
watch(sourceKey, () => loadCounts())

const nf = new Intl.NumberFormat('es-ES')
function statusOf(step: Step): { text: string; done: boolean } | null {
  if (sourceKey.value === 'other') return null
  if (step.key === 'general') {
    const saved = sourceKey.value === 'quirocitas' ? quirocitasConnected(quirocitas.value) : !!connection.value
    return saved ? { text: t('Saved', 'Guardada'), done: true } : { text: t('Not set up yet', 'Aún sin configurar'), done: false }
  }
  if (step.key === 'read') {
    const s = quirocitasCopy.value
    return s?.ledgerMonths.length ? { text: t(`Read ${new Date(s.readAt).toLocaleDateString('es-ES')}`, `Leído el ${new Date(s.readAt).toLocaleDateString('es-ES')}`), done: true } : { text: s ? t('Partly read', 'Leído en parte') : t('Not read yet', 'Aún sin leer'), done: false }
  }
  if (!step.count) return null
  if (!countsLoaded.value) return { text: '…', done: false }
  const n = counts.value[step.key] ?? 0
  return n ? { text: t(`${nf.format(n)} imported`, `${nf.format(n)} importados`), done: true } : { text: t('Nothing imported yet', 'Nada importado aún'), done: false }
}
// Every importer shows a long preview -- counts, sample tables, sometimes
// every row held back -- with its Apply button at the bottom, and then swaps
// all of it for a short progress box. The page kept its scroll position, so
// the clinic was left looking at blank space below the panel and had to
// scroll back up to see the import running. When the open step's content
// shrinks while its top is out of sight, bring the top back into view. Done
// here, once, rather than in each importer's stage change: it covers every
// step, including ones added later, and a step switched from low in the step
// list opens at its start for the same reason.
const scroller = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
let panelObserver: ResizeObserver | null = null
let lastPanelHeight = 0
// A watch rather than onMounted: the panel is not necessarily rendered yet
// when the page mounts.
watch(panel, (el) => {
  panelObserver?.disconnect()
  panelObserver = null
  if (!el || typeof ResizeObserver === 'undefined') return
  lastPanelHeight = el.offsetHeight
  panelObserver = new ResizeObserver(() => {
    const node = panel.value
    const box = scroller.value
    if (!node || !box) return
    const height = node.offsetHeight
    const shrank = height < lastPanelHeight - 120
    lastPanelHeight = height
    if (!shrank) return
    if (node.getBoundingClientRect().top < box.getBoundingClientRect().top) {
      node.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  })
  panelObserver.observe(el)
}, { flush: 'post' })
onBeforeUnmount(() => panelObserver?.disconnect())
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Import', 'Importar')" />
    <div ref="scroller" class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[1040px] flex-1 flex-col gap-4" data-cy="import-settings" :data-ready="countsLoaded ? 'true' : undefined">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('Bring the clinic’s records across from the system it is leaving. Choose that system, then work through its steps: each group says what has to run first. Every step that writes shows a preview first, and nothing is written until you confirm it.', 'Trae los registros de la clínica desde el sistema que deja. Elige ese sistema y sigue sus pasos: cada grupo indica qué tiene que ir antes. Cada paso que escribe muestra antes una vista previa, y no se escribe nada hasta que lo confirmes.') }}
          </p>

          <div role="radiogroup" :aria-label="t('Import from', 'Importar desde')" class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] text-[14px] font-bold" :class="s.key !== 'other' ? 'bg-brand-tint text-brand-text' : 'bg-surface-subtle text-ink-muted'" aria-hidden="true">
                <template v-if="s.key === 'practicehub'">PH</template>
                <template v-else-if="s.key === 'quirocitas'">QC</template>
                <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6" /></svg>
              </span>
              <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                <strong class="text-[15px] text-ink-900">{{ s.label }}</strong>
                <span class="truncate text-[12.5px]" :class="(s.key === 'practicehub' && connection) || (s.key === 'quirocitas' && quirocitasConnected(quirocitas)) ? 'text-success-text' : 'text-ink-muted'">{{ s.sub }}</span>
              </span>
            </button>
          </div>

          <section class="flex flex-col overflow-hidden rounded-card border border-line bg-surface md:flex-row">
            <!-- The steps, each saying how far it got -->
            <nav :aria-label="t('Steps', 'Pasos')" class="shrink-0 border-line py-2 max-md:border-b md:w-[280px] md:border-r">
              <div v-for="group in activeSource.groups" :key="group.key" class="pb-1">
                <p class="px-4 pb-1 pt-2.5 text-[11px] font-[640] uppercase tracking-[.07em] text-ink-faint">{{ group.label }}</p>
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
                    <svg v-if="statusOf(step)?.done" width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.2l2.3 2.3 4.7-5" /></svg>
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
            <div ref="panel" class="flex min-w-0 flex-1 scroll-mt-4 flex-col gap-4 p-5" data-cy="import-panel">
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
                <ImportPracticeHub20CarePlansPreview v-else-if="activeStep.key === 'care_plans_v3'" />
                <ImportPracticeHubPatientLogsImporter v-else-if="activeStep.key === 'patient_logs'" />
                <ImportPracticeHubStickyNotesImporter v-else-if="activeStep.key === 'sticky_notes'" />
                <ImportPracticeHubClinicalNotesImporter v-else-if="activeStep.key === 'treatment_notes'" />
                <ImportPracticeHubCarePlansImporter v-else-if="activeStep.key === 'care_plans'" />
                <ImportPracticeHubCustomFormResponsesImporter v-else-if="activeStep.key === 'custom_form_responses'" />
                <ImportPracticeHubFilesImporter v-else-if="activeStep.key === 'file_attachments'" />
              </template>
              <template v-else-if="sourceKey === 'quirocitas'">
                <ImportQuirocitasConnection v-if="activeStep.key === 'general'" />
                <ImportQuirocitasRead v-else-if="activeStep.key === 'read'" />
                <ImportQuirocitasStep v-else :kind="activeStep.key as QuirocitasStepKind" />
              </template>
              <ImportGenericCsvPatientsImporter v-else />
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

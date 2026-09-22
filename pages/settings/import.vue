<script setup lang="ts">
interface DataType {
  key: string
  label: string
  hint: string
}

interface DataGroup {
  key: string
  label: string
  note?: string
  types: DataType[]
}

interface Source {
  key: string
  label: string
  available: boolean
  groups: DataGroup[]
}

const t = useT()
const route = useRoute()
const router = useRouter()

onMounted(() => {
  loadSavedPracticeHubConnection()
})

// Grouped rather than one flat row of fifteen chips, and ordered the way a
// migration actually runs. Everything downstream matches a record to its
// patient by external_reference, so Patients genuinely has to go first --
// Rodrigo Palau's bono sat unimportable because his patient reference had
// never been stored, and nothing in the UI said that was the dependency.
// The groups make the order visible instead of leaving it to be discovered.
const sources = computed<Source[]>(() => [
  {
    key: 'practicehub',
    label: 'PracticeHub',
    available: true,
    groups: [
      {
        key: 'setup',
        label: t('Set up', 'Configurar'),
        types: [{ key: 'general', label: t('Connection', 'Conexión'), hint: t('API key and clinic URL, saved once for every step', 'Clave API y URL de la clínica, guardadas una vez para todos los pasos') }],
      },
      {
        key: 'records',
        label: t('1 · Records', '1 · Registros'),
        note: t('Start here — everything else is matched to a patient.', 'Empieza aquí: todo lo demás se empareja con un paciente.'),
        types: [
          { key: 'patients', label: t('Patients', 'Pacientes'), hint: t('Must run first — everything else matches on the patient reference', 'Debe ir primero: todo lo demás se empareja por la referencia del paciente') },
          { key: 'appointment_types', label: t('Appointment types', 'Tipos de cita'), hint: t('Repairs visits attached to the wrong type', 'Corrige visitas asociadas al tipo equivocado') },
          { key: 'appointments', label: t('Appointments', 'Citas'), hint: t('Past and upcoming visits', 'Visitas pasadas y futuras') },
        ],
      },
      {
        key: 'money',
        label: t('2 · Money', '2 · Dinero'),
        note: t('Payments first, so a bono knows what is still owed on it.', 'Primero los pagos, para que el bono sepa lo que queda pendiente.'),
        types: [
          {
            key: 'ledger',
            label: t('Ledger (invoices + payments)', 'Libro mayor (facturas + pagos)'),
            hint: t(
              'PracticeHub’s own invoices and payments, as it holds them — needs Patients and Appointments first',
              'Las facturas y pagos propios de PracticeHub, tal y como los tiene: requiere Pacientes y Citas antes',
            ),
          },
          { key: 'patient_packages', label: t('Packages / bonos', 'Bonos'), hint: t('Sessions, price, family sharing and autopay', 'Sesiones, precio, bonos compartidos y cobro automático') },
        ],
      },
      {
        key: 'clinical',
        label: t('3 · Clinical', '3 · Clínico'),
        types: [
          { key: 'treatment_notes', label: t('Treatment notes', 'Notas de tratamiento'), hint: t('Notes written at a visit', 'Notas escritas en la visita') },
          { key: 'care_plans', label: t('Care plans', 'Planes de tratamiento'), hint: t('Course of treatment', 'Plan de tratamiento') },
          { key: 'patient_logs', label: t('Patient logs', 'Registros de pacientes'), hint: t('History entries', 'Entradas del historial') },
          { key: 'sticky_notes', label: t('Sticky notes', 'Notas adhesivas'), hint: t('Front-desk reminders', 'Recordatorios de recepción') },
          { key: 'custom_form_responses', label: t('Form responses', 'Respuestas de formularios'), hint: t('Also creates a reusable document template per form', 'También crea una plantilla de documento por formulario') },
          { key: 'file_attachments', label: t('Files', 'Archivos'), hint: t('Scans, photos and PDFs — straight from the API', 'Escaneos, fotos y PDF: directo desde la API') },
        ],
      },
      {
        key: 'verify',
        label: t('Check', 'Comprobar'),
        note: t('Read-only. Nothing here changes a record.', 'Solo lectura. Aquí no se modifica ningún registro.'),
        types: [
          { key: 'reconciliation', label: t('Check migration', 'Comprobar migración'), hint: t('What arrived and what did not', 'Qué llegó y qué no') },
          { key: 'patient_check', label: t('Check a patient', 'Comprobar un paciente'), hint: t('One patient, both systems side by side', 'Un paciente, los dos sistemas lado a lado') },
        ],
      },
    ],
  },
  {
    key: 'other',
    label: t('Other system', 'Otro sistema'),
    available: true,
    groups: [
      {
        key: 'records',
        label: t('Records', 'Registros'),
        types: [{ key: 'patients', label: t('Patients', 'Pacientes'), hint: t('From a CSV file', 'Desde un archivo CSV') }],
      },
    ],
  },
])

// Kept in the URL so a reload, a bookmark, or a link sent to whoever is running
// the migration lands on the same step. Before this, every refresh dropped you
// back on the connection form and you re-navigated by hand.
const sourceKey = ref(typeof route.query.source === 'string' ? route.query.source : 'practicehub')
const dataTypeKey = ref(typeof route.query.type === 'string' ? route.query.type : 'general')

const activeSource = computed(() => sources.value.find((s) => s.key === sourceKey.value) ?? sources.value[0]!)
const allTypes = computed(() => activeSource.value.groups.flatMap((g) => g.types))
const activeType = computed(() => allTypes.value.find((d) => d.key === dataTypeKey.value))

watch([sourceKey, dataTypeKey], ([source, type]) => {
  router.replace({ query: { ...route.query, source, type } })
})

function selectSource(key: string) {
  const source = sources.value.find((s) => s.key === key)
  if (!source?.available) return
  sourceKey.value = key
  dataTypeKey.value = source.groups[0]?.types[0]?.key ?? ''
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Import from another system', 'Importar desde otro sistema')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[760px] flex-1">
          <p class="text-[13px] text-ink-muted2">
            {{
              t(
                'Bring records across from the system this clinic is moving off. Every step shows a preview first — nothing is written until you confirm it.',
                'Trae los registros del sistema del que se está mudando la clínica. Cada paso muestra primero una vista previa: no se escribe nada hasta que lo confirmes.',
              )
            }}
          </p>

          <div class="mt-4 border-b border-line">
            <nav class="-mb-px flex gap-6">
              <button
                v-for="s in sources"
                :key="s.key"
                type="button"
                class="flex items-center gap-1.5 border-b-2 px-1 py-2 text-[13px] font-medium"
                :class="[
                  sourceKey === s.key ? 'border-brand text-brand-text' : 'border-transparent text-ink-muted2 hover:border-line-controlHover hover:text-ink-600',
                  !s.available && 'cursor-not-allowed opacity-50',
                ]"
                @click="selectSource(s.key)"
              >
                {{ s.label }}
                <span v-if="!s.available" class="rounded-ctlSm bg-chip-bg px-1.5 py-0.5 text-[11px] text-chip-text">{{ t('Coming soon', 'Próximamente') }}</span>
              </button>
            </nav>
          </div>

          <div class="mt-4 space-y-3.5">
            <div v-for="group in activeSource.groups" :key="group.key" class="flex flex-wrap gap-x-3 gap-y-1.5">
              <p class="mt-1 w-[76px] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{{ group.label }}</p>
              <div class="flex min-w-0 flex-1 flex-wrap gap-2">
                <button
                  v-for="dt in group.types"
                  :key="dt.key"
                  type="button"
                  :title="dt.hint"
                  class="rounded-pill px-3 py-1 text-[12.5px] font-medium"
                  :class="dataTypeKey === dt.key ? 'bg-brand text-white' : 'bg-chip-bg text-chip-text hover:bg-line-row2'"
                  @click="dataTypeKey = dt.key"
                >
                  {{ dt.label }}
                </button>
                <p v-if="group.note" class="w-full text-[11.5px] text-ink-faint">{{ group.note }}</p>
              </div>
            </div>
          </div>

          <p v-if="activeType" class="mt-5 border-t border-line-divider pt-4 text-[12.5px] text-ink-muted2">
            <span class="font-semibold text-ink-700">{{ activeType.label }}</span>
            <span class="px-1.5 text-ink-faint3">&middot;</span>{{ activeType.hint }}
          </p>

          <div class="mt-4">
            <ImportPracticeHubGeneralSettings v-if="sourceKey === 'practicehub' && dataTypeKey === 'general'" />
            <ImportPracticeHubReconciliation v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'reconciliation'" />
            <ImportPracticeHubPatientCheck v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'patient_check'" />
            <ImportPracticeHubPatientsImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'patients'" />
            <ImportPracticeHubAppointmentsImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'appointments'" />
            <ImportPracticeHubAppointmentTypesImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'appointment_types'" />
            <ImportPracticeHubLedgerImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'ledger'" />
            <ImportPracticeHubPatientPackagesImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'patient_packages'" />
            <ImportPracticeHubPatientLogsImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'patient_logs'" />
            <ImportPracticeHubStickyNotesImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'sticky_notes'" />
            <ImportPracticeHubClinicalNotesImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'treatment_notes'" />
            <ImportPracticeHubCarePlansImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'care_plans'" />
            <ImportPracticeHubCustomFormResponsesImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'custom_form_responses'" />
            <!--
              The API importer, not the CSV one. PracticeHub's /files endpoint
              returns every attachment with its patient and a signed download
              URL, so there is no export to take and no browser script to run.
              ImportPracticeHubFileAttachmentsImporter is the older CSV path and
              stays available for a clinic whose API key cannot reach /files.
            -->
            <ImportPracticeHubFilesImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'file_attachments'" />
            <ImportGenericCsvPatientsImporter v-else-if="sourceKey === 'other' && dataTypeKey === 'patients'" />
            <ImportComingSoon v-else :label="activeType?.label ?? ''" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

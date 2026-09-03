<script setup lang="ts">
interface DataType {
  key: string
  label: string
}

interface Source {
  key: string
  label: string
  available: boolean
  dataTypes: DataType[]
}

const t = useT()

onMounted(() => {
  loadSavedPracticeHubConnection()
})

const sources = computed<Source[]>(() => [
  {
    key: 'practicehub',
    label: 'PracticeHub',
    available: true,
    dataTypes: [
      { key: 'general', label: t('General', 'General') },
      { key: 'patients', label: t('Patients', 'Pacientes') },
      { key: 'appointments', label: t('Appointments', 'Citas') },
      { key: 'appointment_types', label: t('Appointment Types (fix)', 'Tipos de cita (fix)') },
      { key: 'payments', label: t('Payments', 'Pagos') },
      { key: 'patient_packages', label: t('Packages / Bonos', 'Bonos') },
      { key: 'patient_logs', label: t('Patient Logs', 'Registros de pacientes') },
      { key: 'treatment_notes', label: t('Treatment Notes', 'Notas de tratamiento') },
      { key: 'care_plans', label: t('Care Plans', 'Planes de tratamiento') },
      { key: 'custom_form_responses', label: t('Custom Form Responses', 'Respuestas de formularios personalizados') },
      { key: 'file_attachments', label: t('File Attachments', 'Archivos adjuntos') },
    ],
  },
  {
    key: 'other',
    label: t('Other system', 'Otro sistema'),
    available: true,
    dataTypes: [{ key: 'patients', label: t('Patients', 'Pacientes') }],
  },
])

const sourceKey = ref('practicehub')
const dataTypeKey = ref('general')

const activeSource = computed(() => sources.value.find((s) => s.key === sourceKey.value)!)

function selectSource(key: string) {
  const source = sources.value.find((s) => s.key === key)
  if (!source?.available) return
  sourceKey.value = key
  dataTypeKey.value = source.dataTypes[0]?.key ?? ''
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Import Patients (CSV)', 'Importar pacientes (CSV)')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] text-ink-muted2">{{ t('Migrate records from another practice management system.', 'Migra registros desde otro sistema de gestión de clínicas.') }}</p>

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

          <div v-if="activeSource.dataTypes.length > 0" class="mt-4 flex flex-wrap gap-2">
            <button
              v-for="dt in activeSource.dataTypes"
              :key="dt.key"
              type="button"
              class="rounded-pill px-3 py-1 text-[12.5px] font-medium"
              :class="dataTypeKey === dt.key ? 'bg-brand text-white' : 'bg-chip-bg text-chip-text hover:bg-line-row2'"
              @click="dataTypeKey = dt.key"
            >
              {{ dt.label }}
            </button>
          </div>

          <div class="mt-6">
            <ImportPracticeHubGeneralSettings v-if="sourceKey === 'practicehub' && dataTypeKey === 'general'" />
            <ImportPracticeHubPatientsImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'patients'" />
            <ImportPracticeHubAppointmentsImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'appointments'" />
            <ImportPracticeHubAppointmentTypesImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'appointment_types'" />
            <ImportPracticeHubPaymentsImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'payments'" />
            <ImportPracticeHubPatientPackagesImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'patient_packages'" />
            <ImportPracticeHubPatientLogsImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'patient_logs'" />
            <ImportPracticeHubClinicalNotesImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'treatment_notes'" />
            <ImportPracticeHubCarePlansImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'care_plans'" />
            <ImportPracticeHubCustomFormResponsesImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'custom_form_responses'" />
            <ImportPracticeHubFileAttachmentsImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'file_attachments'" />
            <ImportGenericCsvPatientsImporter v-else-if="sourceKey === 'other' && dataTypeKey === 'patients'" />
            <ImportComingSoon v-else :label="activeSource.dataTypes.find((d) => d.key === dataTypeKey)?.label ?? ''" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

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

const sources: Source[] = [
  {
    key: 'practicehub',
    label: 'PracticeHub',
    available: true,
    dataTypes: [
      { key: 'patients', label: 'Patients' },
      { key: 'appointments', label: 'Appointments' },
      { key: 'appointment_types', label: 'Appointment Types (fix)' },
      { key: 'payments', label: 'Payments' },
      { key: 'patient_logs', label: 'Patient Logs' },
      { key: 'treatment_notes', label: 'Treatment Notes' },
      { key: 'care_plans', label: 'Care Plans' },
      { key: 'custom_form_responses', label: 'Custom Form Responses' },
      { key: 'file_attachments', label: 'File Attachments' },
    ],
  },
  { key: 'other', label: 'Other system', available: false, dataTypes: [] },
]

const sourceKey = ref('practicehub')
const dataTypeKey = ref('patients')

const activeSource = computed(() => sources.find((s) => s.key === sourceKey.value)!)

function selectSource(key: string) {
  const source = sources.find((s) => s.key === key)
  if (!source?.available) return
  sourceKey.value = key
  dataTypeKey.value = source.dataTypes[0]?.key ?? ''
}
</script>

<template>
  <div class="flex gap-8">
    <SettingsNav />
    <div class="min-w-0 max-w-2xl flex-1">
      <h1 class="text-xl font-semibold text-gray-900">Import Data</h1>
    <p class="mt-1 text-sm text-gray-500">Migrate records from another practice management system.</p>

    <div class="mt-4 border-b border-gray-200">
      <nav class="-mb-px flex gap-6">
        <button
          v-for="s in sources"
          :key="s.key"
          type="button"
          class="flex items-center gap-1.5 border-b-2 px-1 py-2 text-sm font-medium"
          :class="[
            sourceKey === s.key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700',
            !s.available && 'cursor-not-allowed opacity-50',
          ]"
          @click="selectSource(s.key)"
        >
          {{ s.label }}
          <span v-if="!s.available" class="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">Coming soon</span>
        </button>
      </nav>
    </div>

    <div v-if="activeSource.dataTypes.length > 0" class="mt-4 flex flex-wrap gap-2">
      <button
        v-for="dt in activeSource.dataTypes"
        :key="dt.key"
        type="button"
        class="rounded-full px-3 py-1 text-sm font-medium"
        :class="dataTypeKey === dt.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
        @click="dataTypeKey = dt.key"
      >
        {{ dt.label }}
      </button>
    </div>

    <div class="mt-6">
      <ImportPracticeHubPatientsImporter v-if="sourceKey === 'practicehub' && dataTypeKey === 'patients'" />
      <ImportPracticeHubAppointmentsImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'appointments'" />
      <ImportPracticeHubAppointmentTypesImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'appointment_types'" />
      <ImportPracticeHubPaymentsImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'payments'" />
      <ImportPracticeHubPatientLogsImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'patient_logs'" />
      <ImportPracticeHubClinicalNotesImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'treatment_notes'" />
      <ImportPracticeHubCarePlansImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'care_plans'" />
      <ImportPracticeHubCustomFormResponsesImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'custom_form_responses'" />
      <ImportPracticeHubFileAttachmentsImporter v-else-if="sourceKey === 'practicehub' && dataTypeKey === 'file_attachments'" />
      <ImportComingSoon v-else-if="sourceKey === 'practicehub'" :label="activeSource.dataTypes.find((d) => d.key === dataTypeKey)?.label ?? ''" />
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const route = useRoute()
const supabase = useSupabaseClient()
const patientId = route.params.id as string

const patient = ref<Tables<'patients'> | null>(null)
const notFound = ref(false)
const loading = ref(true)

async function loadPatient() {
  loading.value = true
  const { data } = await supabase.from('patients').select('*').eq('id', patientId).maybeSingle()
  patient.value = data
  notFound.value = !data
  loading.value = false
}
onMounted(loadPatient)

const tabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'appointments', label: 'Appointments' },
  { key: 'visit-notes', label: 'Visit Notes' },
  { key: 'billing', label: 'Billing' },
  { key: 'files', label: 'Files' },
  { key: 'docs', label: 'Docs' },
]

const activeTab = computed({
  get: () => (route.query.tab as string) ?? 'overview',
  set: (value) => navigateTo({ path: route.path, query: { ...route.query, tab: value } }),
})
</script>

<template>
  <div v-if="loading" class="text-sm text-gray-400">Loading…</div>
  <div v-else-if="notFound" class="text-sm text-gray-400">Patient not found.</div>
  <div v-else-if="patient">
    <NuxtLink to="/patients" class="text-sm text-gray-500 hover:text-gray-700">&larr; Back to Patients</NuxtLink>

    <div class="mt-3 flex flex-col gap-6 lg:flex-row lg:items-start">
      <PatientsDetailSidebar :patient="patient" />

      <div class="min-w-0 flex-1">
        <div class="sticky top-0 z-10 border-b border-gray-200 bg-gray-50">
          <nav class="-mb-px flex gap-6 overflow-x-auto">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              type="button"
              class="shrink-0 border-b-2 px-1 py-2 text-sm font-medium"
              :class="
                activeTab === tab.key
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              "
              @click="activeTab = tab.key"
            >
              {{ tab.label }}
            </button>
          </nav>
        </div>

        <div class="mt-6">
          <PatientsOverviewTab v-if="activeTab === 'overview'" :patient="patient" @updated="loadPatient" />
          <PatientsAppointmentsTab
            v-else-if="activeTab === 'appointments'"
            :patient-id="patientId"
            :first-name="patient.first_name"
            :last-name="patient.last_name"
            :preferred-language="patient.preferred_language"
          />
          <PatientsVisitNotesTab v-else-if="activeTab === 'visit-notes'" :patient-id="patientId" />
          <PatientsBillingTab v-else-if="activeTab === 'billing'" :patient-id="patientId" />
          <PatientsFilesTab v-else-if="activeTab === 'files'" :patient-id="patientId" />
          <PatientsDocsTab v-else-if="activeTab === 'docs'" :patient-id="patientId" />
        </div>
      </div>
    </div>
  </div>
</template>

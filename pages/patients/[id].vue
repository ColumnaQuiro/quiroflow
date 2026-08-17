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
]

const activeTab = computed({
  get: () => (route.query.tab as string) ?? 'overview',
  set: (value) => navigateTo({ path: route.path, query: { ...route.query, tab: value } }),
})

function formatBalance(cents: number) {
  const amount = (Math.abs(cents) / 100).toFixed(2)
  if (cents > 0) return { text: `€${amount} in credit`, class: 'text-green-600' }
  if (cents < 0) return { text: `€${amount} owed`, class: 'text-red-600' }
  return { text: '€0.00', class: 'text-gray-500' }
}
</script>

<template>
  <div v-if="loading" class="text-sm text-gray-400">Loading…</div>
  <div v-else-if="notFound" class="text-sm text-gray-400">Patient not found.</div>
  <div v-else-if="patient">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-900">{{ patient.first_name }} {{ patient.last_name }}</h1>
        <p class="mt-1 text-sm" :class="formatBalance(patient.balance_cents).class">
          {{ formatBalance(patient.balance_cents).text }}
        </p>
      </div>
      <NuxtLink to="/patients" class="text-sm text-gray-500 hover:text-gray-700">&larr; Back to Patients</NuxtLink>
    </div>

    <div class="mt-6 border-b border-gray-200">
      <nav class="-mb-px flex gap-6">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="border-b-2 px-1 py-2 text-sm font-medium"
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
      />
      <PatientsVisitNotesTab v-else-if="activeTab === 'visit-notes'" :patient-id="patientId" />
      <PatientsBillingTab v-else-if="activeTab === 'billing'" :patient-id="patientId" />
      <PatientsFilesTab v-else-if="activeTab === 'files'" :patient-id="patientId" />
    </div>
  </div>
</template>

<script setup lang="ts">
interface Appointment {
  id: string
  patient_id: string
  starts_at: string
  patients: { first_name: string; last_name: string | null } | null
}

const props = defineProps<{ appointment: Appointment }>()
const emit = defineEmits<{ charted: [] }>()

const supabase = useSupabaseClient()
const visitNumber = ref<number | null>(null)

async function loadVisitNumber() {
  const { count } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('patient_id', props.appointment.patient_id)
    .neq('status', 'cancelled')
    .lte('starts_at', props.appointment.starts_at)
  visitNumber.value = count ?? null
}
watch(() => props.appointment.id, loadVisitNumber, { immediate: true })

function onExamSaved() {
  emit('charted')
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4">
      <div>
        <p class="text-lg font-semibold text-gray-900">{{ appointment.patients?.first_name }} {{ appointment.patients?.last_name }}</p>
        <p class="text-sm text-gray-500">{{ visitNumber ? `Visit #${visitNumber}` : '' }} &middot; {{ new Date(appointment.starts_at).toLocaleString([], { hour: '2-digit', minute: '2-digit' }) }}</p>
      </div>
      <NuxtLink :to="`/patients/${appointment.patient_id}`" target="_blank" class="text-sm text-indigo-600 hover:text-indigo-700">View patient profile &rarr;</NuxtLink>
    </div>

    <PatientsExamAutofill :appointment-id="appointment.id" @saved="onExamSaved" />

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div class="space-y-4 lg:col-span-1">
        <PatientsPhaseStats :patient-id="appointment.patient_id" />
        <PatientsFlagsPanel :patient-id="appointment.patient_id" />
      </div>
      <div class="space-y-4 lg:col-span-2">
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <h3 class="text-sm font-semibold text-gray-900">Quick Note</h3>
          <div class="mt-2">
            <AppointmentsNotesPanel :appointment-id="appointment.id" />
          </div>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <h3 class="text-sm font-semibold text-gray-900">Notes History</h3>
          <div class="mt-2">
            <PatientsVisitNotesTab :patient-id="appointment.patient_id" />
          </div>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <h3 class="text-sm font-semibold text-gray-900">Files & Documents</h3>
          <div class="mt-2">
            <PatientsFilesTab :patient-id="appointment.patient_id" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

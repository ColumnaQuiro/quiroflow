<script setup lang="ts">
// The patient's home screen. Every section is a shared component from the
// root app's components/patient/, so this and pages/portal/index.vue show
// the same things -- they had drifted into two different apps, the portal
// showing invoices and nothing else, this showing everything but.
const props = defineProps<{ patientId: string; patientFirstName: string }>()

const t = useT()
const { settings } = usePatientAppInfo()

// Rescheduling needs a slot picker; /book already is one. Handing it the
// appointment id lets it collect a new time and call the RPC, rather than
// this screen growing a second availability calendar.
function goReschedule(appointmentId: string) {
  navigateTo(`/book?reschedule=${appointmentId}`)
}
</script>

<template>
  <div class="flex-1 space-y-5 p-4">
    <h1 class="text-lg font-semibold text-ink-900">{{ t(`Hi, ${patientFirstName}`, `Hola, ${patientFirstName}`) }}</h1>

    <NuxtLink to="/messages" class="flex items-center justify-between rounded-card border border-line bg-surface px-4 py-3">
      <span class="text-[13.5px] font-medium text-ink-900">{{ t('Messages', 'Mensajes') }}</span>
      <span class="text-[13px] text-ink-faint">&rarr;</span>
    </NuxtLink>

    <PatientAppointmentsCard :patient-id="props.patientId" :settings="settings" book-href="/book" @reschedule="goReschedule" />
    <PatientBalanceCard :patient-id="props.patientId" />
    <PatientInvoicesCard :patient-id="props.patientId" />
    <PatientFilesCard :patient-id="props.patientId" />

    <section>
      <h2 class="text-[13px] font-semibold text-ink-700">{{ t('Care plan', 'Plan de tratamiento') }}</h2>
      <div class="mt-2">
        <PatientsPhaseStats :patient-id="props.patientId" :editable="false" />
      </div>
    </section>
  </div>
</template>

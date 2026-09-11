<script setup lang="ts">
// Upcoming and past visits. Was a card on the home screen whose past list
// stayed behind a "show" toggle for room.
definePageMeta({ layout: 'patient' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const t = useT()
const { settings } = usePatientAppInfo()
const { patient, loading: identityLoading } = useIdentity()
const patientId = computed(() => patient.value?.id ?? '')

const { upcoming, past, loading, busyId, canChange, cancel } = usePatientAppointments(
  () => patientId.value,
  () => settings.value,
)

// Rescheduling needs a slot picker; /book already is one. Handing it the
// appointment id lets it collect a new time and call the RPC, rather than
// this screen growing a second availability calendar.
function goReschedule(appointmentId: string) {
  navigateTo(`/book?reschedule=${appointmentId}`)
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function dayNumber(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric' })
}
function monthShort(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short' })
}
function timeOnly(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <PatientScreen :title="t('Visits', 'Citas')">
    <template v-if="!identityLoading && patient">
      <PatientCard :title="t('Upcoming', 'Próximas')" flush>
        <template v-if="settings.bookingEnabled" #action>
          <NuxtLink to="/book" class="text-[12.5px] font-medium text-brand-text">{{ t('+ Book', '+ Reservar') }}</NuxtLink>
        </template>
        <div v-if="loading" class="space-y-3 p-4">
          <UiSkeleton class="h-12 w-full rounded-ctl" />
        </div>
        <ul v-else-if="upcoming.length > 0" class="divide-y divide-line-divider">
          <li v-for="appt in upcoming" :key="appt.id" class="flex items-start gap-3 px-4 py-3.5">
            <span class="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-ctl bg-brand-tint leading-none">
              <span class="text-[15px] font-[640] text-brand">{{ dayNumber(appt.starts_at) }}</span>
              <span class="mt-0.5 text-[10px] font-medium uppercase text-brand">{{ monthShort(appt.starts_at) }}</span>
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-[13.5px] font-medium text-ink-900">
                {{ timeOnly(appt.starts_at) }} &middot; {{ appt.appointment_types?.name ?? t('Appointment', 'Cita') }}
              </p>
              <p v-if="appt.team_members?.full_name" class="text-[12.5px] text-ink-muted">{{ appt.team_members.full_name }}</p>

              <div v-if="settings.cancelEnabled || settings.rescheduleEnabled" class="mt-2 flex items-center gap-3">
                <template v-if="canChange(appt)">
                  <button
                    v-if="settings.rescheduleEnabled"
                    type="button"
                    class="text-[12.5px] font-medium text-brand-text"
                    :disabled="busyId === appt.id"
                    @click="goReschedule(appt.id)"
                  >
                    {{ t('Reschedule', 'Cambiar') }}
                  </button>
                  <button
                    v-if="settings.cancelEnabled"
                    type="button"
                    class="text-[12.5px] font-medium text-danger-text"
                    :disabled="busyId === appt.id"
                    @click="cancel(appt, formatWhen(appt.starts_at))"
                  >
                    {{ busyId === appt.id ? t('Cancelling…', 'Cancelando…') : t('Cancel', 'Cancelar') }}
                  </button>
                </template>
                <!-- Inside the notice window the clinic has to be involved,
                     so say that rather than showing a button that will be
                     refused. -->
                <p v-else-if="appt.status === 'booked'" class="text-[12px] text-ink-faint">
                  {{ t('Contact the clinic to change this one.', 'Contacta con la clínica para cambiarla.') }}
                </p>
              </div>
            </div>
          </li>
        </ul>
        <PatientEmpty v-else :text="t('No upcoming appointments.', 'No tienes citas próximas.')" />
      </PatientCard>

      <div class="mt-3">
        <PatientCard :title="t('Past visits', 'Anteriores')" flush>
          <ul v-if="past.length > 0" class="divide-y divide-line-divider">
            <li v-for="appt in past" :key="appt.id" class="flex items-center justify-between gap-3 px-4 py-3">
              <div class="min-w-0">
                <p class="text-[13px] text-ink-700">{{ formatWhen(appt.starts_at) }}</p>
                <p class="text-[12px] text-ink-faint">{{ appt.appointment_types?.name ?? t('Appointment', 'Cita') }}</p>
              </div>
              <span class="shrink-0 rounded-pill bg-chip-bg px-2 py-0.5 text-[11.5px] font-medium text-chip-text">
                {{ t(PATIENT_APPOINTMENT_STATUS[appt.status]?.[0] ?? appt.status, PATIENT_APPOINTMENT_STATUS[appt.status]?.[1] ?? appt.status) }}
              </span>
            </li>
          </ul>
          <PatientEmpty v-else :text="t('Nothing here yet.', 'Todavía no hay nada aquí.')" />
        </PatientCard>
      </div>
    </template>
  </PatientScreen>
</template>

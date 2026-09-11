<script setup lang="ts">
// Upcoming and past visits, on their own page instead of a card that had
// to keep its past list behind a "show" toggle for space.
definePageMeta({ layout: 'portal' })

const t = useT()
const { settings } = usePatientAppInfo()
const { patient } = usePortalPatient()
const patientId = computed(() => patient.value?.id ?? '')

const { upcoming, past, loading, busyId, canChange, cancel } = usePatientAppointments(
  () => patientId.value,
  () => settings.value,
)

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
  <div>
    <PortalPageHead
      :title="t('Appointments', 'Citas')"
      :lead="t('Your upcoming visits and the ones you have already had.', 'Tus próximas visitas y las que ya has tenido.')"
    />

    <PortalCard :title="t('Upcoming', 'Próximas')" flush>
      <div v-if="loading" class="space-y-3 p-4">
        <UiSkeleton class="h-12 w-full rounded-ctl" />
        <UiSkeleton class="h-12 w-full rounded-ctl" />
      </div>
      <ul v-else-if="upcoming.length > 0" class="divide-y divide-line-divider">
        <li v-for="appt in upcoming" :key="appt.id" class="flex items-start gap-3.5 px-4 py-3.5">
          <!-- A date block rather than a sentence: a list of visits is
               scanned by date, not read. -->
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
                <!-- Rescheduling needs a slot picker, which only the mobile
                     app has -- so the portal offers cancelling and says
                     where to change a time, rather than showing a button
                     that leads nowhere. -->
                <button
                  v-if="settings.cancelEnabled"
                  type="button"
                  class="text-[12.5px] font-medium text-danger-text hover:opacity-80"
                  :disabled="busyId === appt.id"
                  @click="cancel(appt, formatWhen(appt.starts_at))"
                >
                  {{ busyId === appt.id ? t('Cancelling…', 'Cancelando…') : t('Cancel', 'Cancelar') }}
                </button>
                <span v-if="settings.rescheduleEnabled" class="text-[12px] text-ink-faint">
                  {{ t('To move it, use the app or call the clinic.', 'Para cambiarla, usa la app o llama a la clínica.') }}
                </span>
              </template>
              <p v-else-if="appt.status === 'booked'" class="text-[12px] text-ink-faint">
                {{ t('Contact the clinic to change this one.', 'Contacta con la clínica para cambiarla.') }}
              </p>
            </div>
          </div>
        </li>
      </ul>
      <PortalEmpty v-else :text="t('No upcoming appointments.', 'No tienes citas próximas.')" />
    </PortalCard>

    <div class="mt-4">
      <PortalCard :title="t('Past visits', 'Visitas anteriores')" flush>
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
        <PortalEmpty v-else :text="t('Nothing here yet.', 'Todavía no hay nada aquí.')" />
      </PortalCard>
    </div>
  </div>
</template>

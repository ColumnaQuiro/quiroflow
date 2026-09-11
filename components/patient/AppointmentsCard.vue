<script setup lang="ts">
// The patient's own appointments, with whatever control the clinic has
// granted. Rendered identically by the web portal's mobile app and the
// mobile app itself.
//
// The query, the notice-window rule and the cancel call now live in
// usePatientAppointments -- the portal's own appointments page needs the
// same three, and a second copy of the notice rule is what would let a
// button appear for something the RPC then refuses.
const props = defineProps<{
  patientId: string
  settings: PatientAppSettings
  /** The mobile app has a /book route; the web portal doesn't (yet). */
  bookHref?: string
}>()

const t = useT()

const { upcoming: appointments, past, loading, busyId, canChange, cancel } = usePatientAppointments(
  () => props.patientId,
  () => props.settings,
)

// Rescheduling needs a slot picker, which is the booking flow's job -- this
// hands off to it rather than growing a second availability calendar here.
const emit = defineEmits<{ reschedule: [appointmentId: string] }>()

const showPast = ref(false)

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const statusLabel = PATIENT_APPOINTMENT_STATUS
</script>

<template>
  <section>
    <div class="flex items-center justify-between">
      <h2 class="text-[13px] font-semibold text-ink-700">{{ t('Upcoming appointments', 'Próximas citas') }}</h2>
      <NuxtLink v-if="settings.bookingEnabled && bookHref" :to="bookHref" class="text-[12.5px] font-medium text-brand-text">
        {{ t('+ New', '+ Nueva') }}
      </NuxtLink>
    </div>

    <div class="mt-2 overflow-hidden rounded-card border border-line bg-surface">
      <div v-if="loading" class="p-4 text-[13px] text-ink-faint">{{ t('Loading…', 'Cargando…') }}</div>
      <ul v-else-if="appointments.length > 0" class="divide-y divide-line">
        <li v-for="appt in appointments" :key="appt.id" class="px-4 py-3">
          <p class="text-[13.5px] font-medium text-ink-900">{{ formatWhen(appt.starts_at) }}</p>
          <p class="text-[12.5px] text-ink-muted">
            {{ appt.appointment_types?.name ?? t('Appointment', 'Cita') }}
            <template v-if="appt.team_members?.full_name"> &middot; {{ appt.team_members.full_name }}</template>
          </p>

          <div v-if="settings.cancelEnabled || settings.rescheduleEnabled" class="mt-2 flex items-center gap-3">
            <template v-if="canChange(appt)">
              <button
                v-if="settings.rescheduleEnabled"
                type="button"
                class="text-[12.5px] font-medium text-brand-text"
                :disabled="busyId === appt.id"
                @click="emit('reschedule', appt.id)"
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
            <!-- Inside the notice window the clinic has to be involved, so
                 say that rather than showing a button that will be refused. -->
            <p v-else-if="appt.status === 'booked'" class="text-[12px] text-ink-faint">
              {{ t('Contact the clinic to change this one.', 'Contacta con la clínica para cambiarla.') }}
            </p>
          </div>
        </li>
      </ul>
      <p v-else class="p-4 text-center text-[13px] text-ink-faint">{{ t('No upcoming appointments.', 'No tienes citas próximas.') }}</p>
    </div>

    <div v-if="past.length > 0" class="mt-2">
      <button type="button" class="text-[12.5px] font-medium text-ink-muted hover:text-ink-700" @click="showPast = !showPast">
        {{ showPast ? t('Hide past appointments', 'Ocultar citas anteriores') : t('Show past appointments', 'Ver citas anteriores') }}
      </button>
      <ul v-if="showPast" class="mt-2 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
        <li v-for="appt in past" :key="appt.id" class="px-4 py-2.5">
          <p class="text-[13px] text-ink-700">{{ formatWhen(appt.starts_at) }}</p>
          <p class="text-[12px] text-ink-faint">
            {{ appt.appointment_types?.name ?? t('Appointment', 'Cita') }} &middot;
            {{ t(statusLabel[appt.status]?.[0] ?? appt.status, statusLabel[appt.status]?.[1] ?? appt.status) }}
          </p>
        </li>
      </ul>
    </div>
  </section>
</template>

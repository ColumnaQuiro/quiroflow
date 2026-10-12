<script setup lang="ts">
import { canSelfCheckIn } from '~/utils/selfCheckIn'

// Where the QR code at the desk leads (/print/check-in-sign): today's visit,
// and "Ya estoy aquí". A patient not signed in is sent to sign in and brought
// back here (middleware/portal.global.ts).
definePageMeta({ layout: 'portal' })

const t = useT()
const { settings, zoneOf } = usePatientAppInfo()
const { patient, loading: patientLoading } = usePortalPatient()
const patientId = computed(() => patient.value?.id ?? '')
const { upcoming, past, loading } = usePatientAppointments(() => patientId.value, () => settings.value)

// The visit they can check in to now, or the one they already did today
// (which has started, so it may be among the past ones).
const now = new Date()
const visit = computed(() => {
  const today = [...upcoming.value, ...past.value].filter((a) => a.status === 'booked')
  return today.find((a) => canSelfCheckIn(a, now)) ?? today.find((a) => a.checked_in_at && Date.parse(a.ends_at) >= now.getTime()) ?? null
})
function when(a: { starts_at: string; clinic_id?: string | null }) {
  return new Date(a.starts_at).toLocaleTimeString(t('en-GB', 'es-ES'), { hour: '2-digit', minute: '2-digit', timeZone: zoneOf(a.clinic_id) })
}
</script>

<template>
  <div>
    <PatientPageHead :title="t('Check in', 'Registrar llegada')" />
    <div v-if="patientLoading || loading"><UiSkeleton class="h-32 w-full rounded-card" /></div>
    <section v-else-if="visit" class="rounded-card border border-line bg-surface p-5 shadow-card" data-cy="portal-check-in">
      <p class="text-[11.5px] font-[640] uppercase tracking-[.05em] text-ink-faint">{{ t('Your visit today', 'Tu cita de hoy') }}</p>
      <p class="mt-1.5 text-[19px] font-[640] tracking-tightTitle text-ink-900">
        {{ when(visit) }}<template v-if="visit.appointment_types?.name"> &middot; {{ visit.appointment_types.name }}</template>
      </p>
      <p v-if="visit.team_members?.full_name" class="mt-1 text-[13.5px] text-ink-muted">{{ visit.team_members.full_name }}</p>
      <PatientCheckIn class="mt-4" :appt="visit" />
    </section>
    <section v-else class="rounded-card border border-line bg-surface p-5 shadow-card" data-cy="portal-check-in-none">
      <p class="text-[15px] text-ink-700">{{ t("There's no visit to check in to right now.", 'Ahora mismo no tienes ninguna cita en la que registrar tu llegada.') }}</p>
      <p class="mt-1 text-[13px] text-ink-muted">{{ t('You can check in from 90 minutes before your visit. If something is wrong, tell the front desk.', 'Puedes registrar tu llegada desde 90 minutos antes de la cita. Si algo no cuadra, avisa en recepción.') }}</p>
      <NuxtLink to="/portal/appointments" class="mt-3 inline-block text-[12.5px] font-medium text-brand-text">{{ t('See your appointments', 'Ver tus citas') }} &rarr;</NuxtLink>
    </section>
  </div>
</template>

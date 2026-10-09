<script lang="ts">
// Across mounts of this screen within one app run.
let shownBefore = false
</script>

<script setup lang="ts">
import { formatEur } from '../../utils/billing'

// The patient's home screen: the two things the app gets opened for --
// when am I next in, what do I have left -- and a way through to the rest.
//
// It used to stack every section here (appointments, balance, invoices,
// files, care plan) in one scroll, because there was nowhere else to put
// them. They now have tabs of their own; see mobile/layouts/patient.vue.
const props = defineProps<{ patientId: string; patientFirstName: string }>()

const t = useT()
const locale = computed(() => t('en-GB', 'es-ES'))
const { settings } = usePatientAppInfo()

const { upcoming, loading: apptLoading, confirmAttendance, confirmingId } = usePatientAppointments(
  () => props.patientId,
  () => settings.value,
)
const { loading: moneyLoading, outstandingCents, creditLedgerCents, activePackages, refresh: refreshMoney } = usePatientFinancialSummary(() => props.patientId)

// The money summary is cached for the whole app run (usePatientFinancialSummary),
// and Capacitor keeps the app alive in the background: a debt paid at the desk
// stayed on screen until the app was force-quit. Fresh figures each time this
// screen is shown again, and when the app comes back to the front.
onMounted(() => {
  if (shownBefore) refreshMoney()
  shownBefore = true
})
function onVisible() {
  if (document.visibilityState === 'visible') refreshMoney()
}
onMounted(() => document.addEventListener('visibilitychange', onVisible))
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible))
const { documents } = usePatientDocuments(() => props.patientId)

const next = computed(() => upcoming.value[0] ?? null)
// What is unpaid, not the balance, as the staff record shows it
// (components/patient/BalanceCard.vue, utils/owing.ts): a family bono's
// beneficiary was shown a debt for visits already paid for from the bono.
const amountDueCents = computed(() => outstandingCents.value)
const sessionsLeft = computed(() => activePackages.value.reduce((sum, p) => sum + Math.max(0, p.sessions_total - p.sessions_used), 0))

// At the clinic's hour, not the phone's: a patient whose phone is set to
// another zone saw a visit booked for 10:00 as 09:00.
const { zoneOf } = usePatientAppInfo()
function longWhen(iso: string, clinicId?: string | null) {
  return new Date(iso).toLocaleString(locale.value, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: zoneOf(clinicId) })
}
// The clinic(s) and the waitlist card's clinic: the next visit's, or the
// only one with nothing booked. The cards themselves are shared with the
// portal (components/patient).
const { clinics } = usePatientClinics()
const waitlistClinicId = computed(() => next.value?.clinic_id ?? (clinics.value.length === 1 ? clinics.value[0]!.id : null))

function eur(cents: number) {
  return formatEur(cents)
}
</script>

<template>
  <!-- A readable column on an iPad rather than cards stretched across it. -->
  <div class="p-4 md:px-[max(1.5rem,calc((100%_-_44rem)/2))]">
    <div class="mb-4 flex items-start justify-between gap-3">
      <h1 class="text-[19px] font-[640] tracking-tightTitle text-ink-900">
        {{ t(`Hi, ${patientFirstName}`, `Hola, ${patientFirstName}`) }}
      </h1>
      <!-- Account, sign out and account deletion moved off the home header
           into their own screen: two of those three are destructive and
           they were sitting in the top bar of every visit to the app. -->
      <NuxtLink
        to="/account"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-ink-muted"
        :aria-label="t('Account', 'Cuenta')"
      >
        <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
          <path d="M8 8a2.6 2.6 0 100-5.2A2.6 2.6 0 008 8zM3.2 13.4c0-2.3 2.1-3.6 4.8-3.6s4.8 1.3 4.8 3.6" />
        </svg>
      </NuxtLink>
    </div>

    <section class="rounded-card border border-line bg-surface p-4 shadow-card">
      <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('Your next visit', 'Tu próxima cita') }}</p>
      <div v-if="apptLoading" class="mt-2"><UiSkeleton class="h-6 w-48 rounded-ctlSm" /></div>
      <template v-else-if="next">
        <p class="mt-1.5 text-[17px] font-[640] leading-snug tracking-tightTitle text-ink-900 first-letter:uppercase">{{ longWhen(next.starts_at, next.clinic_id) }}</p>
        <p class="mt-1 text-[13px] text-ink-muted">
          {{ next.appointment_types?.name ?? t('Appointment', 'Cita') }}
          <template v-if="next.team_members?.full_name"> &middot; {{ next.team_members.full_name }}</template>
        </p>
        <PatientConfirmVisit class="mt-3" :appt="next" :busy="confirmingId === next.id" @confirm="confirmAttendance" />
        <PatientNextVisitActions class="mt-3" :appointment-id="next.id" :clinic-id="next.clinic_id" />
        <NuxtLink to="/visits" class="mt-3 inline-block text-[12.5px] font-medium text-brand-text">
          {{ t('See all visits', 'Ver todas las citas') }} <AppChevron :size="12" />
        </NuxtLink>
      </template>
      <template v-else>
        <p class="mt-1.5 text-[15px] text-ink-muted">{{ t('Nothing booked yet.', 'No tienes ninguna cita reservada.') }}</p>
        <NuxtLink v-if="settings.bookingEnabled" to="/book" class="mt-3 inline-block text-[12.5px] font-medium text-brand-text">
          {{ t('Book a visit', 'Reservar cita') }} <AppChevron :size="12" />
        </NuxtLink>
      </template>
    </section>

    <!-- Earlier, if a slot frees up: the clinic's waitlist -->
    <PatientWaitlistCard v-if="settings.bookingEnabled && !apptLoading" class="mt-3" :clinic-id="waitlistClinicId" :has-next-visit="!!next" />

    <div class="mt-3 grid grid-cols-2 gap-3">
      <NuxtLink to="/billing" class="rounded-card border border-line bg-surface p-3.5 shadow-card">
        <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('Sessions left', 'Sesiones') }}</p>
        <p v-if="moneyLoading" class="mt-2"><UiSkeleton class="h-6 w-10 rounded-ctlSm" /></p>
        <p v-else class="mt-1 text-[22px] font-[640] tracking-tightTitle text-ink-900">{{ sessionsLeft }}</p>
      </NuxtLink>
      <NuxtLink to="/billing" class="rounded-card border border-line bg-surface p-3.5 shadow-card">
        <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">
          {{ amountDueCents > 0 ? t('You owe', 'Pendiente') : t('Your credit', 'Saldo') }}
        </p>
        <p v-if="moneyLoading" class="mt-2"><UiSkeleton class="h-6 w-16 rounded-ctlSm" /></p>
        <p v-else class="mt-1 text-[22px] font-[640] tracking-tightTitle" :class="amountDueCents > 0 ? 'text-danger-text' : 'text-ink-900'">
          {{ eur(amountDueCents > 0 ? amountDueCents : creditLedgerCents) }}
        </p>
      </NuxtLink>
    </div>

    <NuxtLink
      v-if="documents.length > 0"
      to="/documents"
      class="mt-3 flex items-center justify-between rounded-card border border-line bg-surface px-4 py-3 shadow-card"
    >
      <span class="text-[13.5px] font-medium text-ink-900">
        {{ t('Your documents', 'Tus documentos') }}
        <span class="ml-1 text-[12.5px] font-normal text-ink-faint">{{ documents.length }}</span>
      </span>
      <span class="text-ink-faint"><AppChevron /></span>
    </NuxtLink>

    <!-- The clinic: where it is and how to reach it -->
    <PatientClinicCards class="mt-3" messages-to="/messages" />

    <section class="mt-5">
      <h2 class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('Care plan', 'Plan de tratamiento') }}</h2>
      <div class="mt-2">
        <PatientsPhaseStats :patient-id="props.patientId" :editable="false" />
      </div>
    </section>
  </div>
</template>

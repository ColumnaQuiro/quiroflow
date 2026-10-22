<script lang="ts">
// Across mounts of this screen within one app run.
let shownBefore = false
</script>

<script setup lang="ts">
import { formatEur } from '../../utils/billing'

// The patient's home screen: a summary -- anything owed, when am I next in,
// what do I have left -- and a way through to the rest.
//
// It used to stack every section here (appointments, balance, invoices,
// files, care plan, posture) in one scroll, because there was nowhere else
// to put them. They have tabs of their own now (mobile/composables/
// useAppNav.ts): the plan, bonos and facturas on Plan, posture on Progreso,
// documents on Documentos. What stays is the summary of each.
const props = defineProps<{ patientId: string; patientFirstName: string }>()

const t = useT()
const locale = computed(() => t('en-GB', 'es-ES'))
const { settings } = usePatientAppInfo()

const { upcoming, loading: apptLoading, confirmAttendance, confirmingId, canChange } = usePatientAppointments(
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
// Paying from the banner: straight to the one unpaid invoice, else the list.
// Only where the clinic takes payments online (usePatientPay).
const { invoices, reload: reloadInvoices } = usePatientInvoices(() => props.patientId)
const { enabled: canPayOnline, payingId, error: payError, pay } = usePatientPay(() => {
  reloadInvoices()
  refreshMoney()
})
const unpaid = computed(() => invoices.value.filter((i) => i.status === 'unpaid'))
function payOutstanding() {
  if (unpaid.value.length === 1) pay(unpaid.value[0]!.id)
  else navigateTo('/billing')
}
// The care plan as one tile; the plan itself is on the Plan tab.
const { progress: planProgress, plan: carePlan } = usePatientPlanSummary(() => props.patientId)
// Home exercises: a way through to them, once the clinic has given some.
const { items: exercises } = usePatientExercises(() => props.patientId)

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

// The home-screen widget shows the next visit and the bono, as of now.
const homeWidget = useHomeWidget()
watch([next, activePackages, apptLoading, moneyLoading], () => {
  if (apptLoading.value || moneyLoading.value) return
  homeWidget.publish(patientWidgetSnapshot({ next: next.value, packages: activePackages.value, clinic: clinics.value.find((c) => c.id === next.value?.clinic_id)?.name ?? clinics.value[0]?.name ?? null, timeZone: zoneOf(next.value?.clinic_id ?? null) }))
})

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

    <!-- Something owed: said first, with the way to settle it -->
    <section v-if="!moneyLoading && amountDueCents > 0" class="mb-3 flex items-center gap-3 rounded-card border border-danger-border bg-danger-bg p-3.5" data-cy="patient-home-owed">
      <div class="min-w-0 flex-1">
        <p class="text-[14px] font-semibold text-danger-text">{{ t(`You owe ${eur(amountDueCents)}`, `Tienes ${eur(amountDueCents)} pendientes`) }}</p>
        <p v-if="!canPayOnline" class="mt-0.5 text-[12px] text-ink-700">{{ t('You can pay it at the clinic.', 'Lo puedes pagar en la clínica.') }}</p>
        <p v-if="payError" role="alert" class="mt-0.5 text-[12px] text-danger-text">{{ payError }}</p>
      </div>
      <button
        v-if="canPayOnline && unpaid.length > 0"
        type="button"
        class="h-10 shrink-0 rounded-ctl bg-danger-text px-4 text-[13.5px] font-semibold text-white disabled:opacity-60"
        :disabled="payingId !== null"
        data-cy="patient-home-pay"
        @click="payOutstanding"
      >
        {{ payingId ? t('Opening…', 'Abriendo…') : t('Pay', 'Pagar') }}
      </button>
    </section>

    <section class="rounded-card border border-line bg-surface p-4 shadow-card">
      <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('Your next visit', 'Tu próxima cita') }}</p>
      <div v-if="apptLoading" class="mt-2"><UiSkeleton class="h-6 w-48 rounded-ctlSm" /></div>
      <template v-else-if="next">
        <p class="mt-1.5 text-[17px] font-[640] leading-snug tracking-tightTitle text-ink-900 first-letter:uppercase">{{ longWhen(next.starts_at, next.clinic_id) }}</p>
        <p class="mt-1 text-[13px] text-ink-muted">
          {{ next.appointment_types?.name ?? t('Appointment', 'Cita') }}
          <template v-if="next.team_members?.full_name"> &middot; {{ next.team_members.full_name }}</template>
        </p>
        <!-- On the day: "Ya estoy aquí" on arrival (utils/selfCheckIn.ts). -->
        <PatientCheckIn class="mt-3" :appt="next" />
        <PatientConfirmVisit class="mt-3" :appt="next" :busy="confirmingId === next.id" @confirm="confirmAttendance" />
        <PatientNextVisitActions class="mt-3" :appointment-id="next.id" :clinic-id="next.clinic_id" />
        <!-- Changing it only where the clinic lets patients, and far enough off -->
        <NuxtLink v-if="settings.rescheduleEnabled && canChange(next)" :to="`/book?reschedule=${next.id}`" class="mt-3 inline-block text-[12.5px] font-medium text-brand-text" data-cy="patient-home-reschedule">
          {{ t('Change this visit', 'Cambiar esta cita') }} <AppChevron :size="12" />
        </NuxtLink>
        <NuxtLink to="/visits" class="ml-4 mt-3 inline-block text-[12.5px] font-medium text-brand-text">
          {{ t('Your plan', 'Tu plan') }} <AppChevron :size="12" />
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

    <!-- The summary of the Plan tab: sessions, credit, the care plan -->
    <div class="mt-3 grid gap-3" :class="carePlan && planProgress ? 'grid-cols-3' : 'grid-cols-2'" data-cy="patient-home-summary">
      <NuxtLink to="/visits" class="rounded-card border border-line bg-surface p-3 shadow-card">
        <p class="text-[10.5px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('Sessions', 'Sesiones') }}</p>
        <p v-if="moneyLoading" class="mt-2"><UiSkeleton class="h-6 w-10 rounded-ctlSm" /></p>
        <p v-else class="mt-1 text-[20px] font-[640] tracking-tightTitle text-ink-900">{{ sessionsLeft }}</p>
        <p class="text-[11.5px] text-ink-muted">{{ t('left', 'te quedan') }}</p>
      </NuxtLink>
      <NuxtLink to="/visits" class="rounded-card border border-line bg-surface p-3 shadow-card">
        <p class="text-[10.5px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('Credit', 'Saldo') }}</p>
        <p v-if="moneyLoading" class="mt-2"><UiSkeleton class="h-6 w-16 rounded-ctlSm" /></p>
        <p v-else class="mt-1 text-[20px] font-[640] tracking-tightTitle text-ink-900">{{ eur(creditLedgerCents) }}</p>
        <p class="text-[11.5px] text-ink-muted">{{ t('in your favour', 'a tu favor') }}</p>
      </NuxtLink>
      <NuxtLink v-if="carePlan && planProgress" to="/visits" class="rounded-card border border-line bg-surface p-3 shadow-card" data-cy="patient-home-plan">
        <p class="text-[10.5px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('Plan', 'Plan') }}</p>
        <p class="mt-1 text-[20px] font-[640] tracking-tightTitle text-ink-900">{{ planProgress.done }}<span class="text-[13px] font-medium text-ink-muted"> {{ t('of', 'de') }} {{ carePlan.total_visits }}</span></p>
        <div class="mt-1.5 h-1 rounded-full bg-surface-subtle"><div class="h-1 rounded-full bg-brand" :style="{ width: `${planProgress.pct}%` }" /></div>
      </NuxtLink>
    </div>

    <NuxtLink
      v-if="exercises.length > 0"
      to="/exercises"
      class="mt-3 flex items-center justify-between rounded-card border border-line bg-surface px-4 py-3 shadow-card"
      data-cy="patient-home-exercises"
    >
      <span class="text-[13.5px] font-medium text-ink-900">
        {{ t('Your exercises', 'Tus ejercicios') }}
        <span class="ml-1 text-[12.5px] font-normal text-ink-faint">{{ exercises.length }}</span>
      </span>
      <span class="text-ink-faint"><AppChevron /></span>
    </NuxtLink>

    <!-- What the clinic sent them to read or watch -->
    <PatientLearnCard class="mt-3" :patient-id="props.patientId" :link-to="(id) => `/learn/${id}`" />

    <!-- Their referral link, when the clinic has the programme on -->
    <PatientReferralCard class="mt-3" :patient-id="props.patientId" />

    <!-- The clinic: where it is and how to reach it -->
    <PatientClinicCards class="mt-3" messages-to="/messages" />
  </div>
</template>

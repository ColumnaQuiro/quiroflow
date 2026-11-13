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
// Family accounts: the avatar opens whose app this is; with nobody to
// switch to it is the way to Account, as before.
const family = useFamily()
const familyOpen = ref(false)
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

const next = computed(() => upcoming.value[0] ?? null)

// What is unpaid, not the balance, as the staff record shows it
// (components/patient/BalanceCard.vue, utils/owing.ts): a family bono's
// beneficiary was shown a debt for visits already paid for from the bono.
const amountDueCents = computed(() => outstandingCents.value)
const sessionsLeft = computed(() => activePackages.value.reduce((sum, p) => sum + Math.max(0, p.sessions_total - p.sessions_used), 0))

// At the clinic's hour, not the phone's: a patient whose phone is set to
// another zone saw a visit booked for 10:00 as 09:00.
const { zoneOf } = usePatientAppInfo()
// The next visit leads the back plane as two figures, the day and the time.
function visitDay(iso: string, clinicId?: string | null) {
  return new Date(iso).toLocaleDateString(locale.value, { weekday: 'long', day: 'numeric', timeZone: zoneOf(clinicId) })
}
function visitMonth(iso: string, clinicId?: string | null) {
  return new Date(iso).toLocaleDateString(locale.value, { month: 'long', timeZone: zoneOf(clinicId) })
}
function visitTime(iso: string, clinicId?: string | null) {
  return new Date(iso).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit', timeZone: zoneOf(clinicId) })
}

// The plan drawn as a spine: one vertebra per visit, widening down the back,
// the ones done filled, the next one ringed. Up to 24 drawn; a longer or
// open-ended plan shows its count without the drawing.
const spine = computed(() => {
  const total = carePlan.value?.total_visits ?? null
  const done = planProgress.value?.done ?? 0
  if (total === null || total < 2 || total > 24) return []
  return Array.from({ length: total }, (_, i) => ({
    state: i < done ? 'done' : i === done ? 'next' : 'ahead',
    width: Math.round(20 + (24 * i) / Math.max(1, total - 1)),
  }))
})
const visitsToGo = computed(() => Math.max(0, (carePlan.value?.total_visits ?? 0) - (planProgress.value?.done ?? 0)))
// The clinic(s) and the waitlist card's clinic: the next visit's, or the
// only one with nothing booked. The cards themselves are shared with the
// portal (components/patient).
const { clinics } = usePatientClinics()
const waitlistClinicId = computed(() => next.value?.clinic_id ?? (clinics.value.length === 1 ? clinics.value[0]!.id : null))

// The home-screen widget shows the next visit and the bono, as of now.
const homeWidget = useHomeWidget()
watch([next, activePackages, apptLoading, moneyLoading], () => {
  if (apptLoading.value || moneyLoading.value) return
  // The widget is the phone owner's own next visit, not whoever they last viewed.
  if (family.actingForOther.value) return
  homeWidget.publish(patientWidgetSnapshot({ next: next.value, packages: activePackages.value, clinic: clinics.value.find((c) => c.id === next.value?.clinic_id)?.name ?? clinics.value[0]?.name ?? null, timeZone: zoneOf(next.value?.clinic_id ?? null) }))
})

function eur(cents: number) {
  return formatEur(cents)
}
</script>

<template>
  <div class="flex min-h-full flex-1 flex-col">
    <!-- The back plane (assets/css/main.css): who this is and the one thing
         the app is opened for, the next visit, at the size it deserves. The
         shared check-in, confirm and calendar buttons are re-coloured by the
         plane. A readable column on an iPad rather than cards stretched. -->
    <header class="qf-plane qf-lip shrink-0 px-5 pt-4 md:px-[max(1.5rem,calc((100%_-_44rem)/2))]">
      <div class="flex items-center justify-between gap-3">
        <h1 class="min-w-0 truncate text-[22px] font-[650] tracking-[-0.02em] text-ink-900">
          {{ family.actingForOther.value ? t(`${patientFirstName}'s account`, `Cuenta de ${patientFirstName}`) : t(`Hi, ${patientFirstName}`, `Hola, ${patientFirstName}`) }}
        </h1>
        <div class="flex shrink-0 items-center gap-2">
          <button
            v-if="family.hasFamily.value"
            type="button"
            class="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-surface pl-1.5 pr-3.5 text-[14px] font-semibold text-ink-900"
            data-cy="family-switcher-toggle"
            @click="familyOpen = true"
          >
            <span
              class="flex h-8 w-8 items-center justify-center rounded-full text-[11.5px] font-semibold"
              :class="family.actingForOther.value ? 'bg-info-bg text-info-text' : 'bg-surface-subtle text-ink-900'"
            >{{ personInitials(family.active.value) }}</span>
            {{ t('Family', 'Familia') }}
          </button>
          <!-- Account, sign out and account deletion moved off the home header
               into their own screen: two of those three are destructive and
               they were sitting in the top bar of every visit to the app. -->
          <NuxtLink
            to="/account"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink-900"
            :aria-label="t('Account', 'Cuenta')"
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
              <path d="M8 8a2.6 2.6 0 100-5.2A2.6 2.6 0 008 8zM3.2 13.4c0-2.3 2.1-3.6 4.8-3.6s4.8 1.3 4.8 3.6" />
            </svg>
          </NuxtLink>
        </div>
      </div>

      <p class="mt-6 text-[13.5px] font-semibold text-ink-muted">{{ t('Your next visit', 'Tu próxima cita') }}</p>
      <div v-if="apptLoading" class="mt-2 pb-2"><UiSkeleton class="h-9 w-56 rounded-ctlSm opacity-30" /></div>
      <template v-else-if="next">
        <div class="mt-1 flex items-end justify-between gap-3" data-cy="patient-home-next">
          <div class="min-w-0">
            <p class="qf-figure text-[34px] text-ink-900 first-letter:uppercase">{{ visitDay(next.starts_at, next.clinic_id) }}</p>
            <p class="mt-0.5 text-[17px] text-ink-muted">{{ t('', 'de ') }}{{ visitMonth(next.starts_at, next.clinic_id) }}</p>
          </div>
          <p class="qf-figure shrink-0 text-[34px] text-ink-900">{{ visitTime(next.starts_at, next.clinic_id) }}</p>
        </div>
        <p class="mt-3 text-[15px] text-ink-700">
          {{ next.appointment_types?.name ?? t('Appointment', 'Cita') }}
          <template v-if="next.team_members?.full_name"> &middot; {{ next.team_members.full_name }}</template>
        </p>
        <!-- On the day: "Ya estoy aquí" on arrival (utils/selfCheckIn.ts). -->
        <PatientCheckIn class="mt-4" :appt="next" />
        <PatientConfirmVisit class="mt-3" :appt="next" :busy="confirmingId === next.id" @confirm="confirmAttendance" />
        <PatientNextVisitActions class="mt-3" :appointment-id="next.id" :clinic-id="next.clinic_id" />
        <div class="mt-1 flex flex-wrap gap-x-5">
          <!-- Changing it only where the clinic lets patients, and far enough off -->
          <NuxtLink v-if="settings.rescheduleEnabled && canChange(next)" :to="`/book?reschedule=${next.id}`" class="inline-flex min-h-11 items-center gap-1 text-[14px] font-semibold text-ink-900" data-cy="patient-home-reschedule">
            {{ t('Change this visit', 'Cambiar esta cita') }} <AppChevron :size="12" />
          </NuxtLink>
          <NuxtLink to="/visits" class="inline-flex min-h-11 items-center gap-1 text-[14px] font-semibold text-ink-900">
            {{ t('Your plan', 'Tu plan') }} <AppChevron :size="12" />
          </NuxtLink>
        </div>
      </template>
      <template v-else>
        <p class="qf-figure mt-1 text-[26px] text-ink-900">{{ t('Nothing booked yet.', 'No tienes ninguna cita reservada.') }}</p>
        <AppButton v-if="settings.bookingEnabled" to="/book" variant="primary" class="mt-4 w-full">
          {{ t('Book a visit', 'Reservar cita') }}
        </AppButton>
      </template>
      <div class="h-5" />
    </header>

    <div class="flex-1 px-4 pb-6 pt-1 md:px-[max(1.5rem,calc((100%_-_44rem)/2))]">
      <!-- Something owed: said first, with the way to settle it -->
      <section v-if="!moneyLoading && amountDueCents > 0" class="mb-3 flex items-center gap-3 rounded-card bg-danger-bg p-4" data-cy="patient-home-owed">
        <div class="min-w-0 flex-1">
          <p class="text-[15px] font-semibold text-danger-text">{{ t(`You owe ${eur(amountDueCents)}`, `Tienes ${eur(amountDueCents)} pendientes`) }}</p>
          <p v-if="!canPayOnline" class="mt-0.5 text-[13px] text-ink-700">{{ t('You can pay it at the clinic.', 'Lo puedes pagar en la clínica.') }}</p>
          <p v-if="payError" role="alert" class="mt-0.5 text-[13px] text-danger-text">{{ payError }}</p>
        </div>
        <button
          v-if="canPayOnline && unpaid.length > 0"
          type="button"
          class="h-11 shrink-0 rounded-full bg-danger-text px-5 text-[14px] font-semibold text-danger-on disabled:opacity-60"
          :disabled="payingId !== null"
          data-cy="patient-home-pay"
          @click="payOutstanding"
        >
          {{ payingId ? t('Opening…', 'Abriendo…') : t('Pay', 'Pagar') }}
        </button>
      </section>

      <!-- The summary of the Plan tab: the care plan as a spine, then
           sessions and credit -->
      <div data-cy="patient-home-summary" class="flex flex-col gap-3">
        <NuxtLink v-if="carePlan && planProgress" to="/visits" class="flex gap-5 rounded-card bg-surface p-4 shadow-card" data-cy="patient-home-plan">
          <div v-if="spine.length" class="flex w-11 shrink-0 flex-col items-center gap-1 pt-0.5" role="img" :aria-label="t(`Plan: ${planProgress.done} of ${carePlan.total_visits} visits done`, `Plan: ${planProgress.done} de ${carePlan.total_visits} visitas hechas`)">
            <span
              v-for="(v, i) in spine"
              :key="i"
              class="block rounded-[5px]"
              :class="v.state === 'done' ? 'bg-brand' : v.state === 'next' ? 'bg-surface ring-[2.5px] ring-inset ring-brand' : 'bg-chip-bg'"
              :style="{ width: `${v.width}px`, height: spine.length > 16 ? '7px' : '11px' }"
            />
          </div>
          <div class="flex min-w-0 flex-1 flex-col">
            <p class="text-[13.5px] font-semibold text-ink-muted">{{ t('Your care plan', 'Tu plan de tratamiento') }}</p>
            <p v-if="carePlan.total_visits === null" class="qf-figure mt-1 text-[30px] text-ink-900">{{ planProgress.done }}<span class="text-[16px] font-medium tracking-normal text-ink-muted"> {{ planProgress.done === 1 ? t('visit', 'visita') : t('visits', 'visitas') }}</span></p>
            <p v-else class="qf-figure mt-1 text-[30px] text-ink-900">{{ planProgress.done }}<span class="text-[16px] font-medium tracking-normal text-ink-muted"> {{ t('of', 'de') }} {{ carePlan.total_visits }} {{ t('visits', 'visitas') }}</span></p>
            <p v-if="carePlan.total_visits !== null" class="mt-1 text-[14px] text-ink-muted">
              {{ visitsToGo === 1 ? t('1 visit to go', 'Te queda 1 visita') : t(`${visitsToGo} visits to go`, `Te quedan ${visitsToGo} visitas`) }}
            </p>
            <div v-if="carePlan.total_visits !== null && !spine.length" class="mt-3 h-2 rounded-full bg-chip-bg"><div class="h-2 rounded-full bg-brand" :style="{ width: `${planProgress.pct}%` }" /></div>
            <span class="mt-auto inline-flex items-center gap-1 pt-3 text-[14px] font-semibold text-brand-text">{{ t('See the plan', 'Ver el plan') }} <AppChevron :size="12" /></span>
          </div>
        </NuxtLink>

        <div class="grid grid-cols-2 gap-3">
          <NuxtLink to="/visits" class="rounded-card bg-surface p-4 shadow-card">
            <p class="text-[13.5px] font-semibold text-ink-muted">{{ t('Sessions', 'Sesiones') }}</p>
            <p v-if="moneyLoading" class="mt-2"><UiSkeleton class="h-8 w-10 rounded-ctlSm" /></p>
            <p v-else class="qf-figure mt-1 text-[30px] text-ink-900">{{ sessionsLeft }}</p>
            <p class="text-[13px] text-ink-muted">{{ t('left', 'te quedan') }}</p>
          </NuxtLink>
          <NuxtLink to="/visits" class="rounded-card bg-surface p-4 shadow-card">
            <p class="text-[13.5px] font-semibold text-ink-muted">{{ t('Credit', 'Saldo') }}</p>
            <p v-if="moneyLoading" class="mt-2"><UiSkeleton class="h-8 w-16 rounded-ctlSm" /></p>
            <p v-else class="qf-figure mt-1 text-[30px] text-ink-900">{{ eur(creditLedgerCents) }}</p>
            <p class="text-[13px] text-ink-muted">{{ t('in your favour', 'a tu favor') }}</p>
          </NuxtLink>
        </div>
      </div>

      <!-- Earlier, if a slot frees up: the clinic's waitlist -->
      <PatientWaitlistCard v-if="settings.bookingEnabled && !apptLoading" class="mt-3" :clinic-id="waitlistClinicId" :has-next-visit="!!next" />

      <!-- Exercises live on Cuidarme now; Documentos left the tab bar for it,
           so on a phone it opens from here (useAppNav.ts). -->
      <NuxtLink
        v-if="family.canSeeClinical.value"
        to="/documents"
        class="mt-3 flex min-h-[56px] items-center justify-between rounded-card bg-surface px-4 shadow-card md:hidden"
        data-cy="patient-home-documents"
      >
        <span class="text-[15px] font-semibold text-ink-900">{{ t('Your documents', 'Tus documentos') }}</span>
        <span class="text-ink-faint"><AppChevron /></span>
      </NuxtLink>

      <!-- What the clinic sent them to read or watch -->
      <PatientLearnCard v-if="family.canSeeClinical.value" class="mt-3" :patient-id="props.patientId" :link-to="(id) => `/learn/${id}`" />

      <!-- Their referral link, when the clinic has the programme on -->
      <PatientReferralCard v-if="!family.actingForOther.value" class="mt-3" :patient-id="props.patientId" />

      <!-- The clinic: where it is and how to reach it -->
      <PatientClinicCards class="mt-3" messages-to="/messages" />
    </div>
    <FamilySheet v-if="familyOpen" @close="familyOpen = false" />
  </div>
</template>

<script lang="ts">
// Across mounts of this screen within one app run.
let shownBefore = false
</script>

<script setup lang="ts">
import { formatEur } from '../../utils/billing'
import { directionsUrl, telUrl } from '../../utils/clinicLinks'

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

const { upcoming, loading: apptLoading } = usePatientAppointments(
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
// Getting there and getting in touch: the visit's clinic, its directions in
// the phone's own maps app, its phone, and the visit in the phone's calendar.
const { clinics, clinicOf } = usePatientClinics()
const platform = import.meta.client ? ((window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() ?? 'web') : 'web'
const nextClinic = computed(() => clinicOf(next.value?.clinic_id))
const nextDirections = computed(() => (nextClinic.value ? directionsUrl(nextClinic.value, platform) : null))
function openUrl(url: string) {
  openWhenReady(async () => url)
}

const authedFetch = useAuthedFetch()
const calendarBusy = ref(false)
const calendarError = ref('')
async function addToCalendar(appointmentId: string) {
  calendarBusy.value = true
  calendarError.value = ''
  try {
    await openWhenReady(async () => (await authedFetch<{ url: string }>('/api/portal/appointments/calendar-link', { method: 'POST', body: { appointmentId } })).url)
  } catch {
    calendarError.value = t("Couldn't prepare it for your calendar. Try again.", 'No se ha podido preparar para tu calendario. Inténtalo de nuevo.')
  } finally {
    calendarBusy.value = false
  }
}

// "Avísame si queda un hueco antes", at the next visit's clinic -- or the
// only clinic, with nothing booked. Offered where the clinic lets patients
// book from the app, which is also what join_my_waitlist checks.
const { entries: waitlist, busy: waitlistBusy, error: waitlistError, join: joinWaitlist, leave: leaveWaitlist } = usePatientWaitlist()
const waitlistClinicId = computed(() => next.value?.clinic_id ?? (clinics.value.length === 1 ? clinics.value[0]!.id : null))
const myWaitlistEntry = computed(() => waitlist.value.find((e) => e.clinic_id === waitlistClinicId.value) ?? null)

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
        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" class="min-h-9 rounded-ctl border border-line-control px-3 text-[12.5px] font-medium text-ink-700 active:bg-surface-subtle" :disabled="calendarBusy" data-cy="patient-add-to-calendar" @click="addToCalendar(next.id)">
            {{ calendarBusy ? t('Preparing…', 'Preparando…') : t('Add to calendar', 'Añadir al calendario') }}
          </button>
          <button v-if="nextDirections" type="button" class="min-h-9 rounded-ctl border border-line-control px-3 text-[12.5px] font-medium text-ink-700 active:bg-surface-subtle" data-cy="patient-next-directions" @click="openUrl(nextDirections)">
            {{ t('Directions', 'Cómo llegar') }}
          </button>
        </div>
        <p v-if="calendarError" role="alert" class="mt-2 text-[12.5px] text-danger-text">{{ calendarError }}</p>
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
    <section v-if="settings.bookingEnabled && waitlistClinicId && !apptLoading" class="mt-3 rounded-card border border-line bg-surface p-4 shadow-card" data-cy="patient-waitlist">
      <template v-if="myWaitlistEntry">
        <p class="text-[13.5px] font-medium text-ink-900">{{ t("You're on the waitlist", 'Estás en la lista de espera') }}</p>
        <p class="mt-0.5 text-[12.5px] text-ink-muted">
          {{ myWaitlistEntry.status === 'offered'
            ? t('The clinic has offered you a slot: check your messages.', 'La clínica te ha ofrecido un hueco: revisa tus mensajes.')
            : t("We'll let you know if an earlier slot frees up.", 'Te avisaremos si queda libre un hueco antes.') }}
        </p>
        <button v-if="myWaitlistEntry.status === 'waiting'" type="button" class="mt-2 text-[12.5px] font-medium text-danger-text" :disabled="waitlistBusy" data-cy="patient-waitlist-leave" @click="leaveWaitlist(myWaitlistEntry.id)">
          {{ t('Leave the waitlist', 'Salir de la lista de espera') }}
        </button>
      </template>
      <template v-else>
        <p class="text-[13.5px] font-medium text-ink-900">{{ next ? t('Would earlier suit you?', '¿Te vendría bien antes?') : t('No slot that suits you?', '¿No encuentras hueco?') }}</p>
        <p class="mt-0.5 text-[12.5px] text-ink-muted">{{ t("Join the waitlist and we'll let you know if a slot frees up.", 'Apúntate a la lista de espera y te avisaremos si queda un hueco libre.') }}</p>
        <button type="button" class="mt-2 min-h-9 rounded-ctl bg-brand px-3.5 text-[13px] font-semibold text-white" :disabled="waitlistBusy" data-cy="patient-waitlist-join" @click="joinWaitlist(waitlistClinicId)">
          {{ waitlistBusy ? t('Adding you…', 'Apuntándote…') : t('Let me know', 'Avísame') }}
        </button>
      </template>
      <p v-if="waitlistError" role="alert" class="mt-2 text-[12.5px] text-danger-text">{{ waitlistError }}</p>
    </section>

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
    <section v-for="c in clinics" :key="c.id" class="mt-3 rounded-card border border-line bg-surface p-4 shadow-card" data-cy="patient-clinic">
      <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('Your clinic', 'Tu clínica') }}</p>
      <p class="mt-1 text-[14.5px] font-semibold text-ink-900">{{ c.name }}</p>
      <p v-if="c.address" class="mt-0.5 text-[12.5px] text-ink-muted">{{ c.address }}</p>
      <div class="mt-2.5 flex flex-wrap gap-2">
        <a v-if="telUrl(c.phone)" :href="telUrl(c.phone)!" class="flex min-h-9 items-center rounded-ctl border border-line-control px-3 text-[12.5px] font-medium text-ink-700 active:bg-surface-subtle" data-cy="patient-clinic-call">{{ t('Call', 'Llamar') }}</a>
        <button v-if="directionsUrl(c, platform)" type="button" class="min-h-9 rounded-ctl border border-line-control px-3 text-[12.5px] font-medium text-ink-700 active:bg-surface-subtle" data-cy="patient-clinic-directions" @click="openUrl(directionsUrl(c, platform)!)">{{ t('Directions', 'Cómo llegar') }}</button>
        <NuxtLink to="/messages" class="flex min-h-9 items-center rounded-ctl border border-line-control px-3 text-[12.5px] font-medium text-ink-700 active:bg-surface-subtle">{{ t('Message', 'Escribir') }}</NuxtLink>
      </div>
    </section>

    <section class="mt-5">
      <h2 class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('Care plan', 'Plan de tratamiento') }}</h2>
      <div class="mt-2">
        <PatientsPhaseStats :patient-id="props.patientId" :editable="false" />
      </div>
    </section>
  </div>
</template>

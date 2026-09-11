<script setup lang="ts">
// The patient's home screen: the two things the app gets opened for --
// when am I next in, what do I have left -- and a way through to the rest.
//
// It used to stack every section here (appointments, balance, invoices,
// files, care plan) in one scroll, because there was nowhere else to put
// them. They now have tabs of their own; see mobile/layouts/patient.vue.
const props = defineProps<{ patientId: string; patientFirstName: string }>()

const t = useT()
const { settings } = usePatientAppInfo()

const { upcoming, loading: apptLoading } = usePatientAppointments(
  () => props.patientId,
  () => settings.value,
)
const { loading: moneyLoading, balanceCents, creditLedgerCents, activePackages } = usePatientFinancialSummary(() => props.patientId)
const { documents } = usePatientDocuments(() => props.patientId)

const next = computed(() => upcoming.value[0] ?? null)
const amountDueCents = computed(() => (balanceCents.value < 0 ? -balanceCents.value : 0))
const sessionsLeft = computed(() => activePackages.value.reduce((sum, p) => sum + Math.max(0, p.sessions_total - p.sessions_used), 0))

function longWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}
function eur(cents: number) {
  return `€${(cents / 100).toFixed(2)}`
}
</script>

<template>
  <div class="p-4">
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
      <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-faint">{{ t('Your next visit', 'Tu próxima cita') }}</p>
      <div v-if="apptLoading" class="mt-2"><UiSkeleton class="h-6 w-48 rounded-ctlSm" /></div>
      <template v-else-if="next">
        <p class="mt-1.5 text-[17px] font-[640] leading-snug tracking-tightTitle text-ink-900 first-letter:uppercase">{{ longWhen(next.starts_at) }}</p>
        <p class="mt-1 text-[13px] text-ink-muted">
          {{ next.appointment_types?.name ?? t('Appointment', 'Cita') }}
          <template v-if="next.team_members?.full_name"> &middot; {{ next.team_members.full_name }}</template>
        </p>
        <NuxtLink to="/visits" class="mt-3 inline-block text-[12.5px] font-medium text-brand-text">
          {{ t('See all visits', 'Ver todas las citas') }} &rarr;
        </NuxtLink>
      </template>
      <template v-else>
        <p class="mt-1.5 text-[15px] text-ink-muted">{{ t('Nothing booked yet.', 'No tienes ninguna cita reservada.') }}</p>
        <NuxtLink v-if="settings.bookingEnabled" to="/book" class="mt-3 inline-block text-[12.5px] font-medium text-brand-text">
          {{ t('Book a visit', 'Reservar cita') }} &rarr;
        </NuxtLink>
      </template>
    </section>

    <div class="mt-3 grid grid-cols-2 gap-3">
      <NuxtLink to="/billing" class="rounded-card border border-line bg-surface p-3.5 shadow-card">
        <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-faint">{{ t('Sessions left', 'Sesiones') }}</p>
        <p v-if="moneyLoading" class="mt-2"><UiSkeleton class="h-6 w-10 rounded-ctlSm" /></p>
        <p v-else class="mt-1 text-[22px] font-[640] tracking-tightTitle text-ink-900">{{ sessionsLeft }}</p>
      </NuxtLink>
      <NuxtLink to="/billing" class="rounded-card border border-line bg-surface p-3.5 shadow-card">
        <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-faint">
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
      <span class="text-[13px] text-ink-faint">&rarr;</span>
    </NuxtLink>

    <section class="mt-5">
      <h2 class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-faint">{{ t('Care plan', 'Plan de tratamiento') }}</h2>
      <div class="mt-2">
        <PatientsPhaseStats :patient-id="props.patientId" :editable="false" />
      </div>
    </section>
  </div>
</template>

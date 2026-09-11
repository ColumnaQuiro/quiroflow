<script setup lang="ts">
// The portal's home: the two things a patient opens it for -- when am I
// next in, and what do I have left -- and a way through to everything else.
//
// It deliberately does NOT stack every section any more. Appointments,
// invoices, documents and messages each have their own page now (see
// layouts/portal.vue); this summarises and links.
definePageMeta({ layout: 'portal' })

const t = useT()
const { settings } = usePatientAppInfo()
const { patient, loading: patientLoading, loadError } = usePortalPatient()

const patientId = computed(() => patient.value?.id ?? '')
const { upcoming, loading: apptLoading } = usePatientAppointments(
  () => patientId.value,
  () => settings.value,
)
const { loading: moneyLoading, balanceCents, creditLedgerCents, activePackages } = usePatientFinancialSummary(() => patientId.value)
const { documents } = usePatientDocuments(() => patientId.value)

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
  <div>
    <div v-if="patientLoading" class="space-y-4">
      <UiSkeleton class="h-7 w-48 rounded-ctlSm" />
      <UiSkeleton class="h-28 w-full rounded-card" />
      <UiSkeleton class="h-24 w-full rounded-card" />
    </div>
    <p v-else-if="loadError" class="text-sm text-danger-text">{{ loadError }}</p>
    <p v-else-if="!patient" class="text-sm text-ink-faint">{{ t('No patient record found.', 'No se encontró tu ficha de paciente.') }}</p>

    <template v-else>
      <PortalPageHead :title="t(`Hi, ${patient.first_name}`, `Hola, ${patient.first_name}`)" />

      <!-- The next visit is the headline, not a row in a list. -->
      <section class="rounded-card border border-line bg-surface p-5 shadow-card">
        <p class="text-[11.5px] font-[640] uppercase tracking-[.05em] text-ink-faint">{{ t('Your next visit', 'Tu próxima cita') }}</p>
        <div v-if="apptLoading" class="mt-2"><UiSkeleton class="h-6 w-56 rounded-ctlSm" /></div>
        <template v-else-if="next">
          <p class="mt-1.5 text-[19px] font-[640] tracking-tightTitle text-ink-900 first-letter:uppercase">{{ longWhen(next.starts_at) }}</p>
          <p class="mt-1 text-[13.5px] text-ink-muted">
            {{ next.appointment_types?.name ?? t('Appointment', 'Cita') }}
            <template v-if="next.team_members?.full_name"> &middot; {{ next.team_members.full_name }}</template>
          </p>
          <NuxtLink to="/portal/appointments" class="mt-3 inline-block text-[12.5px] font-medium text-brand-text hover:text-brand-hover">
            {{ t('See all appointments', 'Ver todas las citas') }} &rarr;
          </NuxtLink>
        </template>
        <template v-else>
          <p class="mt-1.5 text-[15px] text-ink-muted">{{ t('Nothing booked yet.', 'No tienes ninguna cita reservada.') }}</p>
          <p class="mt-1 text-[13px] text-ink-faint">{{ t('Contact the clinic to book your next visit.', 'Contacta con la clínica para reservar tu próxima cita.') }}</p>
        </template>
      </section>

      <!-- Two numbers, never netted into one: sessions are not money, and a
           patient holding a bono while owing an instalment needs to see
           both. Same reasoning as UiBalancePill's. -->
      <div class="mt-4 grid grid-cols-2 gap-3">
        <NuxtLink to="/portal/billing" class="rounded-card border border-line bg-surface p-4 shadow-card hover:border-line-controlHover">
          <p class="text-[11.5px] font-[640] uppercase tracking-[.05em] text-ink-faint">{{ t('Sessions left', 'Sesiones restantes') }}</p>
          <p v-if="moneyLoading" class="mt-2"><UiSkeleton class="h-7 w-12 rounded-ctlSm" /></p>
          <p v-else class="mt-1 text-[24px] font-[640] tracking-tightTitle text-ink-900">{{ sessionsLeft }}</p>
        </NuxtLink>
        <NuxtLink to="/portal/billing" class="rounded-card border border-line bg-surface p-4 shadow-card hover:border-line-controlHover">
          <p class="text-[11.5px] font-[640] uppercase tracking-[.05em] text-ink-faint">
            {{ amountDueCents > 0 ? t('You owe', 'Pendiente') : t('Your credit', 'Tu saldo') }}
          </p>
          <p v-if="moneyLoading" class="mt-2"><UiSkeleton class="h-7 w-20 rounded-ctlSm" /></p>
          <p v-else class="mt-1 text-[24px] font-[640] tracking-tightTitle" :class="amountDueCents > 0 ? 'text-danger-text' : 'text-ink-900'">
            {{ eur(amountDueCents > 0 ? amountDueCents : creditLedgerCents) }}
          </p>
        </NuxtLink>
      </div>

      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <NuxtLink
          to="/portal/messages"
          class="flex items-center justify-between rounded-card border border-line bg-surface px-4 py-3.5 shadow-card hover:border-line-controlHover"
        >
          <span class="text-[13.5px] font-medium text-ink-900">{{ t('Message the clinic', 'Escribir a la clínica') }}</span>
          <span class="text-[13px] text-ink-faint">&rarr;</span>
        </NuxtLink>
        <NuxtLink
          to="/portal/documents"
          class="flex items-center justify-between rounded-card border border-line bg-surface px-4 py-3.5 shadow-card hover:border-line-controlHover"
        >
          <span class="text-[13.5px] font-medium text-ink-900">
            {{ t('Your documents', 'Tus documentos') }}
            <span v-if="documents.length > 0" class="ml-1 text-[12.5px] font-normal text-ink-faint">{{ documents.length }}</span>
          </span>
          <span class="text-[13px] text-ink-faint">&rarr;</span>
        </NuxtLink>
      </div>
    </template>
  </div>
</template>

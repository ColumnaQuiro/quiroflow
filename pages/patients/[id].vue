<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const route = useRoute()
const supabase = useSupabaseClient()
const patientId = route.params.id as string

const patient = ref<Tables<'patients'> | null>(null)
const notFound = ref(false)
const loading = ref(true)

async function loadPatient() {
  loading.value = true
  const { data } = await supabase.from('patients').select('*').eq('id', patientId).maybeSingle()
  patient.value = data
  notFound.value = !data
  loading.value = false
}
onMounted(loadPatient)

const { balanceCents, creditLedgerCents, activePackages, loading: financialLoading } = usePatientFinancialSummary(patientId)

const isVip = computed(() => !!patient.value?.tags.some((t) => t.toUpperCase() === 'VIP'))
const amountDue = computed(() => (balanceCents.value < 0 ? -balanceCents.value : 0))

// Minors get no communications at all -- the tab and every send entry point
// are hidden rather than merely disabled, matching how do-not-contact
// already blocks sends server-side.
const canContact = computed(() => !patient.value?.is_minor && !patient.value?.do_not_contact)

const tabs = computed(() => [
  { key: 'overview', label: 'Overview' },
  { key: 'appointments', label: 'Appointments' },
  { key: 'visit-notes', label: 'Visit notes' },
  { key: 'billing', label: 'Billing' },
  ...(patient.value?.is_minor ? [] : [{ key: 'communications', label: 'Communications' }]),
  { key: 'docs', label: 'Docs' },
  { key: 'files', label: 'Files' },
])

const activeTab = computed({
  get: () => (route.query.tab as string) ?? 'overview',
  set: (value) => navigateTo({ path: route.path, query: { ...route.query, tab: value } }),
})

// Purely presentational -- variant B (summary-bar layout) isn't built, so
// the right-hand option is shown but inert.
const layoutVariant = ref<'rail' | 'summary'>('rail')

const whatsAppOpen = ref(false)

// Charge (sidebar) should always land on Billing's "Take payment" panel --
// switching tabs alone is a no-op when Billing is already the active tab.
const chargeRequested = ref(false)
function handleCharge() {
  chargeRequested.value = true
  activeTab.value = 'billing'
}
</script>

<template>
  <div v-if="loading" class="flex h-full items-center justify-center text-[13px] text-ink-faint">Loading…</div>
  <div v-else-if="notFound" class="flex h-full items-center justify-center text-[13px] text-ink-faint">Patient not found.</div>
  <div v-else-if="patient" class="flex h-full flex-col">
    <header class="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-6">
      <div class="flex min-w-0 items-center gap-2.5">
        <NuxtLink
          to="/patients"
          class="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-ctlSm text-ink-muted hover:bg-surface-subtle hover:text-ink-700"
          title="Back to patients"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
            <path d="M10 3.5L5 8l5 4.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </NuxtLink>
        <NuxtLink to="/patients" class="shrink-0 text-[13px] text-ink-muted2 hover:text-ink-700">Patients /</NuxtLink>
        <h1 class="truncate text-[14.5px] font-[620] text-ink-900">{{ patient.first_name }} {{ patient.last_name }}</h1>
        <div class="flex shrink-0 items-center gap-1.5">
          <UiPill v-if="isVip" tone="brand" :dot="true">VIP</UiPill>
          <UiPill v-if="amountDue > 0" tone="danger">€{{ (amountDue / 100).toFixed(2) }} due</UiPill>
          <UiPill v-if="patient.is_minor" tone="brand">Minor</UiPill>
          <UiPill v-if="patient.do_not_contact" tone="danger">Do not contact</UiPill>
        </div>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <div class="flex items-center rounded-ctl border border-line-control p-0.5" title="Layout: rail (only variant available)">
          <button
            type="button"
            class="flex h-6 w-7 items-center justify-center rounded-[6px]"
            :class="layoutVariant === 'rail' ? 'bg-brand-tint text-brand-text' : 'text-ink-faint'"
            @click="layoutVariant = 'rail'"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1" y="1" width="4" height="12" rx="0.8" /><rect x="6.5" y="1" width="6.5" height="12" rx="0.8" /></svg>
          </button>
          <button
            type="button"
            class="flex h-6 w-7 items-center justify-center rounded-[6px] text-ink-faint2 opacity-50"
            title="Summary layout isn't available yet"
            @click="layoutVariant = 'rail'"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1" y="1" width="12" height="3.5" rx="0.8" /><rect x="1" y="6" width="12" height="7" rx="0.8" /></svg>
          </button>
        </div>
        <UiBtn v-if="canContact" variant="secondary" @click="whatsAppOpen = true">Message</UiBtn>
        <UiBtn variant="primary" @click="navigateTo('/calendar')">Book visit</UiBtn>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto bg-surface-page">
      <div class="flex items-start gap-6 px-6 py-6">
        <PatientsDetailSidebar
          :patient="patient"
          :balance-cents="balanceCents"
          :credit-cents="creditLedgerCents"
          :active-packages="activePackages"
          :financial-loading="financialLoading"
          class="sticky top-6"
          @message="whatsAppOpen = true"
          @charge="handleCharge"
          @photo-updated="loadPatient"
        />

        <div class="min-w-0 flex-1">
          <nav class="sticky top-6 z-10 flex gap-1 border-b border-chip-border bg-surface-page">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              type="button"
              class="h-9 shrink-0 px-[11px] text-[13.5px]"
              :class="
                activeTab === tab.key
                  ? 'font-semibold text-ink-700 shadow-[inset_0_-2px_0_#4F46E5]'
                  : 'text-ink-muted hover:text-ink-600'
              "
              @click="activeTab = tab.key"
            >
              {{ tab.label }}
            </button>
          </nav>

          <div class="mt-4">
            <PatientsOverviewTab v-if="activeTab === 'overview'" :patient="patient" @updated="loadPatient" />
            <PatientsAppointmentsTab
              v-else-if="activeTab === 'appointments'"
              :patient-id="patientId"
              :first-name="patient.first_name"
              :last-name="patient.last_name"
              :preferred-language="patient.preferred_language"
            />
            <PatientsVisitNotesTab v-else-if="activeTab === 'visit-notes'" :patient-id="patientId" />
            <PatientsBillingTab
              v-else-if="activeTab === 'billing'"
              :patient-id="patientId"
              :open-payment-trigger="chargeRequested"
              @payment-trigger-consumed="chargeRequested = false"
            />
            <PatientsCommunicationsTab
              v-else-if="activeTab === 'communications'"
              :patient-id="patientId"
              :first-name="patient.first_name"
              :preferred-language="patient.preferred_language"
              :can-contact="canContact"
            />
            <PatientsDocsTab v-else-if="activeTab === 'docs'" :patient-id="patientId" />
            <PatientsFilesTab v-else-if="activeTab === 'files'" :patient-id="patientId" />
          </div>
        </div>
      </div>
    </div>

    <SendWhatsAppModal
      v-if="whatsAppOpen"
      :patient-id="patient.id"
      :patient-first-name="patient.first_name"
      :patient-preferred-language="patient.preferred_language"
      @close="whatsAppOpen = false"
      @sent="whatsAppOpen = false"
    />
  </div>
</template>

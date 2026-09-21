<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import type { Tables } from '~/types/database.types'

const route = useRoute()
const supabase = useSupabaseClient()
const t = useT()
const { can } = usePermission()
const { showToast } = useToast()
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

const { balanceCents, availableCents, creditLedgerCents, bonoValueCents, activePackages, loading: financialLoading } = usePatientFinancialSummary(patientId)

const isVip = computed(() => !!patient.value?.tags.some((t) => t.toUpperCase() === 'VIP'))
const amountDue = computed(() => (balanceCents.value < 0 ? -balanceCents.value : 0))

// Minors get no communications at all -- the tab and every send entry point
// are hidden rather than merely disabled, matching how do-not-contact
// already blocks sends server-side.
const canContact = computed(() => !patient.value?.is_minor && !patient.value?.do_not_contact)

const tabs = computed(() => [
  { key: 'overview', label: t('Overview', 'Resumen') },
  { key: 'appointments', label: t('Appointments', 'Citas') },
  { key: 'visit-notes', label: t('Visit notes', 'Notas de visita') },
  { key: 'billing', label: t('Billing', 'Facturación') },
  // Also hidden without inbox_access: 0164 stops those roles reading
  // messages at all, so the tab would render an empty thread that reads as
  // "this patient has never been contacted" -- worse than not offering it.
  ...(patient.value?.is_minor || !can('inbox_access') ? [] : [{ key: 'communications', label: t('Communications', 'Comunicaciones') }]),
  { key: 'docs', label: t('Docs', 'Documentos') },
  { key: 'files', label: t('Files', 'Archivos') },
])

const activeTab = computed({
  get: () => (route.query.tab as string) ?? 'overview',
  set: (value) => navigateTo({ path: route.path, query: { ...route.query, tab: value } }),
})

const whatsAppOpen = ref(false)

// Merging is the answer to the duplicate records the PracticeHub migration
// left behind, and to the ones a front desk creates by booking the same person
// twice. Deleting one of a pair is not the same thing: every FK into patients
// cascades, so the "empty" duplicate takes its bonos and credit with it. See
// 0160_merge_patients.sql.
const mergeOpen = ref(false)
async function onMerged(survivorId: string) {
  mergeOpen.value = false
  if (survivorId === patientId) {
    await loadPatient()
    return
  }
  // The record being viewed is the one that was absorbed, so there is nothing
  // left at this URL.
  await navigateTo(`/patients/${survivorId}`)
}

// Charge (sidebar) should always land on Billing's "Take payment" panel --
// switching tabs alone is a no-op when Billing is already the active tab.
const chargeRequested = ref(false)
function handleCharge() {
  chargeRequested.value = true
  activeTab.value = 'billing'
}

// Archiving is the reversible alternative to Delete below -- just flips the
// same status column the Overview tab's edit form already exposes (see
// 0063_patient_status_minor_tutor_dnc.sql), as a one-click toggle instead of
// opening that form. Gated by patients_edit since that's what the RLS update
// policy on patients checks (0044_rbac_row_scope_appointments_patients.sql).
const archiving = ref(false)
async function toggleArchived() {
  if (!patient.value || archiving.value) return
  archiving.value = true
  try {
    const nextStatus = patient.value.status === 'active' ? 'inactive' : 'active'
    const { error } = await supabase.from('patients').update({ status: nextStatus }).eq('id', patientId)
    if (error) {
      showToast(error.message, 'error')
      return
    }
    patient.value.status = nextStatus
    showToast(nextStatus === 'inactive' ? t('Patient archived', 'Paciente archivado') : t('Patient unarchived', 'Paciente desarchivado'))
  } finally {
    archiving.value = false
  }
}

// Deleting a patient cascades in the database -- appointments, invoices,
// payments, docs, files, package purchases, everything keyed off patient_id
// (see 0044_rbac_row_scope_appointments_patients.sql for the RLS policy
// this button relies on; the FKs themselves are `on delete cascade` from
// 0001_init_schema.sql onward). That's permanent and wipes financial/clinical
// records a clinic may be legally required to retain, so the confirmation
// names what's actually at stake rather than a generic "are you sure".
const deleting = ref(false)
async function deletePatient() {
  if (!patient.value || deleting.value) return
  deleting.value = true
  try {
    const [{ count: appointmentCount }, { count: invoiceCount }] = await Promise.all([
      supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('patient_id', patientId),
      supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('patient_id', patientId),
    ])
    const name = `${patient.value.first_name} ${patient.value.last_name ?? ''}`.trim()
    const warning = t(
      `Permanently delete ${name}? This also deletes ${appointmentCount ?? 0} appointment(s) and ${invoiceCount ?? 0} invoice(s), plus every document, file, and message tied to them. This can't be undone.`,
      `¿Eliminar permanentemente a ${name}? Esto también elimina ${appointmentCount ?? 0} cita(s) y ${invoiceCount ?? 0} factura(s), además de todos los documentos, archivos y mensajes asociados. Esta acción no se puede deshacer.`,
    )
    if (!confirm(warning)) return

    const { error } = await supabase.from('patients').delete().eq('id', patientId)
    if (error) {
      showToast(error.message, 'error')
      return
    }
    await navigateTo('/patients')
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div v-if="loading" class="flex h-full flex-col">
    <header class="flex h-14 shrink-0 items-center gap-2.5 border-b border-line bg-surface px-4 sm:px-6">
      <UiSkeleton class="h-[15px] w-40 rounded" />
    </header>
    <div class="flex-1 overflow-y-auto bg-surface-page">
      <div class="flex flex-col items-start gap-6 px-4 py-6 sm:px-6 lg:flex-row">
        <div class="w-full shrink-0 rounded-card border border-line bg-surface p-4 lg:w-[280px]">
          <UiSkeleton class="mx-auto h-16 w-16 rounded-full" />
          <UiSkeleton class="mx-auto mt-3 h-4 w-32 rounded" />
          <div class="mt-5 space-y-3">
            <UiSkeleton v-for="i in 5" :key="i" class="h-3.5 w-full rounded" />
          </div>
        </div>
        <div class="min-w-0 w-full flex-1">
          <div class="flex gap-4 border-b border-chip-border pb-3">
            <UiSkeleton v-for="i in 5" :key="i" class="h-4 w-16 rounded" />
          </div>
          <div class="mt-5 space-y-3">
            <UiSkeleton v-for="i in 6" :key="i" class="h-4 w-full rounded" />
          </div>
        </div>
      </div>
    </div>
  </div>
  <div v-else-if="notFound" class="flex h-full items-center justify-center text-[13px] text-ink-faint">{{ t('Patient not found.', 'Paciente no encontrado.') }}</div>
  <div v-else-if="patient" class="flex h-full flex-col">
    <header class="flex shrink-0 flex-col gap-2.5 border-b border-line bg-surface px-4 py-2.5 lg:h-14 lg:flex-row lg:items-center lg:justify-between lg:px-6 lg:py-0">
      <div class="flex min-w-0 items-center gap-2.5">
        <NuxtLink
          to="/patients"
          class="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-ctlSm text-ink-muted hover:bg-surface-subtle hover:text-ink-700"
          :title="t('Back to patients', 'Volver a pacientes')"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
            <path d="M10 3.5L5 8l5 4.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </NuxtLink>
        <NuxtLink to="/patients" class="hidden shrink-0 text-[13px] text-ink-muted2 hover:text-ink-700 sm:inline">{{ t('Patients /', 'Pacientes /') }}</NuxtLink>
        <h1 class="truncate text-[14.5px] font-[620] text-ink-900">{{ patient.first_name }} {{ patient.last_name }}</h1>
        <div class="flex shrink-0 flex-wrap items-center gap-1.5">
          <UiPill v-if="isVip" tone="brand" :dot="true">{{ t('VIP', 'VIP') }}</UiPill>
          <UiPill v-if="amountDue > 0" tone="danger">{{ formatEur(amountDue) }} {{ t('due', 'pendiente') }}</UiPill>
          <UiPill v-if="patient.is_minor" tone="brand">{{ t('Minor', 'Menor') }}</UiPill>
          <UiPill v-if="patient.do_not_contact" tone="danger">{{ t('Do not contact', 'No contactar') }}</UiPill>
        </div>
      </div>

      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <UiBtn v-if="canContact" variant="secondary" @click="whatsAppOpen = true">{{ t('Message', 'Mensaje') }}</UiBtn>
        <UiBtn variant="primary" @click="navigateTo('/calendar')">{{ t('Book visit', 'Reservar visita') }}</UiBtn>
        <UiBtn v-if="can('patients_edit')" variant="secondary" :disabled="archiving" @click="toggleArchived">
          {{ patient.status === 'active' ? t('Archive', 'Archivar') : t('Unarchive', 'Desarchivar') }}
        </UiBtn>
        <UiBtn v-if="can('patients_delete_merge')" variant="secondary" @click="mergeOpen = true">{{ t('Merge', 'Fusionar') }}</UiBtn>
        <UiIconBtn
          v-if="can('patients_delete_merge')"
          icon="trash"
          tone="danger"
          :disabled="deleting"
          :label="deleting ? t('Deleting…', 'Eliminando…') : t('Delete patient', 'Eliminar paciente')"
          @click="deletePatient"
        />
      </div>
    </header>

    <div class="flex-1 overflow-y-auto bg-surface-page">
      <div class="flex flex-col items-start gap-6 px-4 py-6 sm:px-6 lg:flex-row">
        <PatientsDetailSidebar
          :patient="patient"
          :balance-cents="balanceCents"
          :available-cents="availableCents"
          :credit-cents="creditLedgerCents"
          :bono-value-cents="bonoValueCents"
          :active-packages="activePackages"
          :financial-loading="financialLoading"
          class="lg:sticky lg:top-6"
          @message="whatsAppOpen = true"
          @charge="handleCharge"
          @photo-updated="loadPatient"
        />

        <div class="min-w-0 w-full flex-1">
          <nav class="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-chip-border bg-surface-page">
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

    <PatientsMergePatientModal v-if="mergeOpen" :patient="patient" @close="mergeOpen = false" @merged="onMerged" />
  </div>
</template>

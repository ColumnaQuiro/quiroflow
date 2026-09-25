<script setup lang="ts">
import type { Tables } from '~/types/database.types'

// The patient record.
//
// Shape of this page, and why: a full-width banner carrying identity and the
// ways to reach the patient, then six tabs. It used to be a 56px header plus
// a 280px rail plus seven tabs, and the rail was the problem -- it repeated
// the name and balance the header already showed, it held clinical panels
// that were on screen while you read an invoice, and the phone number was
// only visible if you happened to be on Overview. The front desk needs the
// number wherever they are, so it moved up into the banner; the clinical
// panels moved into Clinical, where they are read; the account figures moved
// into Money, which is the tab that is about them.
//
// The seven tabs became six by merging Docs and Files into Attachments --
// see AttachmentsTab for why that split was never a distinction staff made.
const route = useRoute()
const supabase = useSupabaseClient()
const store = useAccountStore()
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

// The banner shows the number, so the number is loaded here rather than by
// whichever tab happens to be open.
const primaryNumber = ref<Tables<'patient_contact_numbers'> | null>(null)
const practitionerName = ref<string | null>(null)
async function loadBannerDetail() {
  const { data } = await supabase
    .from('patient_contact_numbers')
    .select('*')
    .eq('patient_id', patientId)
    .order('created_at')
    .limit(1)
  primaryNumber.value = data?.[0] ?? null
}
onMounted(loadBannerDetail)

watch(
  () => patient.value?.default_practitioner_id,
  async (id) => {
    if (!id) {
      practitionerName.value = null
      return
    }
    const { data } = await supabase.from('team_members').select('full_name').eq('id', id).maybeSingle()
    practitionerName.value = data?.full_name ?? null
  },
  { immediate: true },
)

const clinicName = computed(() => store.clinics.find((c) => c.id === patient.value?.clinic_id)?.name ?? null)

// A minor's messages go to their tutor, and until now the record said so by
// simply having no Communications tab -- which tells you the rule exists
// and not where to act on it. The banner links the tutor's own record.
const tutor = ref<{ id: string; first_name: string; last_name: string | null } | null>(null)
watch(
  () => [patient.value?.is_minor, patient.value?.tutor_patient_id] as const,
  async ([isMinor, tutorId]) => {
    if (!isMinor || !tutorId) {
      tutor.value = null
      return
    }
    const { data } = await supabase.from('patients').select('id, first_name, last_name').eq('id', tutorId).maybeSingle()
    tutor.value = data
  },
  { immediate: true },
)

// Only the two figures the banner's pill reads; the rest of the account's
// money is Billing's own business and is loaded there.
const { outstandingCents, availableCents } = usePatientFinancialSummary(patientId)

const isVip = computed(() => !!patient.value?.tags.some((tag) => tag.toUpperCase() === 'VIP'))

// Minors get no communications at all -- the tab and every send entry point
// are hidden rather than merely disabled, matching how do-not-contact
// already blocks sends server-side.
const canContact = computed(() => !patient.value?.is_minor && !patient.value?.do_not_contact)

const tabs = computed(() => [
  { key: 'overview', label: t('Overview', 'Resumen') },
  { key: 'clinical', label: t('Clinical', 'Clínico') },
  { key: 'appointments', label: t('Appointments', 'Citas') },
  // billing_history_view ("See billing history"): the whole ledger -- every
  // receipt, payment, bono and the statement -- lives on this tab. Stored and
  // seeded for months while nothing read it; the Money tab showed regardless.
  // Charging a visit stays possible from the calendar with billing_access.
  ...(can('billing_history_view') ? [{ key: 'money', label: t('Money', 'Dinero') }] : []),
  // Also hidden without inbox_access: 0164 stops those roles reading
  // messages at all, so the tab would render an empty thread that reads as
  // "this patient has never been contacted" -- worse than not offering it.
  ...(patient.value?.is_minor || !can('inbox_access') ? [] : [{ key: 'communications', label: t('Communications', 'Comunicaciones') }]),
  { key: 'attachments', label: t('Attachments', 'Adjuntos') },
])

// The old tab names still work. They are in bookmarks, in links mailed
// between staff, and in `?tab=billing` deep links this app builds itself
// from the invoice list -- silently landing all of those on Overview would
// look like the record had lost its billing.
const TAB_ALIASES: Record<string, string> = {
  'visit-notes': 'clinical',
  billing: 'money',
  docs: 'attachments',
  files: 'attachments',
}

// /billing/<id>'s Refund button lands here: the ledger owns the refund modal,
// because refunding issues a rectificativa and a negative payment and one
// implementation of that is enough. Read once rather than kept in sync -- the
// modal takes it from here and the query string can go stale harmlessly.
const refundInvoiceId = computed(() => (route.query.refund as string) || null)

const activeTab = computed({
  get: () => {
    const requested = (route.query.tab as string) ?? 'overview'
    const resolved = TAB_ALIASES[requested] ?? requested
    return tabs.value.some((tab) => tab.key === resolved) ? resolved : 'overview'
  },
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

// Charge should always land on Money's "Take payment" panel -- switching tabs
// alone is a no-op when Money is already the active tab.
const chargeRequested = ref(false)
function handleCharge() {
  chargeRequested.value = true
  activeTab.value = 'money'
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

// Delete is a dialog rather than a confirm() because it has to count what
// goes, and because it sometimes has to refuse: a patient with an issued
// factura cannot be deleted at all. See PatientsDeleteDialog.
const deleteOpen = ref(false)
async function onDeleted() {
  deleteOpen.value = false
  await navigateTo('/patients')
}
function onArchiveInstead() {
  deleteOpen.value = false
  toggleArchived()
}

const fullName = computed(() => [patient.value?.first_name, patient.value?.last_name].filter(Boolean).join(' '))

// -- Roving focus across the tabs -----------------------------------------
// One tab stop for the whole set: Tab reaches the selected tab and then
// leaves for the panel, and the arrows move between tabs. Without this a
// keyboard user tabs through six controls to reach the content, every time.
const tabRefs = new Map<string, HTMLButtonElement>()
function setTabRef(key: string, el: unknown) {
  if (el) tabRefs.set(key, el as HTMLButtonElement)
  else tabRefs.delete(key)
}

function onTabKeydown(event: KeyboardEvent) {
  const keys = tabs.value.map((tab) => tab.key)
  const current = keys.indexOf(activeTab.value)
  if (current === -1) return

  let next: number | null = null
  if (event.key === 'ArrowRight') next = (current + 1) % keys.length
  else if (event.key === 'ArrowLeft') next = (current - 1 + keys.length) % keys.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = keys.length - 1
  if (next === null) return

  event.preventDefault()
  const key = keys[next]
  activeTab.value = key
  // Focus follows selection, which is the automatic-activation pattern and
  // the right one here: each panel is a fetch, not a form, so arrowing
  // through them costs nothing a user would resent.
  nextTick(() => tabRefs.get(key)?.focus())
}
</script>

<template>
  <div v-if="loading" class="flex h-full flex-col">
    <header class="shrink-0 border-b border-line bg-surface px-4 py-3 sm:px-6">
      <div class="flex items-center gap-3">
        <UiSkeleton class="h-10 w-10 rounded-full" />
        <UiSkeleton class="h-[15px] w-40 rounded" />
      </div>
      <UiSkeleton class="mt-2.5 h-3.5 w-64 rounded" />
    </header>
    <div class="flex-1 overflow-y-auto bg-surface-page">
      <div class="px-4 py-5 sm:px-6">
        <div class="flex gap-4 border-b border-chip-border pb-3">
          <UiSkeleton v-for="i in 6" :key="i" class="h-4 w-16 rounded" />
        </div>
        <div class="mt-5 space-y-3">
          <UiSkeleton v-for="i in 6" :key="i" class="h-4 w-full rounded" />
        </div>
      </div>
    </div>
  </div>
  <div v-else-if="notFound" class="flex h-full items-center justify-center text-[13px] text-ink-faint">{{ t('Patient not found.', 'Paciente no encontrado.') }}</div>
  <div v-else-if="patient" class="flex h-full flex-col">
    <div class="shrink-0 bg-surface-page px-4 pt-4 sm:px-6">
      <PatientsBanner
        :patient="patient"
        :is-vip="isVip"
        :available-cents="availableCents"
        :outstanding-cents="outstandingCents"
        :clinic-name="clinicName"
        :practitioner-name="practitionerName"
        :can-contact="canContact"
        :can-edit="can('patients_edit')"
        :can-manage-record="can('patients_delete_merge')"
        :can-book="true"
        :can-charge="can('billing_history_view')"
        :archiving="archiving"
        :primary-number="primaryNumber"
        :tutor="tutor"
        @photo-updated="loadPatient"
        @message="whatsAppOpen = true"
        @book="navigateTo('/calendar')"
        @charge="handleCharge"
        @archive="toggleArchived"
        @merge="mergeOpen = true"
        @remove="deleteOpen = true"
      />
    </div>

    <div class="flex-1 overflow-y-auto bg-surface-page">
      <div class="min-w-0 px-4 sm:px-6">
        <!-- A real tablist. These were buttons carrying aria-current, which
        announces "the page you are on" -- they are not pages, and a screen
        reader was told there were six links rather than one set of six
        tabs. With the roles comes roving focus: one tab stop for the whole
        set, arrows to move between them, Home and End to jump. -->
        <div
          role="tablist"
          class="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-chip-border bg-surface-page"
          :aria-label="t('Patient record sections', 'Secciones de la ficha')"
          @keydown="onTabKeydown"
        >
          <button
            v-for="tab in tabs"
            :key="tab.key"
            :ref="(el) => setTabRef(tab.key, el)"
            type="button"
            role="tab"
            :id="`tab-${tab.key}`"
            :aria-controls="`panel-${tab.key}`"
            :aria-selected="activeTab === tab.key"
            :tabindex="activeTab === tab.key ? 0 : -1"
            class="h-10 shrink-0 px-[11px] text-[13.5px] outline-none focus-visible:shadow-focus"
            :class="
              activeTab === tab.key
                ? 'font-semibold text-ink-700 shadow-[inset_0_-2px_0_rgb(var(--color-brand))]'
                : 'text-ink-muted hover:text-ink-600'
            "
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
          </button>
        </div>

        <div
          class="py-5"
          role="tabpanel"
          :id="`panel-${activeTab}`"
          :aria-labelledby="`tab-${activeTab}`"
          tabindex="0"
        >
          <PatientsOverviewTab v-if="activeTab === 'overview'" :patient="patient" @updated="loadPatient" />

          <PatientsClinicalTab v-else-if="activeTab === 'clinical'" :patient-id="patientId" />

          <PatientsAppointmentsTab
            v-else-if="activeTab === 'appointments'"
            :patient-id="patientId"
            :first-name="patient.first_name"
            :last-name="patient.last_name"
            :preferred-language="patient.preferred_language"
          />

          <!-- No wrapper card of account figures above this: they are part
               of Billing's own summary strip. A fifth stacked card pushed
               the ledger below the fold. -->
          <PatientsBillingTab
            v-else-if="activeTab === 'money'"
            :patient-id="patientId"
            :open-payment-trigger="chargeRequested"
            :refund-invoice-id="refundInvoiceId"
            @payment-trigger-consumed="chargeRequested = false"
          />

          <PatientsCommunicationsTab
            v-else-if="activeTab === 'communications'"
            :patient-id="patientId"
            :first-name="patient.first_name"
            :preferred-language="patient.preferred_language"
            :can-contact="canContact"
          />

          <PatientsAttachmentsTab v-else-if="activeTab === 'attachments'" :patient-id="patientId" />
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

    <PatientsDeleteDialog
      v-if="deleteOpen"
      :patient-id="patientId"
      :patient-name="fullName"
      :archived="patient.status !== 'active'"
      @close="deleteOpen = false"
      @deleted="onDeleted"
      @archive="onArchiveInstead"
    />
  </div>
</template>

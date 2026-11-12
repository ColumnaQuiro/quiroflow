<script setup lang="ts">
import type { Tables } from '~/types/database.types'
import { APP_DOWNLOAD_TEMPLATE } from '~/utils/appLinks'

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
// Progress (pain visit by visit) is a seventh for those who can read visit
// notes; it is a different question from Clinical's "what happened", namely
// "is it working".
const route = useRoute()
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { can } = usePermission()
const { showToast } = useToast()
const logAccess = useAccessLog()
const patientId = route.params.id as string

const patient = ref<Tables<'patients'> | null>(null)
const notFound = ref(false)
const loading = ref(true)
// The first read failed (offline, a timeout, PostgREST down). Kept apart from
// notFound, because "this patient does not exist" is the wrong thing to tell a
// receptionist with that patient at the counter, and apart from loading, which
// left the skeleton shimmering forever with nothing to press.
const loadError = ref(false)
const retrying = ref(false)
const practitionerName = ref<string | null>(null)

// A minor's messages go to their tutor, and until now the record said so by
// simply having no Communications tab -- which tells you the rule exists
// and not where to act on it. The banner links the tutor's own record.
const tutor = ref<{ id: string; first_name: string; last_name: string | null } | null>(null)

// Only the very first load shows the skeleton. Overview's save, a new photo
// and a merge all call this again, and blanking the page for those threw away
// the banner and remounted the open tab -- losing its scroll and whatever it
// had loaded -- to show one changed field.
// Overview's save, a new photo and the details dialog can each call this while
// an earlier call is still in flight; only the newest answer is applied, or a
// slow first response could land last and put the old values back on screen.
let patientRun = 0
// Once per visit to the record, including when it opened only on a retry.
let accessLogged = false
async function loadPatient() {
  const run = ++patientRun
  // The practitioner's name and the tutor ride along as embeds, rather than
  // two more round trips once the patient has landed. The tutor is named by
  // its column: patients references itself, and the constraint-name hint does
  // not resolve on a self-reference, while the column form does.
  //
  // So do the banner's phone number (the first one recorded) and the
  // patient's types: they were two more requests fired beside this one, and
  // requests fired together queue on the database. Each embed is read under
  // its own table's policies, as the separate selects were.
  const { data, error } = await supabase
    .from('patients')
    .select('*, practitioner:team_members!patients_default_practitioner_id_fkey(full_name), tutor:tutor_patient_id(id, first_name, last_name), patient_contact_numbers(*), patient_type_members(type_id)')
    .eq('id', patientId)
    .order('created_at', { referencedTable: 'patient_contact_numbers' })
    .limit(1, { referencedTable: 'patient_contact_numbers' })
    .maybeSingle()
  if (run !== patientRun) return
  // A failed read is not "patient not found". Once the record is on screen it
  // stays as it was (utils/supabaseFailures.ts reports the query and the
  // layout's toast says so); before that, the page says the load failed and
  // offers to try again, rather than a skeleton that never resolves.
  if (error) {
    if (loading.value) {
      loadError.value = true
      loading.value = false
    }
    return
  }
  loadError.value = false
  if (data) {
    // Stripped rather than carried on the patient: the edit form and the
    // merge modal both work from this object, and an unknown key in an
    // update is a PostgREST error.
    const { practitioner, tutor: tutorRow, patient_contact_numbers: numbers, patient_type_members: typeRows, ...row } = data as typeof data & {
      tutor: { id: string; first_name: string; last_name: string | null } | null
      patient_contact_numbers: Tables<'patient_contact_numbers'>[] | null
      patient_type_members: { type_id: string }[] | null
    }
    patient.value = row
    practitionerName.value = practitioner?.full_name ?? null
    tutor.value = row.is_minor && tutorRow ? tutorRow : null
    primaryNumber.value = numbers?.[0] ?? null
    patientTypeIds.value = (typeRows ?? []).map((r) => r.type_id)
  } else {
    patient.value = null
    practitionerName.value = null
    tutor.value = null
    primaryNumber.value = null
    patientTypeIds.value = []
  }
  notFound.value = !data
  if (data && !accessLogged) {
    accessLogged = true
    logAccess('record_opened', patientId)
  }
  loading.value = false
}
onMounted(loadPatient)

async function retryLoad() {
  if (retrying.value) return
  retrying.value = true
  try {
    loading.value = true
    loadError.value = false
    await loadPatient()
  } finally {
    retrying.value = false
  }
}

// The banner shows the number, so the number is loaded here, with the
// patient (loadPatient), rather than by whichever tab happens to be open.
const primaryNumber = ref<Tables<'patient_contact_numbers'> | null>(null)
// The patient's types, for the chips in the banner (PatientsTypesInline reads
// this instead of asking again; null until the record is in).
const patientTypeIds = ref<string[] | null>(null)
provide('patientTypeIds', patientTypeIds)

// Only the open tab is in the page's own bundle; the others and the dialogs
// load when first shown (Lazy*), which kept ~270 KB of tabs nobody had opened
// off the record's first paint. Fetched once the record is up, while the
// browser is idle, so the first click on a tab does not wait for its code.
onMounted(() => warmChunks(() => [
  import('~/components/patients/ClinicalTab.vue'),
  import('~/components/patients/ProgressTab.vue'),
  import('~/components/patients/AppointmentsTab.vue'),
  import('~/components/patients/BillingTab.vue'),
  import('~/components/patients/CommunicationsTab.vue'),
  import('~/components/patients/AttachmentsTab.vue'),
]))

const clinicName = computed(() => store.clinics.find((c) => c.id === patient.value?.clinic_id)?.name ?? null)

// Only the two figures the banner's pill reads; the rest of the account's
// money is Billing's own business and is loaded there.
const { outstandingCents, availableCents } = usePatientFinancialSummary(patientId)

const isVip = computed(() => !!patient.value?.tags.some((tag) => tag.toUpperCase() === 'VIP'))

// Minors get no communications at all -- the tab and every send entry point
// are hidden rather than merely disabled, matching how do-not-contact
// already blocks sends server-side.
const canContact = computed(() => !patient.value?.is_minor && !patient.value?.do_not_contact)
// A person writing to them -- Message, Call, the Communications tab. "Do not
// contact" stops automatic messages, campaigns and documents (canContact),
// not someone at the clinic talking to them; a minor, still nobody.
const canMessage = computed(() => !!patient.value && !patient.value.is_minor)

const tabs = computed(() => [
  { key: 'overview', label: t('Overview', 'Resumen') },
  { key: 'clinical', label: t('Clinical', 'Clínico') },
  // Pain visit by visit (visit_pain_scores) -- clinical, so under the visit
  // notes permission like the notes themselves.
  ...(can('visit_notes_access') ? [{ key: 'progress', label: t('Progress', 'Progreso') }] : []),
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
  letters: 'attachments',
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
// "Enviar la app por WhatsApp" (the banner's menu): the same dialog, fixed on
// the app-download template, in the patient's language.
const appInviteOpen = ref(false)
const cancelFutureOpen = ref(false)
// Bumped after a bulk change to their visits, so the open tab reads them again.
const tabsKey = ref(0)

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
    // Selected back, because an update RLS refuses is not an error: it
    // matches no rows and answers success. Without the row, a role that can
    // read this patient but not change them saw "Patient archived" while the
    // record stayed exactly as it was.
    const { data, error } = await supabase.from('patients').update({ status: nextStatus }).eq('id', patientId).select('id')
    if (error || !data?.length) {
      const what = nextStatus === 'inactive' ? t("Couldn't archive the patient", 'No se ha podido archivar al paciente') : t("Couldn't unarchive the patient", 'No se ha podido desarchivar al paciente')
      showToast(error ? `${what}. (${error.message})` : `${what}. ${t("You don't have permission to change this record.", 'No tienes permiso para cambiar esta ficha.')}`, 'error')
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
// "Exportar sus datos (RGPD)": everything held about the patient as a ZIP
// (server/api/patients/[id]/gdpr-export.post.ts), for a right of access
// request. Built on the server, then downloaded from a link valid an hour.
const authedFetch = useAuthedFetch()
const exporting = ref(false)
const exportUrl = ref('')
async function exportData() {
  if (exporting.value) return
  exporting.value = true
  showToast(t('Preparing their data…', 'Preparando sus datos…'))
  try {
    const r = await authedFetch<{ url: string; fileName: string }>(`/api/patients/${patientId}/gdpr-export`, { method: 'POST' })
    exportUrl.value = r.url
    window.location.assign(r.url)
    showToast(t(`Downloaded: ${r.fileName}`, `Descargado: ${r.fileName}`))
  } catch (e: any) {
    showToast(e?.data?.statusMessage ?? t("Couldn't export their data.", 'No se han podido exportar sus datos.'), 'error')
  } finally {
    exporting.value = false
  }
}
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
  <!-- The first read failed. Not "not found": the patient is very likely
  there, and the next try will probably reach them. -->
  <div v-else-if="loadError" class="h-full overflow-y-auto bg-surface-page" data-cy="patient-load-error">
    <UiEmptyState
      :title="t(`Couldn't open this record`, 'No se ha podido abrir la ficha')"
      :description="t('The connection dropped or the server took too long to answer. Nothing has been changed.', 'Se ha cortado la conexión o el servidor ha tardado demasiado en responder. No se ha cambiado nada.')"
    >
      <template #icon>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 6.5v4.2M10 13.4v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.4" />
        </svg>
      </template>
      <template #actions>
        <UiBtn variant="primary" :disabled="retrying" data-cy="patient-load-retry" @click="retryLoad">
          {{ retrying ? t('Trying again…', 'Reintentando…') : t('Try again', 'Reintentar') }}
        </UiBtn>
        <UiBtn @click="navigateTo('/patients')">{{ t('Back to patients', 'Volver a pacientes') }}</UiBtn>
      </template>
    </UiEmptyState>
  </div>
  <!-- RLS answers a record you may not see exactly as one that is not there,
  so the sentence covers both; "not found" alone sent people looking for a
  deleted patient who was only outside their scope. -->
  <div v-else-if="notFound" class="h-full overflow-y-auto bg-surface-page" data-cy="patient-not-found">
    <UiEmptyState
      :title="t('Patient not found', 'Paciente no encontrado')"
      :description="t(`This record was deleted or merged into another, or it isn't one you have access to. Search for the patient by name to find their current record.`, 'Esta ficha se ha eliminado o fusionado con otra, o no tienes acceso a ella. Busca al paciente por su nombre para encontrar su ficha actual.')"
    >
      <template #actions>
        <UiBtn variant="primary" @click="navigateTo('/patients')">{{ t('Back to patients', 'Volver a pacientes') }}</UiBtn>
      </template>
    </UiEmptyState>
  </div>
  <!-- Below lg the banner scrolls away with the record instead of staying
  pinned: on a phone it is the call/message/book card, about half an iPhone
  screen, and pinned it left the open tab a strip to scroll in. The tab bar
  is sticky, so the sections stay one tap away either way. -->
  <div v-else-if="patient" class="flex h-full flex-col overflow-y-auto bg-surface-page lg:overflow-hidden">
    <div class="shrink-0 bg-surface-page px-4 pt-4 sm:px-6">
      <PatientsBanner
        :patient="patient"
        :is-vip="isVip"
        :available-cents="availableCents"
        :outstanding-cents="outstandingCents"
        :clinic-name="clinicName"
        :practitioner-name="practitionerName"
        :can-contact="canContact"
        :can-message="canMessage"
        :can-edit="can('patients_edit')"
        :can-manage-record="can('patients_delete_merge')"
        :can-export="store.isOwner"
        :can-book="true"
        :can-charge="can('billing_history_view') && can('payments_allocate')"
        :archiving="archiving"
        :primary-number="primaryNumber"
        :tutor="tutor"
        @photo-updated="loadPatient"
        @message="whatsAppOpen = true"
        @send-app="appInviteOpen = true"
        @cancel-future="cancelFutureOpen = true"
        @book="navigateTo({ path: '/calendar', query: { patient: patientId } })"
        @charge="handleCharge"
        @archive="toggleArchived"
        @merge="mergeOpen = true"
        @remove="deleteOpen = true"
        @export-data="exportData"
      />
    </div>

    <div class="bg-surface-page lg:flex-1 lg:overflow-y-auto">
      <div class="min-w-0 px-4 sm:px-6">
        <!-- A real tablist. These were buttons carrying aria-current, which
        announces "the page you are on" -- they are not pages, and a screen
        reader was told there were six links rather than one set of six
        tabs. With the roles comes roving focus: one tab stop for the whole
        set, arrows to move between them, Home and End to jump.
        On a phone the six wrap onto two rows: scrolled sideways, Attachments
        and Communications started off the edge of the screen, and nothing
        said they were there. -->
        <div
          role="tablist"
          class="sticky top-0 z-10 flex flex-wrap gap-x-1 border-b border-chip-border bg-surface-page sm:flex-nowrap sm:gap-1 sm:overflow-x-auto"
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
          :key="tabsKey"
          class="py-5"
          role="tabpanel"
          :id="`panel-${activeTab}`"
          :aria-labelledby="`tab-${activeTab}`"
          tabindex="0"
        >
          <PatientsOverviewTab v-if="activeTab === 'overview'" :patient="patient" @updated="loadPatient" />

          <LazyPatientsClinicalTab v-else-if="activeTab === 'clinical'" :patient-id="patientId" />
          <LazyPatientsProgressTab v-else-if="activeTab === 'progress' && patient" :patient-id="patientId" :patient="patient">
            <template #report="{ root, plan, disabled }">
              <PatientsProgressReportButton :root="root" :plan="plan" :patient="patient" :disabled="disabled" />
            </template>
          </LazyPatientsProgressTab>

          <LazyPatientsAppointmentsTab
            v-else-if="activeTab === 'appointments'"
            :patient-id="patientId"
            :first-name="patient.first_name"
            :last-name="patient.last_name"
            :preferred-language="patient.preferred_language"
            :contact-blocked="!canContact"
          />

          <!-- No wrapper card of account figures above this: they are part
               of Billing's own summary strip. A fifth stacked card pushed
               the ledger below the fold. -->
          <LazyPatientsBillingTab
            v-else-if="activeTab === 'money'"
            :patient-id="patientId"
            :contact-blocked="!canContact"
            :open-payment-trigger="chargeRequested"
            :refund-invoice-id="refundInvoiceId"
            @payment-trigger-consumed="chargeRequested = false"
          />

          <LazyPatientsCommunicationsTab
            v-else-if="activeTab === 'communications'"
            :patient-id="patientId"
            :first-name="patient.first_name"
            :preferred-language="patient.preferred_language"
            :can-contact="canMessage"
            :do-not-contact="patient.do_not_contact"
          />

          <LazyPatientsAttachmentsTab v-else-if="activeTab === 'attachments'" :patient-id="patientId" />
        </div>
      </div>
    </div>

    <LazySendWhatsAppModal
      v-if="whatsAppOpen"
      :patient-id="patient.id"
      :patient-first-name="patient.first_name"
      :patient-preferred-language="patient.preferred_language"
      personal
      @close="whatsAppOpen = false"
      @sent="whatsAppOpen = false"
    />

    <LazySendWhatsAppModal
      v-if="appInviteOpen"
      :patient-id="patient.id"
      :patient-first-name="patient.first_name"
      :patient-preferred-language="patient.preferred_language"
      :default-template-name="APP_DOWNLOAD_TEMPLATE"
      :allow-template-override="false"
      :title="t('Send the app on WhatsApp', 'Enviar la app por WhatsApp')"
      :missing-template-message="t(`This needs an approved WhatsApp template called ${APP_DOWNLOAD_TEMPLATE}, with the patient's first name as {{1}} and the store links as buttons. Create it in WhatsApp Manager.`, `Hace falta una plantilla de WhatsApp aprobada llamada ${APP_DOWNLOAD_TEMPLATE}, con el nombre del paciente como {{1}} y los enlaces de las tiendas como botones. Créala en el Administrador de WhatsApp.`)"
      @close="appInviteOpen = false"
      @sent="appInviteOpen = false; showToast(t('App link sent on WhatsApp.', 'Enlace de la app enviado por WhatsApp.'))"
    />

    <LazyPatientsCancelFutureAppointmentsModal
      v-if="cancelFutureOpen"
      :patient-id="patient.id"
      :patient-name="patient.first_name"
      @close="cancelFutureOpen = false"
      @done="(n: number) => { cancelFutureOpen = false; tabsKey++; showToast(t(`${n} appointment${n === 1 ? '' : 's'} cancelled`, `${n} cita${n === 1 ? '' : 's'} anulada${n === 1 ? '' : 's'}`)) }"
    />

    <LazyPatientsMergePatientModal v-if="mergeOpen" :patient="patient" @close="mergeOpen = false" @merged="onMerged" />

    <LazyPatientsDeleteDialog
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

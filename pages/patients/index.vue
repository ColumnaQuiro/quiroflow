<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import type { Tables } from '~/types/database.types'
import { fetchAllRows, fetchByIds } from '~/composables/useFetchAllRows'
import { normalizeSearchTerm, sanitizeSearchToken } from '~/utils/searchText'

type Patient = Pick<
  Tables<'patients'>,
  | 'id'
  | 'first_name'
  | 'last_name'
  | 'tags'
  | 'clinic_id'
  | 'email'
  | 'default_practitioner_id'
  | 'invoice_email_enabled'
  | 'status'
  | 'is_minor'
  | 'do_not_contact'
  | 'date_of_birth'
>

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const PAGE_SIZE = 50

interface TeamMemberOption { id: string; full_name: string }
interface CarePlanInfo { name: string; totalVisits: number; completed: number }

const search = ref('')
// Balance filters on the live-computed patient_live_balances view, not on a
// stored column -- see loadPatients()/exportCsv() below.
const balanceFilter = ref<'any' | 'owing' | 'credit'>('any')
// Only two options, deliberately. "Not on a care plan" would need a NOT
// EXISTS the reverse embed cannot express, and faking it by listing every
// patient who HAS a plan and excluding those ids sends an id list that grows
// with the clinic -- correct at 200 patients, a 40KB query string at 3000.
const carePlanFilter = ref<'any' | 'on'>('any')
const missingContact = ref<'any' | 'email' | 'phone'>('any')
const practitionerFilter = ref('')
const statusFilter = ref<'active' | 'inactive' | 'any'>('active')
// Two toggles rather than dropdown values: they are the states a receptionist
// scans FOR, not dimensions they slice by.
const doNotContactFilter = ref(false)
const minorsFilter = ref(false)
// Name only. Last visit, next visit and balance are assembled per page from
// separate queries, so sorting on them would order the fifty rows already
// fetched and silently claim to have ordered all three thousand -- which
// looks right and is wrong. They get no sort control until the ordering can
// happen in the database.
const sortDir = ref<'asc' | 'desc'>('asc')
const exporting = ref(false)
const showAddPatient = ref(false)
const patients = ref<Patient[]>([])
const balanceByPatient = ref<Record<string, number>>({})
const nextAppointmentByPatient = ref<Record<string, string>>({})
const lastVisitByPatient = ref<Record<string, string>>({})
const carePlanByPatient = ref<Record<string, CarePlanInfo>>({})
const whatsappConsentByPatient = ref<Record<string, boolean>>({})
const primaryPhoneByPatient = ref<Record<string, string>>({})
const teamMembers = ref<TeamMemberOption[]>([])
const loading = ref(true)

onMounted(async () => {
  const { data } = await supabase.from('team_members').select('id, full_name').order('full_name')
  teamMembers.value = data ?? []
})
const page = ref(1)
const totalCount = ref(0)
const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / PAGE_SIZE)))
// Same 10-button cap as recalls.vue's own pager -- consistent visual limit
// rather than a windowed/scrolling range, since recalls can't know its own
// total ahead of time and just grows this list page by page.
const visiblePages = computed(() => Array.from({ length: Math.min(totalPages.value, 10) }, (_, i) => i + 1))

async function loadPatients() {
  loading.value = true

  // "On a care plan" is filtered via a reverse embed + !inner, the same
  // pattern VisitNotesTab uses for appointments!inner -- it narrows to
  // patients with at least one care_plans row without duplicating the
  // patient row per plan (PostgREST nests the match, it doesn't join-fan-out).
  const selectCols =
    'id, first_name, last_name, tags, clinic_id, email, default_practitioner_id, invoice_email_enabled, status, is_minor, do_not_contact, date_of_birth' +
    (carePlanFilter.value === 'on' ? ', care_plans!inner(id)' : '')

  let query = supabase.from('patients').select(selectCols, { count: 'exact' })

  if (store.currentClinicId) query = query.eq('clinic_id', store.currentClinicId)
  if (balanceFilter.value !== 'any') query = applyBalanceFilter(query, balanceFilter.value)
  if (missingContact.value === 'email') query = query.or('email.is.null,email.eq.')
  if (missingContact.value === 'phone') query = query.eq('has_phone', false)
  if (practitionerFilter.value) query = query.eq('default_practitioner_id', practitionerFilter.value)
  if (statusFilter.value !== 'any') query = query.eq('status', statusFilter.value)
  if (doNotContactFilter.value) query = query.eq('do_not_contact', true)
  if (minorsFilter.value) query = query.eq('is_minor', true)

  // Each word must match somewhere in first/last name/email/phone -- chaining
  // .or() calls ANDs the groups together, so "john 612" matches a John whose
  // phone contains "612" regardless of which word landed in which field.
  for (const token of searchTokens()) query = query.or(searchClause(token))

  const from = (page.value - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1
  const ascending = sortDir.value === 'asc'
  const { data, count } = await query.order('first_name', { ascending }).order('last_name', { ascending }).range(from, to)

  // selectCols is built dynamically (it grows a `care_plans!inner(...)` embed
  // when the "On a care plan" chip is active), so supabase-js can't map it to
  // a literal column union and falls back to an untyped result -- same as the
  // pre-existing `care_plans` queries below, which aren't in the generated
  // Database types either. Assert back to the shape we actually select.
  patients.value = (data ?? []) as unknown as Patient[]
  totalCount.value = count ?? 0

  const ids = patients.value.map((p) => p.id)
  if (ids.length > 0) {
    const [{ data: upcoming }, { data: plans }, { data: completedAppts }, { data: contactNumbers }, { data: balances }] = await Promise.all([
      supabase
        .from('appointments')
        .select('patient_id, starts_at')
        .eq('status', 'booked')
        .gt('starts_at', new Date().toISOString())
        .in('patient_id', ids)
        .order('starts_at'),
      supabase
        .from('care_plans')
        .select('patient_id, name, total_visits, created_at')
        .in('patient_id', ids)
        .order('created_at', { ascending: false }),
      // starts_at as well as the id: the same rows give both the completed
      // count the care-plan progress needs and the date of the last visit,
      // so the new column costs no extra request.
      supabase
        .from('appointments')
        .select('patient_id, starts_at')
        .eq('status', 'completed')
        .in('patient_id', ids)
        .order('starts_at', { ascending: false }),
      supabase
        .from('patient_contact_numbers')
        .select('patient_id, number, country_code, is_whatsapp')
        .in('patient_id', ids)
        .order('created_at'),
      supabase.from('patient_live_balances').select('patient_id, balance_cents').in('patient_id', ids),
    ])

    const balByPatient: Record<string, number> = {}
    for (const b of balances ?? []) balByPatient[b.patient_id!] = b.balance_cents ?? 0
    balanceByPatient.value = balByPatient

    const nextByPatient: Record<string, string> = {}
    for (const a of upcoming ?? []) {
      if (!nextByPatient[a.patient_id]) nextByPatient[a.patient_id] = a.starts_at
    }
    nextAppointmentByPatient.value = nextByPatient

    const completedByPatient: Record<string, number> = {}
    const lastByPatient: Record<string, string> = {}
    for (const a of completedAppts ?? []) {
      completedByPatient[a.patient_id] = (completedByPatient[a.patient_id] ?? 0) + 1
      // Ordered newest first above, so the first one seen per patient is it.
      if (!lastByPatient[a.patient_id]) lastByPatient[a.patient_id] = a.starts_at
    }
    lastVisitByPatient.value = lastByPatient
    const planByPatient: Record<string, CarePlanInfo> = {}
    for (const p of plans ?? []) {
      if (!planByPatient[p.patient_id]) {
        planByPatient[p.patient_id] = { name: p.name, totalVisits: p.total_visits, completed: completedByPatient[p.patient_id] ?? 0 }
      }
    }
    carePlanByPatient.value = planByPatient

    const waByPatient: Record<string, boolean> = {}
    const phoneByPatient: Record<string, string> = {}
    for (const c of contactNumbers ?? []) {
      if (c.is_whatsapp) waByPatient[c.patient_id] = true
      if (!phoneByPatient[c.patient_id]) phoneByPatient[c.patient_id] = c.number
    }
    whatsappConsentByPatient.value = waByPatient
    primaryPhoneByPatient.value = phoneByPatient
  } else {
    nextAppointmentByPatient.value = {}
    lastVisitByPatient.value = {}
    carePlanByPatient.value = {}
    whatsappConsentByPatient.value = {}
    primaryPhoneByPatient.value = {}
    balanceByPatient.value = {}
  }

  loading.value = false
}
onMounted(loadPatients)

function goToPage(p: number) {
  page.value = Math.min(Math.max(1, p), totalPages.value)
  loadPatients()
}

let searchDebounce: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => goToPage(1), 300)
})
watch(
  [balanceFilter, carePlanFilter, missingContact, practitionerFilter, statusFilter, doNotContactFilter, minorsFilter, sortDir],
  () => goToPage(1),
)
// The clinic switcher (AppSidebar.vue) can now change store.currentClinicId
// mid-session for a multi-location account -- same reload-on-change pattern
// calendar.vue and practitioner.vue already use for their own clinic-scoped
// queries. Resets to page 1 rather than just re-running loadPatients() at
// the current page, since the old page number is unlikely to still be
// valid against the new clinic's (probably smaller) patient count.
watch(() => store.currentClinicId, () => goToPage(1))

// Export every patient matching the current filters (not just the loaded
// page) -- fetchAllRows pages past Supabase's 1000-row select() cap.
function csvEscape(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
// Balance and phone are not columns on patients, but they filter as if they
// were: live_balance_cents and phone_numbers_text are computed fields
// (20260923150000). Both used to be id lists fetched first and sent back as
// `id=in.(...)`, which stops fitting in a URL at ~215 ids -- and the
// gateway's 414 reaches supabase-js as `data: null`, so the list just came
// up empty. Production had 221 patients in credit when that was found.
// Shared by the table and the CSV so an export cannot disagree with what is
// on screen.
function applyBalanceFilter<Q extends { lt: any; gt: any }>(query: Q, filter: 'owing' | 'credit'): Q {
  return filter === 'owing' ? query.lt('live_balance_cents', 0) : query.gt('live_balance_cents', 0)
}
function searchTokens() {
  return search.value.trim().split(/\s+/).map(sanitizeSearchToken).filter(Boolean)
}
function searchClause(token: string) {
  return `search_name.ilike.%${normalizeSearchTerm(token)}%,email.ilike.%${token}%,national_id.ilike.%${token}%,phone_numbers_text.ilike.%${token}%`
}

async function fetchBalances(ids: string[]): Promise<Record<string, number>> {
  const rows = await fetchByIds(ids, (chunk) => supabase.from('patient_live_balances').select('patient_id, balance_cents').in('patient_id', chunk))
  const result: Record<string, number> = {}
  for (const b of rows) result[b.patient_id!] = b.balance_cents ?? 0
  return result
}

async function exportCsv() {
  exporting.value = true
  try {
    const selectCols =
      'id, first_name, last_name, tags, email, status, is_minor, do_not_contact' +
      (carePlanFilter.value === 'on' ? ', care_plans!inner(id)' : '')

    const tokens = searchTokens()

    const rows = await fetchAllRows<Patient & { tags: string[] }>((from, to) => {
      let q = supabase.from('patients').select(selectCols) as any
      if (store.currentClinicId) q = q.eq('clinic_id', store.currentClinicId)
      if (balanceFilter.value !== 'any') q = applyBalanceFilter(q, balanceFilter.value)
      if (missingContact.value === 'email') q = q.or('email.is.null,email.eq.')
      if (missingContact.value === 'phone') q = q.eq('has_phone', false)
      if (practitionerFilter.value) q = q.eq('default_practitioner_id', practitionerFilter.value)
      if (statusFilter.value !== 'any') q = q.eq('status', statusFilter.value)
      if (doNotContactFilter.value) q = q.eq('do_not_contact', true)
      if (minorsFilter.value) q = q.eq('is_minor', true)
      for (const token of tokens) q = q.or(searchClause(token))
      return q.order('first_name').range(from, to)
    })

    const exportBalances = await fetchBalances(rows.map((p) => p.id))

    const header = [
      t('First name', 'Nombre'),
      t('Last name', 'Apellidos'),
      t('Email', 'Correo electrónico'),
      t('Balance', 'Saldo'),
      t('Status', 'Estado'),
      t('Under age', 'Menor de edad'),
      t('Do not contact', 'No contactar'),
      t('Tags', 'Etiquetas'),
    ]
    const csvRows = rows.map((p) => [
      p.first_name ?? '',
      p.last_name ?? '',
      p.email ?? '',
      // Deliberately NOT formatEur: this is a CSV cell. es-ES would write
      // 1.234,56, which a spreadsheet reads as a thousands-separated integer
      // and a comma-delimited parser reads as two columns.
      ((exportBalances[p.id] ?? 0) / 100).toFixed(2),
      p.status ?? 'active',
      p.is_minor ? t('yes', 'sí') : t('no', 'no'),
      p.do_not_contact ? t('yes', 'sí') : t('no', 'no'),
      (p.tags ?? []).join('; '),
    ])
    const csv = [header, ...csvRows].map((cols) => cols.map(csvEscape).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `patients-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  } finally {
    exporting.value = false
  }
}

function initials(p: Patient) {
  const a = p.first_name?.[0] ?? ''
  const b = p.last_name?.[0] ?? ''
  return (a + b).toUpperCase() || '?'
}

/** "34 · Clínica Centro · Dr. Ruiz" -- whichever of the three are known. */
function secondaryLine(patient: Patient) {
  const parts: string[] = []
  if (patient.date_of_birth) {
    const dob = new Date(patient.date_of_birth)
    const now = new Date()
    let years = now.getFullYear() - dob.getFullYear()
    const m = now.getMonth() - dob.getMonth()
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) years--
    parts.push(String(years))
  }
  const clinic = store.clinics.find((c) => c.id === patient.clinic_id)?.name
  if (clinic) parts.push(clinic)
  const practitioner = teamMembers.value.find((m) => m.id === patient.default_practitioner_id)?.full_name
  if (practitioner) parts.push(practitioner)
  return parts.join(' · ')
}

function lastVisitText(patientId: string) {
  const iso = lastVisitByPatient.value[patientId]
  if (!iso) return null
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Every active filter, as something that can be read and individually undone.
// Without this a filtered list and an empty one look the same, and the usual
// answer -- reload the page -- loses the search too.
interface ActiveFilter { key: string; label: string; clear: () => void }
const activeFilters = computed<ActiveFilter[]>(() => {
  const out: ActiveFilter[] = []
  if (search.value.trim()) {
    out.push({ key: 'search', label: `"${search.value.trim()}"`, clear: () => (search.value = '') })
  }
  if (statusFilter.value !== 'active') {
    const label = statusFilter.value === 'inactive' ? t('Inactive', 'Inactivo') : t('Any status', 'Cualquier estado')
    out.push({ key: 'status', label, clear: () => (statusFilter.value = 'active') })
  }
  if (balanceFilter.value !== 'any') {
    const label = balanceFilter.value === 'owing' ? t('Owing', 'Con deuda') : t('In credit', 'A favor')
    out.push({ key: 'balance', label, clear: () => (balanceFilter.value = 'any') })
  }
  if (carePlanFilter.value === 'on') {
    out.push({ key: 'plan', label: t('On a care plan', 'Con plan de tratamiento'), clear: () => (carePlanFilter.value = 'any') })
  }
  if (missingContact.value !== 'any') {
    const label = missingContact.value === 'email' ? t('Missing email', 'Sin correo') : t('Missing phone', 'Sin teléfono')
    out.push({ key: 'contact', label, clear: () => (missingContact.value = 'any') })
  }
  if (practitionerFilter.value) {
    const name = teamMembers.value.find((m) => m.id === practitionerFilter.value)?.full_name ?? t('Practitioner', 'Profesional')
    out.push({ key: 'practitioner', label: name, clear: () => (practitionerFilter.value = '') })
  }
  if (doNotContactFilter.value) {
    out.push({ key: 'dnc', label: t('Do not contact', 'No contactar'), clear: () => (doNotContactFilter.value = false) })
  }
  if (minorsFilter.value) {
    out.push({ key: 'minors', label: t('Minors', 'Menores'), clear: () => (minorsFilter.value = false) })
  }
  return out
})

// The row has been clickable since before the name was a link, and staff
// still aim at the middle of it. A click that landed on a control inside the
// row is that control's, though -- otherwise opening the menu also navigated.
function onRowClick(event: MouseEvent, patientId: string) {
  const target = event.target as HTMLElement | null
  if (target?.closest('a, button, input, select')) return
  navigateTo(`/patients/${patientId}`)
}

function clearAllFilters() {
  search.value = ''
  statusFilter.value = 'active'
  balanceFilter.value = 'any'
  carePlanFilter.value = 'any'
  missingContact.value = 'any'
  practitionerFilter.value = ''
  doNotContactFilter.value = false
  minorsFilter.value = false
}

function balancePill(cents: number) {
  const amount = formatEur(Math.abs(cents))
  if (cents < 0) return { text: `${amount} ${t('due', 'pendiente')}`, class: 'bg-danger-bg text-danger-text' }
  if (cents > 0) return { text: `${amount} ${t('cr', 'a favor')}`, class: 'bg-success-bg text-success-text' }
  return { text: formatEur(0), class: 'bg-chip-bg2 text-ink-muted2' }
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function nextVisitInfo(patientId: string) {
  const iso = nextAppointmentByPatient.value[patientId]
  if (!iso) return { date: null as string | null, relative: t('No booking', 'Sin cita'), colorClass: 'text-warning-accent' }

  const visitDate = new Date(iso)
  const dateText = visitDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const timeText = visitDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

  const diffDays = Math.round((startOfDay(visitDate).getTime() - startOfDay(new Date()).getTime()) / 86400000)
  if (diffDays === 0) return { date: `${dateText} · ${timeText}`, relative: t('Today', 'Hoy'), colorClass: 'text-brand' }
  if (diffDays === 1) return { date: `${dateText} · ${timeText}`, relative: t('Tomorrow', 'Mañana'), colorClass: 'text-ink-faint' }
  if (diffDays > 1 && diffDays < 7) return { date: `${dateText} · ${timeText}`, relative: `${t('In', 'En')} ${diffDays} ${t('days', 'días')}`, colorClass: 'text-ink-faint' }
  return { date: `${dateText} · ${timeText}`, relative: visitDate.toLocaleDateString(undefined, { weekday: 'long' }), colorClass: 'text-ink-faint' }
}

// Tags are freeform per-clinic text, not an enum -- match both the design
// spec's English names and the Spanish equivalents already seeded in this
// app's demo data (e.g. "referido", "moroso"), falling back to a neutral
// chip for anything else.
const TAG_STYLES: Record<string, string> = {
  vip: 'bg-warning-bg text-warning-text',
  bono: 'bg-brand-tint text-brand-text2',
  referred: 'bg-success-bg text-success-text',
  referido: 'bg-success-bg text-success-text',
  debtor: 'bg-danger-bg text-danger-text',
  moroso: 'bg-danger-bg text-danger-text',
}
function tagClass(tag: string) {
  return TAG_STYLES[tag.toLowerCase()] ?? 'bg-chip-bg text-chip-text'
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader
      :title="t('Patients', 'Pacientes')"
      :meta="!loading ? `${totalCount} ${t('patients', 'pacientes')} · ${patients.length} ${t('shown', 'mostrados')}` : undefined"
    >
      <UiBtn variant="secondary" :disabled="exporting" @click="exportCsv">{{ exporting ? t('Exporting…', 'Exportando…') : t('Export', 'Exportar') }}</UiBtn>
      <UiBtn variant="secondary" @click="navigateTo('/settings/import')">{{ t('Import', 'Importar') }}</UiBtn>
      <UiBtn variant="primary" @click="showAddPatient = true">{{ t('New patient', 'Nuevo paciente') }}</UiBtn>
    </PageHeader>

    <PatientsAddPatientModal
      v-if="showAddPatient"
      @close="showAddPatient = false"
      @created="(id) => { showAddPatient = false; navigateTo(`/patients/${id}`) }"
    />

    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-[18px] sm:px-6">
      <!-- Toolbar. Search and the four dimensions you slice by, then the two
      states you scan for. -->
      <div class="flex flex-wrap items-center gap-2">
        <div class="relative w-[250px]">
          <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true" class="pointer-events-none absolute left-[10px] top-1/2 -translate-y-1/2 text-ink-faint">
            <circle cx="6" cy="6" r="4.2" stroke="currentColor" stroke-width="1.4" fill="none" />
            <path d="M9.2 9.2L12 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
          <input
            v-model="search"
            type="search"
            :aria-label="t('Search patients', 'Buscar pacientes')"
            :placeholder="t('Name, phone, email or ID', 'Nombre, teléfono, correo o DNI')"
            class="h-8 w-full rounded-ctl border border-line-control bg-surface pl-[30px] pr-3 text-[13px] text-ink-700 placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>

        <PatientsFilterSelect v-model="statusFilter" :label="t('Status', 'Estado')" :options="[
          { value: 'active', label: t('Active', 'Activo') },
          { value: 'inactive', label: t('Inactive', 'Inactivo') },
          { value: 'any', label: t('Any status', 'Cualquier estado') },
        ]" />

        <PatientsFilterSelect v-model="carePlanFilter" :label="t('Care plan', 'Plan')" :options="[
          { value: 'any', label: t('Care plan: any', 'Plan: cualquiera') },
          { value: 'on', label: t('On a care plan', 'Con plan de tratamiento') },
        ]" />

        <PatientsFilterSelect v-model="balanceFilter" :label="t('Balance', 'Saldo')" :options="[
          { value: 'any', label: t('Balance: any', 'Saldo: cualquiera') },
          { value: 'owing', label: t('Owing', 'Con deuda') },
          { value: 'credit', label: t('In credit', 'A favor') },
        ]" />

        <PatientsFilterSelect v-model="missingContact" :label="t('Missing contact', 'Sin contacto')" :options="[
          { value: 'any', label: t('Missing contact', 'Sin contacto') },
          { value: 'email', label: t('Missing email', 'Sin correo electrónico') },
          { value: 'phone', label: t('Missing phone', 'Sin teléfono') },
        ]" />

        <PatientsFilterSelect v-model="practitionerFilter" :label="t('Practitioner', 'Profesional')" :options="[
          { value: '', label: t('Practitioner', 'Profesional') },
          ...teamMembers.map((m) => ({ value: m.id, label: m.full_name })),
        ]" />

        <div aria-hidden="true" class="h-[22px] w-px bg-line" />

        <button
          type="button"
          :aria-pressed="doNotContactFilter"
          class="flex h-8 items-center gap-1.5 rounded-pill border px-2.5 text-[12.5px] font-medium outline-none focus-visible:shadow-focus"
          :class="
            doNotContactFilter
              ? 'border-danger-border bg-danger-bg text-danger-text'
              : 'border-line-control bg-surface text-ink-500 hover:border-line-controlHover'
          "
          @click="doNotContactFilter = !doNotContactFilter"
        >
          <span aria-hidden="true" class="h-[6px] w-[6px] shrink-0 rounded-full" :class="doNotContactFilter ? 'bg-danger-text' : 'bg-ink-faint3'" />
          {{ t('Do not contact', 'No contactar') }}
        </button>

        <button
          type="button"
          :aria-pressed="minorsFilter"
          class="flex h-8 items-center gap-1.5 rounded-pill border px-2.5 text-[12.5px] font-medium outline-none focus-visible:shadow-focus"
          :class="
            minorsFilter
              ? 'border-brand-tintBorder bg-brand-tint text-brand-text'
              : 'border-line-control bg-surface text-ink-500 hover:border-line-controlHover'
          "
          @click="minorsFilter = !minorsFilter"
        >
          <span aria-hidden="true" class="h-[6px] w-[6px] shrink-0 rounded-full" :class="minorsFilter ? 'bg-brand' : 'bg-ink-faint3'" />
          {{ t('Minors', 'Menores') }}
        </button>

      </div>

      <!-- What is actually being filtered on, and how to undo any one of it.
      A filtered list and an empty one otherwise look identical. -->
      <div v-if="activeFilters.length > 0" class="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span
          v-for="filter in activeFilters"
          :key="filter.key"
          class="inline-flex items-center gap-1 rounded-pill border border-line bg-surface py-0.5 pl-2 pr-1 text-[12px] text-ink-600"
        >
          {{ filter.label }}
          <button
            type="button"
            :aria-label="`${t('Remove filter', 'Quitar filtro')}: ${filter.label}`"
            class="flex h-4 w-4 items-center justify-center rounded-full text-ink-faint outline-none hover:bg-surface-subtle hover:text-ink-700 focus-visible:shadow-focus"
            @click="filter.clear()"
          >
            <svg viewBox="0 0 10 10" aria-hidden="true" class="h-2.5 w-2.5">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          </button>
        </span>
        <button
          type="button"
          class="rounded-ctlSm px-1.5 py-0.5 text-[12px] font-medium text-ink-muted outline-none hover:text-ink-700 focus-visible:shadow-focus"
          @click="clearAllFilters"
        >
          {{ t('Clear all', 'Quitar todo') }}
        </button>
      </div>

      <!-- A real table, so a screen reader announces the column a cell belongs
      to. min-w below keeps it scrolling horizontally as one unit on a narrow
      screen rather than squeezing every column unreadably thin. -->
      <div class="mt-3.5 overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[940px] border-collapse text-[13px]">
            <caption class="sr-only">{{ t('Patients', 'Pacientes') }}</caption>
            <thead>
              <tr class="border-b border-line-row bg-surface-subtle2 text-[11px] font-[640] uppercase tracking-[.04em] text-ink-faint">
                <th scope="col" class="px-5 py-2.5 text-left" :aria-sort="sortDir === 'asc' ? 'ascending' : 'descending'">
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 uppercase tracking-[.04em] outline-none hover:text-ink-600 focus-visible:shadow-focus"
                    @click="sortDir = sortDir === 'asc' ? 'desc' : 'asc'"
                  >
                    {{ t('Patient', 'Paciente') }}
                    <svg viewBox="0 0 10 10" aria-hidden="true" class="h-2.5 w-2.5" :class="sortDir === 'asc' ? '' : 'rotate-180'">
                      <path d="M5 2.5v5M3 5l2-2.5L7 5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                    <span class="sr-only">{{ sortDir === 'asc' ? t('sorted A to Z', 'orden de A a Z') : t('sorted Z to A', 'orden de Z a A') }}</span>
                  </button>
                </th>
                <th scope="col" class="w-[175px] px-3 py-2.5 text-left">{{ t('Contact', 'Contacto') }}</th>
                <th scope="col" class="w-[120px] px-3 py-2.5 text-left">{{ t('Last visit', 'Última visita') }}</th>
                <th scope="col" class="w-[150px] px-3 py-2.5 text-left">{{ t('Next visit', 'Próxima visita') }}</th>
                <th scope="col" class="w-[165px] px-3 py-2.5 text-left">{{ t('Care plan', 'Plan de tratamiento') }}</th>
                <th scope="col" class="hidden w-[130px] px-3 py-2.5 text-left xl:table-cell">{{ t('Tags', 'Etiquetas') }}</th>
                <th scope="col" class="w-[120px] px-3 py-2.5 text-right">{{ t('Balance', 'Saldo') }}</th>
                <th scope="col" class="w-[48px] px-3 py-2.5"><span class="sr-only">{{ t('Actions', 'Acciones') }}</span></th>
              </tr>
            </thead>

            <tbody v-if="loading">
              <tr v-for="row in 8" :key="row" class="border-b border-line-row last:border-b-0">
                <td class="px-5 py-2.5">
                  <div class="flex items-center gap-2.5">
                    <UiSkeleton class="h-[26px] w-[26px] shrink-0 rounded-full" />
                    <UiSkeleton class="h-3 w-36 rounded-ctlSm" />
                  </div>
                </td>
                <td v-for="cell in 5" :key="cell" class="px-3 py-2.5"><UiSkeleton class="h-3 w-20 rounded-ctlSm" /></td>
                <td class="hidden px-3 py-2.5 xl:table-cell"><UiSkeleton class="h-3 w-16 rounded-ctlSm" /></td>
                <td class="px-3 py-2.5" />
              </tr>
            </tbody>

            <tbody v-else-if="patients.length === 0">
              <tr>
                <td colspan="8" class="px-5 py-10 text-center text-[13px] text-ink-faint">
                  {{ activeFilters.length > 0 ? t('No patients match these filters.', 'Ningún paciente coincide con estos filtros.') : t('No patients found.', 'No se encontraron pacientes.') }}
                  <button
                    v-if="activeFilters.length > 0"
                    type="button"
                    class="ml-1 font-medium text-brand outline-none hover:underline focus-visible:shadow-focus"
                    @click="clearAllFilters"
                  >
                    {{ t('Clear all', 'Quitar todo') }}
                  </button>
                </td>
              </tr>
            </tbody>

            <tbody v-else>
              <tr
                v-for="patient in patients"
                :key="patient.id"
                class="cursor-pointer border-b border-line-row last:border-b-0 hover:bg-surface-subtle"
                @click="onRowClick($event, patient.id)"
              >
                <td class="px-5 py-2.5">
                  <div class="flex min-w-0 items-center gap-2.5">
                    <span aria-hidden="true" class="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-brand-tint text-[10.5px] font-[650] text-brand">
                      {{ initials(patient) }}
                    </span>
                    <div class="min-w-0">
                      <p class="flex items-center gap-1.5 text-[13.5px] font-[560] text-ink-900">
                        <!-- A real link: openable in a new tab, and the thing
                        a screen reader announces as the row's subject. -->
                        <NuxtLink :to="`/patients/${patient.id}`" class="truncate outline-none hover:underline focus-visible:shadow-focus">
                          {{ patient.first_name }} {{ patient.last_name }}
                        </NuxtLink>
                        <span v-if="patient.status === 'inactive'" class="shrink-0 rounded-pill bg-chip-bg2 px-1.5 py-0.5 text-[10px] font-[600] text-ink-faint3">{{ t('Inactive', 'Inactivo') }}</span>
                        <span v-if="patient.is_minor" class="shrink-0 rounded-pill bg-brand-tint px-1.5 py-0.5 text-[10px] font-[600] text-brand-text2">{{ t('Minor', 'Menor') }}</span>
                        <span v-if="patient.do_not_contact" class="shrink-0 rounded-pill bg-danger-bg px-1.5 py-0.5 text-[10px] font-[600] text-danger-text">{{ t('Do not contact', 'No contactar') }}</span>
                      </p>
                      <p class="truncate text-[11.5px] text-ink-muted2">{{ secondaryLine(patient) || '—' }}</p>
                    </div>
                  </div>
                </td>

                <!-- How this patient can actually be reached. A missing
                number is not an empty cell: it is the reason a reminder will
                never arrive, so it says so. The two chips are the channels
                that are switched ON -- WhatsApp consent on the number, and
                whether invoices go out by email. -->
                <td class="px-3 py-2.5">
                  <div class="flex flex-wrap items-center gap-1.5">
                  <span v-if="primaryPhoneByPatient[patient.id]" class="inline-flex items-center gap-1.5">
                    <span class="font-mono text-[12.5px] text-ink-700">{{ primaryPhoneByPatient[patient.id] }}</span>
                    <span
                      v-if="whatsappConsentByPatient[patient.id]"
                      class="rounded-pill bg-success-bg px-1.5 py-0.5 text-[10px] font-[600] text-success-text"
                      :title="t('WhatsApp', 'WhatsApp')"
                    >WA</span>
                  </span>
                  <span v-else class="inline-flex items-center gap-1 text-[12.5px] text-warning-text">
                    <svg viewBox="0 0 12 12" aria-hidden="true" class="h-3 w-3 shrink-0">
                      <path d="M6 1.5 11 10.5H1z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
                      <path d="M6 5v2.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                      <circle cx="6" cy="9" r=".6" fill="currentColor" />
                    </svg>
                    {{ t('No phone', 'Sin teléfono') }}
                  </span>
                  <span
                    v-if="patient.invoice_email_enabled"
                    class="rounded-pill bg-brand-tint px-1.5 py-0.5 text-[10px] font-[600] text-brand-text2"
                    :title="t('Invoices are emailed to this patient', 'Las facturas se envían por correo')"
                  >{{ t('Email', 'Correo') }}</span>
                  </div>
                </td>

                <td class="px-3 py-2.5">
                  <span v-if="lastVisitText(patient.id)" class="text-[13px] text-ink-700">{{ lastVisitText(patient.id) }}</span>
                  <span v-else class="text-[12.5px] text-ink-faint2">{{ t('Never', 'Nunca') }}</span>
                </td>

                <td class="px-3 py-2.5">
                  <template v-if="nextVisitInfo(patient.id).date">
                    <p class="text-[13px] text-ink-700">{{ nextVisitInfo(patient.id).date }}</p>
                    <p class="text-[11.5px]" :class="nextVisitInfo(patient.id).colorClass">{{ nextVisitInfo(patient.id).relative }}</p>
                  </template>
                  <p v-else class="text-[13px]" :class="nextVisitInfo(patient.id).colorClass">{{ nextVisitInfo(patient.id).relative }}</p>
                </td>

                <td class="px-3 py-2.5">
                  <template v-if="carePlanByPatient[patient.id]">
                    <div class="flex items-center justify-between gap-2">
                      <p class="min-w-0 truncate text-[12.5px] text-ink-700">{{ carePlanByPatient[patient.id].name }}</p>
                      <p class="shrink-0 font-mono text-[11px] text-ink-muted2">
                        {{ carePlanByPatient[patient.id].completed }}/{{ carePlanByPatient[patient.id].totalVisits }}
                      </p>
                    </div>
                    <div class="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-chip-bg2">
                      <div
                        class="h-full rounded-full bg-brand"
                        :style="{ width: `${Math.min(100, (carePlanByPatient[patient.id].completed / carePlanByPatient[patient.id].totalVisits) * 100)}%` }"
                      />
                    </div>
                  </template>
                  <p v-else class="text-[12.5px] text-ink-faint2">{{ t('No plan', 'Sin plan') }}</p>
                </td>

                <td class="hidden px-3 py-2.5 xl:table-cell">
                  <div class="flex flex-wrap items-center gap-1">
                    <span v-for="tag in patient.tags" :key="tag" class="rounded-pill px-1.5 py-0.5 text-[11px] font-[560]" :class="tagClass(tag)">
                      {{ tag }}
                    </span>
                  </div>
                </td>

                <td class="px-3 py-2.5 text-right">
                  <span class="inline-flex rounded-[6px] px-2 py-0.5 font-mono text-[12.5px]" :class="balancePill(balanceByPatient[patient.id] ?? 0).class">
                    {{ balancePill(balanceByPatient[patient.id] ?? 0).text }}
                  </span>
                </td>

                <td class="px-3 py-2.5 text-right">
                  <PatientsRowActions
                    :patient-id="patient.id"
                    :patient-name="`${patient.first_name} ${patient.last_name}`"
                    :can-contact="!patient.is_minor && !patient.do_not_contact"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <UiPaginationFooter
          v-if="!loading && totalCount > 0"
          :page="page"
          :visible-pages="visiblePages"
          :has-prev="page > 1"
          :has-next="page < totalPages"
          :summary="`${t('Page', 'Página')} ${page} ${t('of', 'de')} ${totalPages} · ${totalCount} ${t('patients', 'pacientes')}`"
          @go-to-page="goToPage"
        />
      </div>
    </div>
  </div>
</template>

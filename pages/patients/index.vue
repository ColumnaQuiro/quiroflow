<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { patientAge } from '~/utils/patientAge'
import type { Json, Tables } from '~/types/database.types'
import { fetchAllRows, fetchByIds } from '~/composables/useFetchAllRows'
import {
  emptyFilterForm,
  filtersFromQuery,
  filtersToForm,
  filtersToQuery,
  formToFilters,
  MORE_FILTER_KEYS,
  queryHasFilters,
  sameFilters,
  type PatientFilters,
} from '~/utils/patientFilters'
import { usePatientSegments, type PatientSegment } from '~/composables/usePatientSegments'

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
const logAccess = useAccessLog()
const route = useRoute()
const router = useRouter()
const { showToast } = useToast()

const PAGE_SIZE = 50

interface TeamMemberOption { id: string; full_name: string }
interface CarePlanInfo { name: string; totalVisits: number; completed: number }

// Every filter lives in one form (utils/patientFilters.ts) so that the URL, a
// saved segment and the database call all read the same object. The search
// box is apart only because it is debounced: appliedSearch is what filters.
//
// "On a care plan" has only two options, deliberately: "not on one" was never
// asked for, and the list has no column that would show it.
// Do not contact and Minors are toggles rather than dropdown values: they are
// the states a receptionist scans FOR, not dimensions they slice by.
const initialFilters = filtersFromQuery(route.query)
const form = reactive(filtersToForm(initialFilters))
const search = ref(initialFilters.q ?? '')
const appliedSearch = ref(initialFilters.q ?? '')
const currentFilters = computed<PatientFilters>(() => formToFilters({ ...form, q: appliedSearch.value }))
const showMoreFilters = ref(MORE_FILTER_KEYS.some((key) => key in initialFilters))

// The segment open, if any. Its filters are in the URL too -- the URL is what
// the list shows -- and this only says which saved one they came from, so a
// change to them can be offered back as "Save changes".
const activeSegmentId = ref<string | null>(typeof route.query.segment === 'string' ? route.query.segment : null)
const {
  segments,
  counts: segmentCounts,
  loaded: segmentsLoaded,
  counting: segmentsCounting,
  refresh: refreshSegments,
  refreshCounts: refreshSegmentCounts,
  canManage,
  create: createSegment,
  update: updateSegment,
  remove: removeSegment,
} = usePatientSegments()
const activeSegment = computed(() => segments.value.find((s) => s.id === activeSegmentId.value) ?? null)
const segmentModified = computed(() => !!activeSegment.value && !sameFilters(activeSegment.value.filters, currentFilters.value))
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
// The skeleton rows are for the first load only. A search keystroke or a
// filter change used to swap the whole table for skeletons and drop the
// count and the pager with it; now the rows already there stay, dimmed,
// until the new ones replace them.
const loadedOnce = ref(false)
// The five per-page lookups behind balance, visits, plan and contact. The rows
// render as soon as the patients themselves are in and these cells fill in
// after, rather than the whole page waiting on the slowest of the six.
const enriching = ref(true)
// A slower, older request can finish after a newer one -- typing "ana" then
// "anabel" 300ms apart is enough -- and without this the older answer lands
// last and stays, or its rows end up beside the newer request's balances.
let loadToken = 0

onMounted(async () => {
  const { data, error } = await supabase.from('team_members').select('id, full_name').order('full_name')
  if (error) throw error
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
  const token = ++loadToken
  loading.value = true

  const from = (page.value - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1
  const ascending = sortDir.value === 'asc'
  // id last so two patients with the same name keep one order from page to
  // page, rather than one of them appearing twice and the other never.
  const { data, count, error } = await matchingPatients(PATIENT_COLUMNS, { count: 'exact' })
    .order('first_name', { ascending })
    .order('last_name', { ascending })
    .order('id')
    .range(from, to)
  // Thrown rather than shown as "no patients": the list keeps what it had (or
  // its skeleton), utils/supabaseFailures.ts reports the query and the layout
  // says so.
  if (error) throw error
  if (token !== loadToken) return

  patients.value = (data ?? []) as Patient[]
  totalCount.value = count ?? 0
  // The open segment's count is this total, whatever the last count said.
  if (activeSegment.value && !segmentModified.value) segmentCounts.value = { ...segmentCounts.value, [activeSegment.value.id]: totalCount.value }
  loading.value = false
  loadedOnce.value = true

  const ids = patients.value.map((p) => p.id)
  if (ids.length > 0) {
    enriching.value = true
    const [visitSummary, plans, contactNumbers, balances] = await Promise.all([
      // Last visit, completed count and next booking, already reduced to one
      // row per patient. These used to come back as every visit of every
      // patient on the page, which PostgREST cuts off at 1000 rows without
      // saying so -- see the migration that adds this function.
      supabase.rpc('patient_list_visit_summary', { p_patient_ids: ids }).then(dataOrThrow),
      supabase
        .from('care_plans')
        .select('patient_id, name, total_visits, created_at')
        .in('patient_id', ids)
        .order('created_at', { ascending: false })
        .then(dataOrThrow),
      supabase
        .from('patient_contact_numbers')
        .select('patient_id, number, country_code, is_whatsapp')
        .in('patient_id', ids)
        .order('created_at')
        .then(dataOrThrow),
      supabase.from('patient_live_balances').select('patient_id, balance_cents').in('patient_id', ids).then(dataOrThrow),
    ])
    if (token !== loadToken) return

    const balByPatient: Record<string, number> = {}
    for (const b of balances ?? []) balByPatient[b.patient_id!] = b.balance_cents ?? 0
    balanceByPatient.value = balByPatient

    const nextByPatient: Record<string, string> = {}
    // Completed since the newest plan started -- a plan's progress, not the
    // patient's whole history (see 20261003155748).
    const completedByPatient: Record<string, number> = {}
    const lastByPatient: Record<string, string> = {}
    for (const v of visitSummary ?? []) {
      if (v.next_visit_at) nextByPatient[v.patient_id] = v.next_visit_at
      if (v.last_visit_at) lastByPatient[v.patient_id] = v.last_visit_at
      completedByPatient[v.patient_id] = v.completed_in_plan
    }
    nextAppointmentByPatient.value = nextByPatient
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
  enriching.value = false
}
onMounted(loadPatients)

function goToPage(p: number) {
  page.value = Math.min(Math.max(1, p), totalPages.value)
  loadPatients()
}

let searchDebounce: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => (appliedSearch.value = search.value), 300)
})
// Compared as JSON: the form is rebuilt into a new object on every keystroke
// in a date field, and only a different filter set should reload.
watch(
  () => JSON.stringify(currentFilters.value),
  () => {
    goToPage(1)
    syncUrl()
  },
)
watch(sortDir, () => goToPage(1))

// The filters in the address bar, so a reload, the back button or a link sent
// to a colleague opens the same list. replace, not push: every keystroke in
// the search box is not a page of history.
function syncUrl() {
  const query: Record<string, string> = filtersToQuery(currentFilters.value)
  if (activeSegmentId.value) query.segment = activeSegmentId.value
  router.replace({ query })
}
// The clinic switcher (AppSidebar.vue) can now change store.currentClinicId
// mid-session for a multi-location account -- same reload-on-change pattern
// calendar.vue and practitioner.vue already use for their own clinic-scoped
// queries. Resets to page 1 rather than just re-running loadPatients() at
// the current page, since the old page number is unlikely to still be
// valid against the new clinic's (probably smaller) patient count.
watch(
  () => store.currentClinicId,
  () => {
    goToPage(1)
    refreshSegmentCounts()
  },
)

// The one query behind the table, the export and every segment's count:
// patients_matching applies the filters in the database and returns patients
// rows, which PostgREST then orders, pages and counts like the table.
// See 20261022173310_patient_segments.sql.
const PATIENT_COLUMNS =
  'id, first_name, last_name, tags, clinic_id, email, default_practitioner_id, invoice_email_enabled, status, is_minor, do_not_contact, date_of_birth'
//
// A name typed into search finds the patient whatever their status. With
// status left at its default, Active -- the one filter not shown as a chip --
// searching for someone marked inactive found nothing, and nothing on screen
// said why. Their row is labelled "Inactive". Picking Inactive still narrows
// a search, and the URL and saved segments keep the filters as chosen.
const listFilters = computed<PatientFilters>(() =>
  appliedSearch.value.trim() && form.status === 'active' ? { ...currentFilters.value, status: 'any' } : currentFilters.value,
)
function matchingPatients(columns: typeof PATIENT_COLUMNS, options?: { count: 'exact' }) {
  return supabase
    .rpc('patients_matching', { p_filters: listFilters.value as Json, p_clinic_id: store.currentClinicId ?? undefined }, options)
    .select(columns)
}

// -- Segments ----------------------------------------------------------------
onMounted(async () => {
  await refreshSegments()
  // A link that names a segment and nothing else (?segment=<id>) opens it.
  if (activeSegment.value && !queryHasFilters(route.query)) openSegment(activeSegment.value)
})

// Both recount every segment: a count is only as live as the last time it
// was taken, and these are the moments someone is looking at them.
function openSegment(segment: PatientSegment) {
  activeSegmentId.value = segment.id
  applyFilters(segment.filters)
  syncUrl()
  refreshSegmentCounts()
}
function showAllPatients() {
  activeSegmentId.value = null
  clearAllFilters()
  syncUrl()
  refreshSegmentCounts()
}
function applyFilters(filters: PatientFilters) {
  Object.assign(form, filtersToForm(filters))
  search.value = filters.q ?? ''
  appliedSearch.value = filters.q ?? ''
  if (MORE_FILTER_KEYS.some((key) => key in filters)) showMoreFilters.value = true
}

const segmentDialog = ref<null | 'create' | 'rename'>(null)
const deletingSegment = ref(false)
const segmentBusy = ref(false)

async function onSegmentDialogSave(name: string, shared: boolean) {
  segmentBusy.value = true
  try {
    if (segmentDialog.value === 'rename' && activeSegment.value) {
      await updateSegment(activeSegment.value.id, { name, shared })
      showToast(t('Segment saved', 'Segmento guardado'))
    } else {
      const created = await createSegment(name, shared, currentFilters.value)
      activeSegmentId.value = created.id
      syncUrl()
      showToast(t('Segment saved', 'Segmento guardado'))
    }
    segmentDialog.value = null
  } catch {
    showToast(t('The segment could not be saved.', 'No se pudo guardar el segmento.'), 'error')
  } finally {
    segmentBusy.value = false
  }
}

async function saveSegmentChanges() {
  if (!activeSegment.value) return
  segmentBusy.value = true
  try {
    await updateSegment(activeSegment.value.id, { filters: currentFilters.value })
    showToast(t('Segment updated', 'Segmento actualizado'))
  } catch {
    showToast(t('The segment could not be saved.', 'No se pudo guardar el segmento.'), 'error')
  } finally {
    segmentBusy.value = false
  }
}

async function confirmDeleteSegment() {
  if (!activeSegment.value) return
  segmentBusy.value = true
  try {
    await removeSegment(activeSegment.value.id)
    // The filters stay on screen; only the saved copy is gone.
    activeSegmentId.value = null
    syncUrl()
    deletingSegment.value = false
    showToast(t('Segment deleted', 'Segmento eliminado'))
  } catch {
    showToast(t('The segment could not be deleted.', 'No se pudo eliminar el segmento.'), 'error')
  } finally {
    segmentBusy.value = false
  }
}

// Export every patient matching the current filters (not just the loaded
// page) -- fetchAllRows pages past Supabase's 1000-row select() cap.
function csvEscape(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
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
    // The same query as the table, so an export cannot disagree with what is
    // on screen. Ordered down to the id: fetchAllRows pages it, and a tie
    // between two pages would repeat one patient and drop another.
    const rows = await fetchAllRows<Patient>((from, to) =>
      matchingPatients(PATIENT_COLUMNS).order('first_name').order('last_name').order('id').range(from, to),
    )

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
    logAccess('export', null, { export: 'patient_list', rows: rows.length })
  } finally {
    exporting.value = false
  }
}

function initials(p: Patient) {
  const a = p.first_name?.[0] ?? ''
  const b = p.last_name?.[0] ?? ''
  return (a + b).toUpperCase() || '?'
}

/** "34 años · Clínica Centro · Dr. Ruiz" -- whichever of the three are known. */
function secondaryLine(patient: Patient) {
  const parts: string[] = []
  const age = patientAge(patient.date_of_birth)
  if (age !== null) parts.push(t(`${age} years old`, `${age} años`))
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
  if (form.status !== 'active') {
    const label = form.status === 'inactive' ? t('Inactive', 'Inactivo') : t('Any status', 'Cualquier estado')
    out.push({ key: 'status', label, clear: () => (form.status = 'active') })
  }
  if (form.balance) {
    const label = form.balance === 'owing' ? t('Owing', 'Con deuda') : t('In credit', 'A favor')
    out.push({ key: 'balance', label, clear: () => (form.balance = '') })
  }
  if (form.carePlan === 'on') {
    out.push({ key: 'plan', label: t('On a care plan', 'Con plan de cuidados'), clear: () => (form.carePlan = '') })
  }
  if (form.missingContact) {
    const label = form.missingContact === 'email' ? t('Missing email', 'Sin correo') : t('Missing phone', 'Sin teléfono')
    out.push({ key: 'contact', label, clear: () => (form.missingContact = '') })
  }
  if (form.practitioner) {
    const name = teamMembers.value.find((m) => m.id === form.practitioner)?.full_name ?? t('Practitioner', 'Profesional')
    out.push({ key: 'practitioner', label: name, clear: () => (form.practitioner = '') })
  }
  if (form.doNotContact) {
    out.push({ key: 'dnc', label: t('Do not contact', 'No contactar'), clear: () => (form.doNotContact = false) })
  }
  if (form.minors) {
    out.push({ key: 'minors', label: t('Minors', 'Menores'), clear: () => (form.minors = false) })
  }
  for (const tag of form.tags) {
    out.push({ key: `tag:${tag}`, label: `#${tag}`, clear: () => (form.tags = form.tags.filter((x) => x !== tag)) })
  }
  if (form.clinic) {
    const label = form.clinic === 'all' ? t('All clinics', 'Todas las clínicas') : (store.clinics.find((c) => c.id === form.clinic)?.name ?? t('Clinic', 'Clínica'))
    out.push({ key: 'clinic', label, clear: () => (form.clinic = '') })
  }
  const lastVisit = rangeLabel(form.lastVisitFrom, form.lastVisitTo)
  if (lastVisit) {
    out.push({ key: 'lastVisit', label: `${t('Last visit', 'Última visita')} ${lastVisit}`, clear: () => { form.lastVisitFrom = ''; form.lastVisitTo = '' } })
  }
  if (form.futureAppointment) {
    const label = form.futureAppointment === 'yes' ? t('Has a future appointment', 'Con cita futura') : t('No future appointment', 'Sin cita futura')
    out.push({ key: 'future', label, clear: () => (form.futureAppointment = '') })
  }
  if (form.bono) {
    const max = currentFilters.value.bonoSessionsMax
    const label = form.bono === 'none'
      ? t('No live bono', 'Sin bono activo')
      : max === undefined ? t('Has a live bono', 'Con bono activo') : t(`Bono with ≤ ${max} sessions left`, `Bono con ≤ ${max} sesiones`)
    out.push({ key: 'bono', label, clear: () => { form.bono = ''; form.bonoSessionsMax = '' } })
  }
  const created = rangeLabel(form.createdFrom, form.createdTo)
  if (created) {
    out.push({ key: 'created', label: `${t('Patient since', 'Paciente desde')} ${created}`, clear: () => { form.createdFrom = ''; form.createdTo = '' } })
  }
  if (form.app) {
    const label = form.app === 'yes' ? t('Uses the app', 'Usa la app') : t('Does not use the app', 'No usa la app')
    out.push({ key: 'app', label, clear: () => (form.app = '') })
  }
  if (form.birthdayThisMonth) {
    out.push({ key: 'birthday', label: t('Birthday this month', 'Cumple este mes'), clear: () => (form.birthdayThisMonth = false) })
  }
  return out
})
// How many of the panel's filters are on, for its button.
const moreFiltersCount = computed(() => {
  const f = currentFilters.value
  return [f.tags, f.clinic, f.lastVisitFrom || f.lastVisitTo, f.futureAppointment, f.bono, f.createdFrom || f.createdTo, f.app, f.birthdayThisMonth].filter(Boolean).length
})

// "1 Oct 2026 – 31 Oct 2026", "from 1 Oct 2026", "until 31 Oct 2026". Built
// from the parts rather than new Date('2026-10-01'), which is UTC midnight
// and reads as the day before anywhere west of Greenwich.
function dayLabel(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
function rangeLabel(from: string, to: string) {
  if (from && to) return `${dayLabel(from)} – ${dayLabel(to)}`
  if (from) return `${t('from', 'desde')} ${dayLabel(from)}`
  if (to) return `${t('until', 'hasta')} ${dayLabel(to)}`
  return ''
}

// The row has been clickable since before the name was a link, and staff
// still aim at the middle of it. A click that landed on a control inside the
// row is that control's, though -- otherwise opening the menu also navigated.
function onRowClick(event: MouseEvent, patientId: string) {
  const target = event.target as HTMLElement | null
  if (target?.closest('a, button, input, select')) return
  navigateTo(`/patients/${patientId}`)
}

function clearAllFilters() {
  Object.assign(form, emptyFilterForm())
  search.value = ''
  appliedSearch.value = ''
}

function balancePill(cents: number) {
  const amount = formatEur(Math.abs(cents))
  if (cents < 0) return { text: `${amount} ${t('due', 'pendiente')}`, class: 'bg-danger-bg text-danger-text' }
  if (cents > 0) return { text: `${amount} ${t('credit', 'a favor')}`, class: 'bg-success-bg text-success-text' }
  // ink-muted, not muted2: on this chip muted2 measured 4.1:1 in dark mode.
  return { text: formatEur(0), class: 'bg-chip-bg2 text-ink-muted' }
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
      :meta="loadedOnce ? `${totalCount} ${t('patients', 'pacientes')} · ${patients.length} ${t('shown', 'mostrados')}` : undefined"
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

    <PatientsSegmentDialog
      v-if="segmentDialog"
      :mode="segmentDialog"
      :initial-name="segmentDialog === 'rename' ? activeSegment?.name : ''"
      :initial-shared="segmentDialog === 'rename' ? activeSegment?.shared : true"
      :busy="segmentBusy"
      @save="onSegmentDialogSave"
      @cancel="segmentDialog = null"
    />

    <UiConfirmDialog
      v-if="deletingSegment && activeSegment"
      :title="t(`Delete the segment “${activeSegment.name}”?`, `¿Eliminar el segmento «${activeSegment.name}»?`)"
      :confirm-label="t('Delete', 'Eliminar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      tone="danger"
      :busy="segmentBusy"
      @confirm="confirmDeleteSegment"
      @cancel="deletingSegment = false"
    >
      <p class="text-[13px] text-ink-muted">
        {{ activeSegment.shared
          ? t('Only the saved filter goes, for the whole team. No patient is changed.', 'Solo se elimina el filtro guardado, para todo el equipo. Ningún paciente cambia.')
          : t('Only the saved filter goes. No patient is changed.', 'Solo se elimina el filtro guardado. Ningún paciente cambia.') }}
      </p>
    </UiConfirmDialog>

    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-[18px] sm:px-6">
      <div class="flex flex-col gap-3 2xl:flex-row 2xl:items-start 2xl:gap-5">
      <PatientsSegmentList
        :segments="segments"
        :counts="segmentCounts"
        :active-id="activeSegment?.id ?? null"
        :loaded="segmentsLoaded"
        :counting="segmentsCounting"
        @open="openSegment"
        @all="showAllPatients"
      />

      <div class="min-w-0 flex-1">
      <!-- The segment open, and what can be done with it. -->
      <div v-if="activeSegment" data-cy="segment-header" class="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 class="text-[15px] font-[650] text-ink-900">{{ activeSegment.name }}</h2>
        <span v-if="!activeSegment.shared" class="rounded-pill bg-chip-bg2 px-1.5 py-0.5 text-[11px] font-[600] text-chip-text">{{ t('Private', 'Privado') }}</span>
        <span v-if="segmentModified" class="text-[12px] text-warning-text">{{ t('Filters changed', 'Filtros modificados') }}</span>
        <div v-if="canManage(activeSegment)" class="flex items-center gap-1">
          <UiBtn v-if="segmentModified" variant="primary" size="sm" :disabled="segmentBusy" data-cy="segment-save-changes" @click="saveSegmentChanges">
            {{ t('Save changes', 'Guardar cambios') }}
          </UiBtn>
          <UiBtn variant="ghost" size="sm" data-cy="segment-rename" @click="segmentDialog = 'rename'">{{ t('Rename', 'Renombrar') }}</UiBtn>
          <UiBtn variant="ghost" size="sm" data-cy="segment-delete" @click="deletingSegment = true">{{ t('Delete', 'Eliminar') }}</UiBtn>
        </div>
      </div>

      <!-- Toolbar. Search and the four dimensions you slice by, then the two
      states you scan for, then the panel with the rest. -->
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

        <PatientsFilterSelect v-model="form.status" :label="t('Status', 'Estado')" :options="[
          { value: 'active', label: t('Active', 'Activo') },
          { value: 'inactive', label: t('Inactive', 'Inactivo') },
          { value: 'any', label: t('Any status', 'Cualquier estado') },
        ]" />

        <PatientsFilterSelect v-model="form.carePlan" :label="t('Care plan', 'Plan')" :options="[
          { value: '', label: t('Care plan: any', 'Plan: cualquiera') },
          { value: 'on', label: t('On a care plan', 'Con plan de cuidados') },
        ]" />

        <PatientsFilterSelect v-model="form.balance" :label="t('Balance', 'Saldo')" :options="[
          { value: '', label: t('Balance: any', 'Saldo: cualquiera') },
          { value: 'owing', label: t('Owing', 'Con deuda') },
          { value: 'credit', label: t('In credit', 'A favor') },
        ]" />

        <PatientsFilterSelect v-model="form.missingContact" :label="t('Missing contact', 'Sin contacto')" :options="[
          { value: '', label: t('Missing contact', 'Sin contacto') },
          { value: 'email', label: t('Missing email', 'Sin correo electrónico') },
          { value: 'phone', label: t('Missing phone', 'Sin teléfono') },
        ]" />

        <PatientsFilterSelect v-model="form.practitioner" :label="t('Practitioner', 'Profesional')" :options="[
          { value: '', label: t('Practitioner', 'Profesional') },
          ...teamMembers.map((m) => ({ value: m.id, label: m.full_name })),
        ]" />

        <div aria-hidden="true" class="h-[22px] w-px bg-line" />

        <button
          type="button"
          :aria-pressed="form.doNotContact"
          class="flex h-8 items-center gap-1.5 rounded-pill border px-2.5 text-[12.5px] font-medium outline-none focus-visible:shadow-focus"
          :class="
            form.doNotContact
              ? 'border-danger-border bg-danger-bg text-danger-text'
              : 'border-line-control bg-surface text-ink-500 hover:border-line-controlHover'
          "
          @click="form.doNotContact = !form.doNotContact"
        >
          <span aria-hidden="true" class="h-[6px] w-[6px] shrink-0 rounded-full" :class="form.doNotContact ? 'bg-danger-text' : 'bg-ink-faint3'" />
          {{ t('Do not contact', 'No contactar') }}
        </button>

        <button
          type="button"
          :aria-pressed="form.minors"
          class="flex h-8 items-center gap-1.5 rounded-pill border px-2.5 text-[12.5px] font-medium outline-none focus-visible:shadow-focus"
          :class="
            form.minors
              ? 'border-brand-tintBorder bg-brand-tint text-brand-text'
              : 'border-line-control bg-surface text-ink-500 hover:border-line-controlHover'
          "
          @click="form.minors = !form.minors"
        >
          <span aria-hidden="true" class="h-[6px] w-[6px] shrink-0 rounded-full" :class="form.minors ? 'bg-brand' : 'bg-ink-faint3'" />
          {{ t('Minors', 'Menores') }}
        </button>

        <button
          type="button"
          data-cy="more-filters-toggle"
          :aria-expanded="showMoreFilters"
          class="flex h-8 items-center gap-1.5 rounded-pill border px-2.5 text-[12.5px] font-medium outline-none focus-visible:shadow-focus"
          :class="moreFiltersCount > 0 ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-500 hover:border-line-controlHover'"
          @click="showMoreFilters = !showMoreFilters"
        >
          {{ t('More filters', 'Más filtros') }}
          <span v-if="moreFiltersCount > 0" class="font-mono text-[11px]">{{ moreFiltersCount }}</span>
          <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true" :class="showMoreFilters ? 'rotate-180' : ''">
            <path d="M2 4l3 3 3-3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <PatientsMoreFilters v-if="showMoreFilters" :form="form" />

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
        <!-- Saving is offered for a list that is filtered and not already a
        saved segment as it stands. -->
        <button
          v-if="!activeSegment || segmentModified"
          type="button"
          data-cy="save-segment"
          class="ml-auto inline-flex items-center gap-1 rounded-ctlSm px-1.5 py-0.5 text-[12px] font-semibold text-brand outline-none hover:underline focus-visible:shadow-focus"
          @click="segmentDialog = 'create'"
        >
          <svg viewBox="0 0 12 12" aria-hidden="true" class="h-3 w-3">
            <path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
          {{ activeSegment ? t('Save as new segment', 'Guardar como nuevo segmento') : t('Save as segment', 'Guardar como segmento') }}
        </button>
      </div>

      <!-- A real table, so a screen reader announces the column a cell belongs
      to. min-w below keeps it scrolling horizontally as one unit on a narrow
      screen rather than squeezing every column unreadably thin. -->
      <div class="mt-3.5 overflow-hidden rounded-card border border-line bg-surface shadow-card" :aria-busy="loading || enriching">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[940px] border-collapse text-[13px]">
            <caption class="sr-only">{{ t('Patients', 'Pacientes') }}</caption>
            <thead>
              <tr class="border-b border-line-row bg-surface-subtle2 text-[11px] font-[640] uppercase tracking-[.04em] text-ink-faint">
                <th scope="col" class="px-5 py-2.5 text-left max-md:sticky max-md:left-0 max-md:z-[1] max-md:bg-surface-subtle2 max-md:px-3" :aria-sort="sortDir === 'asc' ? 'ascending' : 'descending'">
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
                <th scope="col" class="w-[165px] px-3 py-2.5 text-left">{{ t('Care plan', 'Plan de cuidados') }}</th>
                <th scope="col" class="hidden w-[130px] px-3 py-2.5 text-left xl:table-cell">{{ t('Tags', 'Etiquetas') }}</th>
                <th scope="col" class="w-[120px] px-3 py-2.5 text-right">{{ t('Balance', 'Saldo') }}</th>
                <th scope="col" class="w-[48px] px-3 py-2.5"><span class="sr-only">{{ t('Actions', 'Acciones') }}</span></th>
              </tr>
            </thead>

            <tbody v-if="!loadedOnce">
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

            <tbody v-else-if="patients.length === 0" :class="loading ? 'pointer-events-none opacity-60' : ''">
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

            <tbody v-else class="transition-opacity" :class="loading ? 'pointer-events-none opacity-60' : ''">
              <tr
                v-for="patient in patients"
                :key="patient.id"
                class="group cursor-pointer border-b border-line-row last:border-b-0 hover:bg-surface-subtle"
                @click="onRowClick($event, patient.id)"
              >
                <!-- Pinned on a phone, where the table scrolls sideways: the
                     columns to the right are no use without the name they
                     belong to. Capped there too, so one long name does not
                     widen the column past the screen. -->
                <td class="px-5 py-2.5 max-md:sticky max-md:left-0 max-md:z-[1] max-md:max-w-[200px] max-md:bg-surface max-md:px-3 max-md:group-hover:bg-surface-subtle">
                  <div class="flex min-w-0 items-center gap-2.5">
                    <span aria-hidden="true" class="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-brand-tint text-[11px] font-[650] text-brand">
                      {{ initials(patient) }}
                    </span>
                    <div class="min-w-0">
                      <p class="flex items-center gap-1.5 text-[13.5px] font-[560] text-ink-900">
                        <!-- A real link: openable in a new tab, and the thing
                        a screen reader announces as the row's subject. -->
                        <NuxtLink :to="`/patients/${patient.id}`" class="truncate outline-none hover:underline focus-visible:shadow-focus">
                          {{ patient.first_name }} {{ patient.last_name }}
                        </NuxtLink>
                        <span v-if="patient.status === 'inactive'" class="shrink-0 rounded-pill bg-chip-bg2 px-1.5 py-0.5 text-[11px] font-[600] text-chip-text">{{ t('Inactive', 'Inactivo') }}</span>
                        <span v-if="patient.is_minor" class="shrink-0 rounded-pill bg-brand-tint px-1.5 py-0.5 text-[11px] font-[600] text-brand-text2">{{ t('Minor', 'Menor') }}</span>
                        <span v-if="patient.do_not_contact" class="shrink-0 rounded-pill bg-danger-bg px-1.5 py-0.5 text-[11px] font-[600] text-danger-text">{{ t('Do not contact', 'No contactar') }}</span>
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
                  <UiSkeleton v-if="enriching" class="h-3 w-24 rounded-ctlSm" />
                  <div v-else class="flex flex-wrap items-center gap-1.5">
                  <span v-if="primaryPhoneByPatient[patient.id]" class="inline-flex items-center gap-1.5">
                    <span class="font-mono text-[12.5px] text-ink-700">{{ primaryPhoneByPatient[patient.id] }}</span>
                    <span
                      v-if="whatsappConsentByPatient[patient.id]"
                      class="rounded-pill bg-success-bg px-1.5 py-0.5 text-[11px] font-[600] text-success-text"
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
                    class="rounded-pill bg-brand-tint px-1.5 py-0.5 text-[11px] font-[600] text-brand-text2"
                    :title="t('Invoices are emailed to this patient', 'Las facturas se envían por correo')"
                  >{{ t('Email', 'Correo') }}</span>
                  </div>
                </td>

                <td class="px-3 py-2.5">
                  <UiSkeleton v-if="enriching" class="h-3 w-20 rounded-ctlSm" />
                  <span v-else-if="lastVisitText(patient.id)" class="text-[13px] text-ink-700">{{ lastVisitText(patient.id) }}</span>
                  <span v-else class="text-[12.5px] text-ink-faint2">{{ t('Never', 'Nunca') }}</span>
                </td>

                <td class="px-3 py-2.5">
                  <UiSkeleton v-if="enriching" class="h-3 w-24 rounded-ctlSm" />
                  <template v-else-if="nextVisitInfo(patient.id).date">
                    <p class="text-[13px] text-ink-700">{{ nextVisitInfo(patient.id).date }}</p>
                    <p class="text-[11.5px]" :class="nextVisitInfo(patient.id).colorClass">{{ nextVisitInfo(patient.id).relative }}</p>
                  </template>
                  <p v-else class="text-[13px]" :class="nextVisitInfo(patient.id).colorClass">{{ nextVisitInfo(patient.id).relative }}</p>
                </td>

                <td class="px-3 py-2.5">
                  <UiSkeleton v-if="enriching" class="h-3 w-24 rounded-ctlSm" />
                  <template v-else-if="carePlanByPatient[patient.id]">
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
                  <UiSkeleton v-if="enriching" class="ml-auto h-4 w-16 rounded-[6px]" />
                  <span v-else class="inline-flex rounded-[6px] px-2 py-0.5 font-mono text-[12.5px]" :class="balancePill(balanceByPatient[patient.id] ?? 0).class">
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
          v-if="loadedOnce && totalCount > 0"
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
    </div>
  </div>
</template>

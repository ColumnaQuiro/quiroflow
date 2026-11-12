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
import { listFilters as filtersOfList, usePatientLists, type PatientList } from '~/composables/usePatientLists'
import type { PatientSelection } from '~/composables/usePatientTypes'
import type { AudienceView } from '~/components/patients/AudienceTabs.vue'
import type { AudienceRow } from '~/components/patients/AudienceTable.vue'

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
const { can } = usePermission()

const PAGE_SIZE = 50

interface TeamMemberOption { id: string; full_name: string }
interface CarePlanInfo { name: string; totalVisits: number | null; completed: number }

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
  failed: segmentsFailed,
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

// Lists (20261105143740). Opening one is this same list filtered by `list`,
// so it needs no id of its own in the URL: the filter is the list.
const {
  lists,
  counts: listCounts,
  loaded: listsLoaded,
  failed: listsFailed,
  counting: listsCounting,
  refresh: refreshLists,
  refreshCounts: refreshListCounts,
  canManage: canManageList,
  create: createList,
  update: updateList,
  remove: removeList,
  addPatients: addPatientsToList,
  addMatching: addMatchingToList,
  removePatients: removePatientsFromList,
  removeMatching: removeMatchingFromList,
} = usePatientLists()
// A segment whose rules include a list is the segment, not the list.
const activeList = computed(() => (activeSegment.value ? null : lists.value.find((l) => l.id === currentFilters.value.list) ?? null))

// Which tab: the patient list (also what an open list or segment shows), or
// the overview of lists or of segments.
const view = ref<AudienceView>(route.query.view === 'lists' || route.query.view === 'segments' ? route.query.view : 'patients')
watch(view, (next) => {
  syncUrl()
  if (next === 'lists') refreshListCounts()
  if (next === 'segments') refreshSegmentCounts()
})
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
const teamDirectory = useTeamDirectory()
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
// A failed read is still thrown -- utils/supabaseFailures.ts reports it and
// the layout says so -- but the page stops pretending to load. Before these,
// a dropped connection left the skeletons shimmering for good and the rows
// dimmed and unclickable, which reads as "nearly there", not "failed".
const loadFailed = ref(false)
const enrichFailed = ref(false)
// A slower, older request can finish after a newer one -- typing "ana" then
// "anabel" 300ms apart is enough -- and without this the older answer lands
// last and stays, or its rows end up beside the newer request's balances.
let loadToken = 0

onMounted(async () => {
  // ?new=1: the dashboard's first steps open the new-patient form directly.
  if (route.query.new) {
    showAddPatient.value = true
    navigateTo({ query: { ...route.query, new: undefined } }, { replace: true })
  }
  // Shared with Inbox, Recalls and My Day: one read per session, not per page.
  await teamDirectory.ensureLoaded()
  teamMembers.value = teamDirectory.all.value
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
  // Thrown rather than shown as "no patients": the list keeps what it had (or,
  // on the first load, says it failed), utils/supabaseFailures.ts reports the
  // query and the layout says so.
  if (error) {
    if (token === loadToken) {
      loading.value = false
      loadFailed.value = true
    }
    throw error
  }
  if (token !== loadToken) return

  loadFailed.value = false
  patients.value = (data ?? []) as Patient[]
  totalCount.value = count ?? 0
  // The open segment's count is this total, whatever the last count said.
  if (activeSegment.value && !segmentModified.value) segmentCounts.value = { ...segmentCounts.value, [activeSegment.value.id]: totalCount.value }
  // A selection is of the rows on screen; another page or filter starts again.
  selectedIds.value = new Set([...selectedIds.value].filter((id) => patients.value.some((p) => p.id === id)))
  loading.value = false
  loadedOnce.value = true

  const ids = patients.value.map((p) => p.id)
  if (ids.length > 0) {
    enriching.value = true
    enrichFailed.value = false
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
    ]).catch((err: unknown) => {
      // Unknown, not empty: these cells would otherwise claim "No phone",
      // "Never" and 0,00 € for patients who have all three.
      if (token === loadToken) {
        enriching.value = false
        enrichFailed.value = true
      }
      throw err
    })
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
    selectedIds.value = new Set()
    allMatchingSelected.value = false
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
  if (view.value !== 'patients') query.view = view.value
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
onMounted(refreshLists)
onMounted(async () => {
  await refreshSegments()
  // A link that names a segment and nothing else (?segment=<id>) opens it.
  if (activeSegment.value && !queryHasFilters(route.query)) openSegment(activeSegment.value)
})

// Both recount every segment: a count is only as live as the last time it
// was taken, and these are the moments someone is looking at them.
function openSegment(segment: PatientSegment) {
  activeSegmentId.value = segment.id
  view.value = 'patients'
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
function openList(list: PatientList) {
  activeSegmentId.value = null
  view.value = 'patients'
  applyFilters(filtersOfList(list.id))
  syncUrl()
  refreshListCounts()
}
// The tabs. "All patients" from an overview goes back to whatever the list
// was showing; pressed while a list or segment is open, it closes it.
function onTab(next: AudienceView) {
  if (next === 'patients' && view.value === 'patients' && (activeSegment.value || activeList.value)) showAllPatients()
  view.value = next
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

// -- Lists -------------------------------------------------------------------
const listDialog = ref<null | { mode: 'create' | 'rename'; id?: string }>(null)
const deletingListId = ref<string | null>(null)
const listBusy = ref(false)
const listBeingEdited = computed(() => lists.value.find((l) => l.id === (listDialog.value?.id ?? deletingListId.value)) ?? null)

async function onListDialogSave(name: string, shared: boolean) {
  listBusy.value = true
  try {
    if (listDialog.value?.mode === 'rename' && listDialog.value.id) {
      await updateList(listDialog.value.id, { name, shared })
    } else {
      await createList(name, shared)
    }
    listDialog.value = null
    showToast(t('List saved', 'Lista guardada'))
  } catch {
    showToast(t('The list could not be saved.', 'No se pudo guardar la lista.'), 'error')
  } finally {
    listBusy.value = false
  }
}

async function confirmDeleteList() {
  const id = deletingListId.value
  if (!id) return
  listBusy.value = true
  try {
    await removeList(id)
    if (currentFilters.value.list === id) showAllPatients()
    deletingListId.value = null
    showToast(t('List deleted', 'Lista eliminada'))
  } catch {
    showToast(t('The list could not be deleted.', 'No se pudo eliminar la lista.'), 'error')
  } finally {
    listBusy.value = false
  }
}

const canImport = computed(() => can('data_admin'))
function importIntoList(id: string | null) {
  navigateTo({ path: '/patients/import', query: id ? { list: id } : {} })
}

// -- Selection ---------------------------------------------------------------
// Ticked rows on this page, or -- once the whole page is ticked and the
// filters match more -- everyone they match, which is added in the database
// from the same filters rather than as thousands of ids.
const selectedIds = ref(new Set<string>())
const allMatchingSelected = ref(false)
const pageAllSelected = computed(() => patients.value.length > 0 && patients.value.every((p) => selectedIds.value.has(p.id)))
const selectionCount = computed(() => (allMatchingSelected.value ? totalCount.value : selectedIds.value.size))
function toggleRow(id: string) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
  allMatchingSelected.value = false
}
function togglePage() {
  selectedIds.value = pageAllSelected.value ? new Set() : new Set(patients.value.map((p) => p.id))
  allMatchingSelected.value = false
}
function clearSelection() {
  selectedIds.value = new Set()
  allMatchingSelected.value = false
}
// Lists the person may add to: their own, and the team's if they edit patients.
const manageableLists = computed(() => lists.value.filter(canManageList))
const addingToList = ref(false)
const bulkBusy = ref(false)
// Patient types: the filter's names, and the bulk actions that give types and
// exercises to the selection (the same dialogs as the Exercises section).
const patientTypes = usePatientTypes()
onMounted(patientTypes.load)
const bulkDialog = ref<'' | 'type' | 'exercises'>('')
const bulkSelection = computed<PatientSelection>(() =>
  allMatchingSelected.value ? { filters: listFilters.value as Record<string, unknown>, clinicId: store.currentClinicId ?? null } : { patientIds: [...selectedIds.value] },
)
function onBulkDone(summary: string) {
  bulkDialog.value = ''
  clearSelection()
  showToast(summary)
  loadPatients()
}

async function onAddToList(target: { listId: string } | { newName: string; shared: boolean }) {
  bulkBusy.value = true
  try {
    const list = 'listId' in target ? lists.value.find((l) => l.id === target.listId)! : await createList(target.newName, target.shared)
    const added = allMatchingSelected.value
      ? await addMatchingToList(list.id, listFilters.value, store.currentClinicId ?? null)
      : await addPatientsToList(list.id, [...selectedIds.value], 'bulk')
    addingToList.value = false
    clearSelection()
    await refreshListCounts()
    showToast(t(`${added} added to “${list.name}”`, `${added} añadidos a «${list.name}»`))
  } catch {
    showToast(t('They could not be added to the list.', 'No se pudieron añadir a la lista.'), 'error')
  } finally {
    bulkBusy.value = false
  }
}

async function removeSelectionFromList() {
  const list = activeList.value
  if (!list) return
  bulkBusy.value = true
  try {
    const removed = allMatchingSelected.value
      ? await removeMatchingFromList(list.id, listFilters.value, store.currentClinicId ?? null)
      : await removePatientsFromList(list.id, [...selectedIds.value])
    clearSelection()
    await Promise.all([loadPatients(), refreshListCounts()])
    showToast(t(`${removed} removed from “${list.name}”`, `${removed} quitados de «${list.name}»`))
  } catch {
    showToast(t('They could not be removed from the list.', 'No se pudieron quitar de la lista.'), 'error')
  } finally {
    bulkBusy.value = false
  }
}

// -- The two overview tabs -----------------------------------------------------
function listName(id: string | undefined) {
  return lists.value.find((l) => l.id === id)?.name ?? t('a list', 'una lista')
}
const FAMILY_LABELS = computed<Record<string, string>>(() => ({
  linked: t('Has family linked', 'Con familia vinculada'),
  none: t('No family linked', 'Sin familia vinculada'),
  parent: t('Has a parent linked', 'Con padre/madre vinculado'),
  child: t('Has a child linked', 'Con hijos vinculados'),
  partner: t('Has a partner linked', 'Con pareja vinculada'),
  sibling: t('Has a sibling linked', 'Con hermanos vinculados'),
}))
const MARKETING_LABELS = computed<Record<string, string>>(() => ({
  email: t('Accepts marketing by email', 'Acepta publicidad por correo'),
  whatsapp: t('Accepts marketing by WhatsApp', 'Acepta publicidad por WhatsApp'),
  any: t('Accepts marketing', 'Acepta publicidad'),
  none: t('No marketing consent', 'Sin consentimiento de publicidad'),
}))
/** A segment's rules in one line, for the Segments tab. */
function filterSummary(f: PatientFilters): string {
  const parts: string[] = []
  if (f.q) parts.push(`"${f.q}"`)
  if (f.status) parts.push(f.status === 'inactive' ? t('Archived', 'Archivado') : t('Any status', 'Cualquier estado'))
  for (const tag of f.tags ?? []) parts.push(`#${tag}`)
  for (const id of f.types ?? []) parts.push(patientTypes.byId.value.get(id)?.name ?? t('Patient type', 'Tipo de paciente'))
  if (f.list) parts.push(t(`On ${listName(f.list)}`, `En ${listName(f.list)}`))
  if (f.notList) parts.push(t(`Not on ${listName(f.notList)}`, `No en ${listName(f.notList)}`))
  if (f.family) parts.push(FAMILY_LABELS.value[f.family]!)
  if (f.familyBono) parts.push(t('Shares a bono', 'Comparte bono'))
  if (f.marketing) parts.push(MARKETING_LABELS.value[f.marketing]!)
  if (f.balance) parts.push(f.balance === 'owing' ? t('Owing', 'Con deuda') : t('In credit', 'A favor'))
  if (f.futureAppointment) parts.push(f.futureAppointment === 'yes' ? t('Has a future appointment', 'Con cita futura') : t('No future appointment', 'Sin cita futura'))
  if (f.bono) parts.push(f.bono === 'none' ? t('No live bono', 'Sin bono activo') : t('Has a live bono', 'Con bono activo'))
  if (f.lastVisitFrom || f.lastVisitTo) parts.push(`${t('Last visit', 'Última visita')} ${rangeLabel(f.lastVisitFrom ?? '', f.lastVisitTo ?? '')}`)
  if (f.createdFrom || f.createdTo) parts.push(`${t('Patient since', 'Paciente desde')} ${rangeLabel(f.createdFrom ?? '', f.createdTo ?? '')}`)
  if (f.carePlan) parts.push(t('On a care plan', 'Con plan de cuidados'))
  if (f.app) parts.push(f.app === 'yes' ? t('Uses the app', 'Usa la app') : t('Does not use the app', 'No usa la app'))
  if (f.birthdayThisMonth) parts.push(t('Birthday this month', 'Cumple este mes'))
  if (f.missingContact) parts.push(f.missingContact === 'email' ? t('Missing email', 'Sin correo') : t('Missing phone', 'Sin teléfono'))
  if (f.doNotContact) parts.push(t('Do not contact', 'No contactar'))
  if (f.minors) parts.push(t('Minors', 'Menores'))
  if (f.practitioner) parts.push(teamMembers.value.find((m) => m.id === f.practitioner)?.full_name ?? t('Practitioner', 'Profesional'))
  return parts.join(' · ') || t('Everyone active', 'Todos los activos')
}
const listRows = computed<AudienceRow[]>(() =>
  lists.value.map((l) => ({
    id: l.id,
    name: l.name,
    shared: l.shared,
    detail: l.description ?? '',
    count: listCounts.value[l.id]?.patients,
    email: listCounts.value[l.id]?.email,
    whatsapp: listCounts.value[l.id]?.whatsapp,
    manageable: canManageList(l),
  })),
)
const segmentRows = computed<AudienceRow[]>(() =>
  segments.value.map((s) => ({ id: s.id, name: s.name, shared: s.shared, detail: filterSummary(s.filters), count: segmentCounts.value[s.id], manageable: canManage(s) })),
)
// A segment is made from the filters on screen: "New segment" goes to the
// list, opens the panel with the rarer filters, and says what to do next.
const segmentHint = ref(false)
function startNewSegment() {
  showAllPatients()
  view.value = 'patients'
  showMoreFilters.value = true
  segmentHint.value = true
}
function segmentFromRow(id: string) {
  const segment = segments.value.find((s) => s.id === id)
  if (segment) openSegment(segment)
}
function renameSegmentRow(id: string) {
  const segment = segments.value.find((s) => s.id === id)
  if (!segment) return
  activeSegmentId.value = segment.id
  segmentDialog.value = 'rename'
}
function deleteSegmentRow(id: string) {
  activeSegmentId.value = id
  deletingSegment.value = true
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
    const label = form.status === 'inactive' ? t('Archived', 'Archivado') : t('Any status', 'Cualquier estado')
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
  for (const id of form.types) {
    const name = patientTypes.byId.value.get(id)?.name ?? t('Patient type', 'Tipo de paciente')
    out.push({ key: `type:${id}`, label: name, clear: () => (form.types = form.types.filter((x) => x !== id)) })
  }
  // With one clinic there is nothing to choose between; a list opens in
  // "every clinic" and saying so would only be noise.
  if (form.clinic && store.clinics.length > 1) {
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
      : max === undefined ? t('Has a live bono', 'Con bono activo') : t(`Bono with ≤ ${max} sessions left`, `Bono con ≤ ${max} sesiones restantes`)
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
  if (form.list) {
    out.push({ key: 'list', label: `${t('List', 'Lista')}: ${listName(form.list)}`, clear: () => (form.list = '') })
  }
  if (form.notList) {
    out.push({ key: 'notList', label: t(`Not on ${listName(form.notList)}`, `No en ${listName(form.notList)}`), clear: () => (form.notList = '') })
  }
  if (form.family) {
    out.push({ key: 'family', label: FAMILY_LABELS.value[form.family]!, clear: () => (form.family = '') })
  }
  if (form.familyBono) {
    out.push({ key: 'familyBono', label: t('Shares a bono', 'Comparte bono'), clear: () => (form.familyBono = false) })
  }
  if (form.marketing) {
    out.push({ key: 'marketing', label: MARKETING_LABELS.value[form.marketing]!, clear: () => (form.marketing = '') })
  }
  return out
})
// How many of the panel's filters are on, for its button.
const moreFiltersCount = computed(() => {
  const f = currentFilters.value
  return [f.tags, f.types, store.clinics.length > 1 && f.clinic, f.lastVisitFrom || f.lastVisitTo, f.futureAppointment, f.bono, f.createdFrom || f.createdTo, f.app, f.birthdayThisMonth, f.notList, f.family, f.familyBono, f.marketing].filter(Boolean).length
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
  if (target?.closest('a, button, input, select, label')) return
  navigateTo(`/patients/${patientId}`)
}

function clearAllFilters() {
  Object.assign(form, emptyFilterForm())
  search.value = ''
  appliedSearch.value = ''
}

// The amount is a figure and set in mono; the word after it is prose and is
// not (DESIGN.md, the Ledger Figures Rule). All in mono, "200,00 € a favor"
// was 183px and pushed the column off the right of a 1440px screen.
function balancePill(cents: number) {
  const amount = formatEur(Math.abs(cents))
  if (cents < 0) return { amount, label: t('due', 'pendiente'), class: 'bg-danger-bg text-danger-text' }
  if (cents > 0) return { amount, label: t('credit', 'a favor'), class: 'bg-success-bg text-success-text' }
  // ink-muted, not muted2: on this chip muted2 measured 4.1:1 in dark mode.
  return { amount: formatEur(0), label: '', class: 'bg-chip-bg2 text-ink-muted' }
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function nextVisitInfo(patientId: string) {
  const iso = nextAppointmentByPatient.value[patientId]
  if (!iso) return { date: null as string | null, relative: t('No booking', 'Sin cita'), colorClass: 'text-warning-text' }

  const visitDate = new Date(iso)
  const dateText = visitDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const timeText = visitDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

  const diffDays = Math.round((startOfDay(visitDate).getTime() - startOfDay(new Date()).getTime()) / 86400000)
  if (diffDays === 0) return { date: `${dateText} · ${timeText}`, relative: t('Today', 'Hoy'), colorClass: 'text-brand-text' }
  if (diffDays === 1) return { date: `${dateText} · ${timeText}`, relative: t('Tomorrow', 'Mañana'), colorClass: 'text-ink-faint' }
  if (diffDays > 1 && diffDays < 7) return { date: `${dateText} · ${timeText}`, relative: t(`In ${diffDays} days`, `En ${diffDays} días`), colorClass: 'text-ink-faint' }
  return { date: `${dateText} · ${timeText}`, relative: visitDate.toLocaleDateString(undefined, { weekday: 'long' }), colorClass: 'text-ink-faint' }
}

// Tags are freeform per-clinic text, not an enum -- match both the design
// spec's English names and the Spanish equivalents already seeded in this
// app's demo data (e.g. "referido", "moroso"), falling back to a neutral
// chip for anything else.
const TAG_TONES: Record<string, 'warning' | 'brand' | 'success' | 'danger'> = {
  vip: 'warning',
  bono: 'brand',
  referred: 'success',
  referido: 'success',
  debtor: 'danger',
  moroso: 'danger',
}
function tagTone(tag: string) {
  return TAG_TONES[tag.toLowerCase()] ?? 'neutral'
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader
      :title="t('Patients', 'Pacientes')"
      :meta="loadedOnce ? (totalCount === 1 ? t('1 patient', '1 paciente') : t(`${totalCount} patients · ${patients.length} shown`, `${totalCount} pacientes · ${patients.length} en pantalla`)) : undefined"
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

    <PatientsSegmentDialog
      v-if="listDialog"
      kind="list"
      :mode="listDialog.mode"
      :initial-name="listDialog.mode === 'rename' ? listBeingEdited?.name : ''"
      :initial-shared="listDialog.mode === 'rename' ? listBeingEdited?.shared : true"
      :busy="listBusy"
      @save="onListDialogSave"
      @cancel="listDialog = null"
    />

    <UiConfirmDialog
      v-if="deletingListId && listBeingEdited"
      :title="t(`Delete the list “${listBeingEdited.name}”?`, `¿Eliminar la lista «${listBeingEdited.name}»?`)"
      :confirm-label="t('Delete', 'Eliminar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      tone="danger"
      :busy="listBusy"
      @confirm="confirmDeleteList"
      @cancel="deletingListId = null"
    >
      <p class="text-[13px] text-ink-muted">
        {{ t('Only the list goes. Its patients stay as they are, and anything aimed at the list stops reaching them.', 'Solo se elimina la lista. Sus pacientes siguen igual, y lo que iba dirigido a la lista deja de llegarles.') }}
      </p>
    </UiConfirmDialog>

    <PatientsTypeAssignDialog v-if="bulkDialog === 'type'" :selection="bulkSelection" :count="selectionCount" @done="onBulkDone" @cancel="bulkDialog = ''" />
    <ExercisesBulkAssignDialog v-if="bulkDialog === 'exercises'" :selection="bulkSelection" :count="selectionCount" @done="onBulkDone" @cancel="bulkDialog = ''" />

    <PatientsAddToListDialog
      v-if="addingToList"
      :lists="manageableLists"
      :count="selectionCount"
      :busy="bulkBusy"
      @add="onAddToList"
      @cancel="addingToList = false"
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
      <PatientsAudienceTabs
        :view="view"
        :list-count="listsLoaded ? lists.length : null"
        :segment-count="segmentsLoaded ? segments.length : null"
        @update:view="onTab"
      />

      <PatientsAudienceTable
        v-if="view === 'lists'"
        kind="list"
        :rows="listRows"
        :loaded="listsLoaded"
        :failed="listsFailed"
        :counting="listsCounting"
        :can-import="canImport"
        @open="(id) => openList(lists.find((l) => l.id === id)!)"
        @create="listDialog = { mode: 'create' }"
        @rename="(id) => (listDialog = { mode: 'rename', id })"
        @delete="(id) => (deletingListId = id)"
        @import="importIntoList"
        @retry="refreshLists"
      />

      <PatientsAudienceTable
        v-else-if="view === 'segments'"
        kind="segment"
        :rows="segmentRows"
        :loaded="segmentsLoaded"
        :failed="segmentsFailed"
        :counting="segmentsCounting"
        @open="segmentFromRow"
        @create="startNewSegment"
        @rename="renameSegmentRow"
        @delete="deleteSegmentRow"
        @retry="refreshSegments"
      />

      <div v-else class="mt-4 min-w-0">
      <p v-if="segmentHint && !activeSegment" data-cy="segment-hint" class="mb-2.5 rounded-ctl border border-brand-tintBorder bg-brand-tint px-3 py-2 text-[12.5px] text-brand-text">
        {{ t('Choose the filters for the segment, then press “Save as segment”. Whoever matches them later joins it by themselves.', 'Elige los filtros del segmento y pulsa «Guardar como segmento». Quien los cumpla más adelante entrará solo.') }}
      </p>

      <!-- The list open, and what can be done with it. -->
      <div v-if="activeList" data-cy="list-header" class="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 class="text-[15px] font-[650] text-ink-900">{{ activeList.name }}</h2>
        <span class="text-[12px] text-ink-muted">{{ t('List', 'Lista') }}</span>
        <UiPill v-if="!activeList.shared">{{ t('Private', 'Privado') }}</UiPill>
        <div v-if="canManageList(activeList)" class="flex items-center gap-1">
          <UiBtn v-if="canImport" variant="ghost" size="sm" data-cy="list-header-import" @click="importIntoList(activeList.id)">{{ t('Import into this list', 'Importar a esta lista') }}</UiBtn>
          <UiBtn variant="ghost" size="sm" data-cy="list-rename" @click="listDialog = { mode: 'rename', id: activeList.id }">{{ t('Rename', 'Renombrar') }}</UiBtn>
          <UiBtn variant="ghost" size="sm" data-cy="list-delete" @click="deletingListId = activeList.id">{{ t('Delete', 'Eliminar') }}</UiBtn>
        </div>
      </div>

      <!-- The segment open, and what can be done with it. -->
      <div v-if="activeSegment" data-cy="segment-header" class="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 class="text-[15px] font-[650] text-ink-900">{{ activeSegment.name }}</h2>
        <UiPill v-if="!activeSegment.shared">{{ t('Private', 'Privado') }}</UiPill>
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
        <div class="relative w-full sm:w-[250px]">
          <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true" class="pointer-events-none absolute left-[10px] top-1/2 -translate-y-1/2 text-ink-faint">
            <circle cx="6" cy="6" r="4.2" stroke="currentColor" stroke-width="1.4" fill="none" />
            <path d="M9.2 9.2L12 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
          <input
            v-model="search"
            type="search"
            :aria-label="t('Search patients', 'Buscar pacientes')"
            :placeholder="t('Name, phone, email or ID', 'Nombre, teléfono, correo o DNI')"
            class="h-8 w-full rounded-ctl border border-line-control bg-surface pl-[30px] pr-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 touch:h-11 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>

        <PatientsFilterSelect v-model="form.status" :label="t('Status', 'Estado')" :options="[
          { value: 'active', label: t('Active', 'Activo') },
          { value: 'inactive', label: t('Archived', 'Archivado') },
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
          class="flex h-8 items-center gap-1.5 rounded-pill border px-2.5 text-[12.5px] font-medium outline-none focus-visible:shadow-focus touch:h-11"
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
          class="flex h-8 items-center gap-1.5 rounded-pill border px-2.5 text-[12.5px] font-medium outline-none focus-visible:shadow-focus touch:h-11"
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
          class="flex h-8 items-center gap-1.5 rounded-pill border px-2.5 text-[12.5px] font-medium outline-none focus-visible:shadow-focus touch:h-11"
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

      <PatientsMoreFilters v-if="showMoreFilters" :form="form" :lists="lists" />

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
            class="flex h-4 w-4 items-center justify-center rounded-full text-ink-faint outline-none hover:bg-surface-subtle hover:text-ink-700 focus-visible:shadow-focus touch:h-8 touch:w-8"
            @click="filter.clear()"
          >
            <svg viewBox="0 0 10 10" aria-hidden="true" class="h-2.5 w-2.5">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          </button>
        </span>
        <button
          type="button"
          class="rounded-ctlSm px-1.5 py-0.5 text-[12px] font-medium text-ink-muted outline-none hover:text-ink-700 focus-visible:shadow-focus touch:min-h-11"
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
          class="ml-auto inline-flex items-center gap-1 rounded-ctlSm px-1.5 py-0.5 text-[12px] font-semibold text-brand-text outline-none hover:underline focus-visible:shadow-focus touch:min-h-11"
          @click="segmentDialog = 'create'"
        >
          <svg viewBox="0 0 12 12" aria-hidden="true" class="h-3 w-3">
            <path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
          {{ activeSegment ? t('Save as new segment', 'Guardar como nuevo segmento') : t('Save as segment', 'Guardar como segmento') }}
        </button>
      </div>

      <!-- What is ticked, and what can be done with it. -->
      <div v-if="selectionCount > 0" data-cy="bulk-bar" class="mt-3 flex flex-wrap items-center gap-2 rounded-ctl border border-brand-tintBorder bg-brand-tint px-3 py-2 text-[12.5px] text-brand-text">
        <span data-cy="bulk-count" class="font-[600]">
          {{ selectionCount === 1 ? t('1 selected', '1 seleccionado') : t(`${selectionCount} selected`, `${selectionCount} seleccionados`) }}
        </span>
        <button
          v-if="pageAllSelected && !allMatchingSelected && totalCount > patients.length"
          type="button"
          data-cy="bulk-select-all-matching"
          class="font-medium underline outline-none focus-visible:shadow-focus"
          @click="allMatchingSelected = true"
        >
          {{ t(`Select all ${totalCount} that match`, `Seleccionar los ${totalCount} que coinciden`) }}
        </button>
        <div class="ml-auto flex items-center gap-1.5">
          <UiBtn v-if="can('patients_edit') && patientTypes.active.value.length" variant="secondary" size="sm" data-cy="bulk-patient-type" :disabled="bulkBusy" @click="bulkDialog = 'type'">{{ t('Patient type', 'Tipo de paciente') }}</UiBtn>
          <UiBtn v-if="can('exercises_manage')" variant="secondary" size="sm" data-cy="bulk-assign-exercises" :disabled="bulkBusy" @click="bulkDialog = 'exercises'">{{ t('Assign exercises', 'Asignar ejercicios') }}</UiBtn>
          <UiBtn variant="secondary" size="sm" data-cy="bulk-add-to-list" :disabled="bulkBusy" @click="addingToList = true">{{ t('Add to list', 'Añadir a lista') }}</UiBtn>
          <UiBtn v-if="activeList && canManageList(activeList)" variant="secondary" size="sm" data-cy="bulk-remove-from-list" :disabled="bulkBusy" @click="removeSelectionFromList">
            {{ t('Remove from this list', 'Quitar de esta lista') }}
          </UiBtn>
          <UiBtn variant="ghost" size="sm" @click="clearSelection">{{ t('Clear', 'Deseleccionar') }}</UiBtn>
        </div>
      </div>

      <!-- The first load failed: there are no rows to keep, and a skeleton
      that never resolves says "wait", which is the wrong advice. -->
      <UiEmptyState
        v-if="!loadedOnce && loadFailed"
        data-cy="patients-load-failed"
        :title="t('The patient list could not be loaded', 'No se ha podido cargar la lista de pacientes')"
        :description="t('Check the connection and try again.', 'Comprueba la conexión y vuelve a intentarlo.')"
        class="mt-3.5 !px-0 !py-0"
        :aria-busy="loading"
      >
        <template #icon>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </template>
        <template #actions>
          <UiBtn :disabled="loading" @click="loadPatients">{{ loading ? t('Trying again…', 'Reintentando…') : t('Try again', 'Reintentar') }}</UiBtn>
        </template>
      </UiEmptyState>

      <!-- Nothing to show. Outside the table rather than a row in it: the
      table is 940px wide and scrolls sideways on a phone, so a centred row
      put the sentence, and the way out of it, off the right of the screen. -->
      <UiEmptyState
        v-else-if="loadedOnce && patients.length === 0"
        data-cy="patients-empty"
        :title="activeFilters.length > 0 ? t('No patients match these filters.', 'Ningún paciente coincide con estos filtros.') : t('No active patients yet.', 'Aún no hay pacientes activos.')"
        :description="activeFilters.length > 0 ? undefined : t('Add one with New patient, or bring your list in with Import.', 'Añade uno con Nuevo paciente o trae tu lista con Importar.')"
        class="mt-3.5 !px-0 !py-0 transition-opacity"
        :class="loading ? 'pointer-events-none opacity-60' : ''"
        :aria-busy="loading"
      >
        <template #icon>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
          </svg>
        </template>
        <!-- Only "Clear all": with no filters the sentence names the header's
        New patient and Import, and repeating them here put two indigo "New
        patient" buttons on one screen. -->
        <template v-if="activeFilters.length > 0" #actions>
          <UiBtn @click="clearAllFilters">{{ t('Clear all', 'Quitar todo') }}</UiBtn>
        </template>
      </UiEmptyState>

      <!-- A real table, so a screen reader announces the column a cell belongs
      to. min-w below keeps it scrolling horizontally as one unit on a narrow
      screen rather than squeezing every column unreadably thin.
      On a tablet (md up to xl) it fits instead of scrolling: Last visit goes,
      and Care plan too below 1160px, because the column that scrolled out of
      sight was Balance -- the one reception looks for. -->
      <div v-else class="mt-3.5 overflow-hidden rounded-card border border-line bg-surface shadow-card" :aria-busy="loading || enriching">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[940px] border-collapse text-[13px] md:max-xl:min-w-[700px]">
            <caption class="sr-only">{{ t('Patients', 'Pacientes') }}</caption>
            <thead>
              <tr class="border-b border-line-row bg-surface-subtle2 text-[11px] font-[640] uppercase tracking-[.07em] text-ink-faint">
                <!-- The label around each checkbox is its hit area: a bare
                16px box beside a row that opens the record on a click was a
                near miss on the iPad, and a miss opened the record. -->
                <th scope="col" class="w-[44px] py-0 pl-1.5 pr-0 text-left">
                  <label class="flex h-9 w-9 cursor-pointer items-center justify-center touch:h-11 touch:w-11">
                    <input
                      type="checkbox"
                      data-cy="select-page"
                      class="h-4 w-4 cursor-pointer accent-brand disabled:cursor-default"
                      :checked="pageAllSelected"
                      :indeterminate="selectedIds.size > 0 && !pageAllSelected"
                      :disabled="patients.length === 0"
                      :aria-label="t('Select every patient on this page', 'Seleccionar todos los pacientes de esta página')"
                      @change="togglePage"
                    />
                  </label>
                </th>
                <th scope="col" class="px-5 py-2.5 text-left max-md:sticky max-md:left-0 max-md:z-[1] max-md:bg-surface-subtle2 max-md:px-3" :aria-sort="sortDir === 'asc' ? 'ascending' : 'descending'">
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 uppercase tracking-[.07em] outline-none hover:text-ink-600 focus-visible:shadow-focus"
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
                <th scope="col" class="md:max-xl:hidden w-[120px] px-3 py-2.5 text-left">{{ t('Last visit', 'Última visita') }}</th>
                <th scope="col" class="w-[150px] px-3 py-2.5 text-left">{{ t('Next visit', 'Próxima visita') }}</th>
                <th scope="col" class="md:max-[1159px]:hidden w-[165px] px-3 py-2.5 text-left">{{ t('Care plan', 'Plan de cuidados') }}</th>
                <th scope="col" class="hidden w-[130px] px-3 py-2.5 text-left xl:table-cell">{{ t('Tags', 'Etiquetas') }}</th>
                <th scope="col" class="w-[120px] px-3 py-2.5 text-right">{{ t('Balance', 'Saldo') }}</th>
                <th scope="col" class="w-[48px] px-3 py-2.5"><span class="sr-only">{{ t('Actions', 'Acciones') }}</span></th>
              </tr>
            </thead>

            <tbody v-if="!loadedOnce">
              <tr v-for="row in 8" :key="row" class="border-b border-line-row last:border-b-0">
                <td class="py-2.5 pl-1.5 pr-0" />
                <td class="px-5 py-2.5">
                  <div class="flex items-center gap-2.5">
                    <UiSkeleton class="h-[26px] w-[26px] shrink-0 rounded-full" />
                    <UiSkeleton class="h-3 w-36 rounded-ctlSm" />
                  </div>
                </td>
                <td v-for="cell in 5" :key="cell" :class="['px-3 py-2.5', cell === 2 ? 'md:max-xl:hidden' : cell === 4 ? 'md:max-[1159px]:hidden' : '']"><UiSkeleton class="h-3 w-20 rounded-ctlSm" /></td>
                <td class="hidden px-3 py-2.5 xl:table-cell"><UiSkeleton class="h-3 w-16 rounded-ctlSm" /></td>
                <td class="px-3 py-2.5" />
              </tr>
            </tbody>

            <tbody v-else class="transition-opacity" :class="loading ? 'pointer-events-none opacity-60' : ''">
              <tr
                v-for="patient in patients"
                :key="patient.id"
                class="group cursor-pointer border-b border-line-row last:border-b-0 hover:bg-surface-subtle"
                @click="onRowClick($event, patient.id)"
              >
                <td class="py-0 pl-1.5 pr-0">
                  <label class="flex h-9 w-9 cursor-pointer items-center justify-center touch:h-11 touch:w-11">
                    <input
                      type="checkbox"
                      data-cy="select-row"
                      class="h-4 w-4 cursor-pointer accent-brand"
                      :checked="allMatchingSelected || selectedIds.has(patient.id)"
                      :aria-label="`${t('Select', 'Seleccionar')} ${patient.first_name} ${patient.last_name ?? ''}`"
                      @change="toggleRow(patient.id)"
                    />
                  </label>
                </td>
                <!-- Pinned on a phone, where the table scrolls sideways: the
                     columns to the right are no use without the name they
                     belong to. Capped there too, so one long name does not
                     widen the column past the screen. -->
                <td class="px-5 py-2.5 max-md:sticky max-md:left-0 max-md:z-[1] max-md:w-[200px] max-md:min-w-[200px] max-md:max-w-[200px] max-md:bg-surface max-md:px-3 max-md:group-hover:bg-surface-subtle">
                  <div class="flex min-w-0 items-center gap-2.5">
                    <span aria-hidden="true" class="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-brand-tint text-[11px] font-[650] text-brand-text">
                      {{ initials(patient) }}
                    </span>
                    <div class="min-w-0 flex-1">
                      <!-- On a phone the name wraps rather than truncating,
                      and the flags drop under it: the pinned column is only
                      200px, and three flags beside a name left it four
                      letters and an ellipsis. -->
                      <p class="flex min-w-0 items-center gap-x-1.5 gap-y-0.5 text-[13.5px] font-[560] text-ink-900 max-md:flex-wrap">
                        <!-- A real link: openable in a new tab, and the thing
                        a screen reader announces as the row's subject. -->
                        <NuxtLink :to="`/patients/${patient.id}`" class="truncate outline-none hover:underline focus-visible:shadow-focus max-md:whitespace-normal max-md:break-words">
                          {{ patient.first_name }} {{ patient.last_name }}
                        </NuxtLink>
                        <UiPill v-if="patient.status === 'inactive'" class="shrink-0">{{ t('Archived', 'Archivado') }}</UiPill>
                        <UiPill v-if="patient.is_minor" tone="brand" class="shrink-0">{{ t('Minor', 'Menor') }}</UiPill>
                        <UiPill v-if="patient.do_not_contact" tone="danger" class="shrink-0">{{ t('Do not contact', 'No contactar') }}</UiPill>
                      </p>
                      <p class="w-0 min-w-full truncate text-[11.5px] text-ink-muted2">{{ secondaryLine(patient) || '—' }}</p>
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
                  <span v-else-if="enrichFailed" class="text-[12.5px] text-ink-faint2" :title="t('Could not be loaded', 'No se ha podido cargar')"><span aria-hidden="true">—</span><span class="sr-only">{{ t('Could not be loaded', 'No se ha podido cargar') }}</span></span>
                  <div v-else class="flex flex-wrap items-center gap-1.5">
                  <span v-if="primaryPhoneByPatient[patient.id]" class="inline-flex items-center gap-1.5">
                    <span class="whitespace-nowrap font-mono text-[12.5px] text-ink-700">{{ primaryPhoneByPatient[patient.id] }}</span>
                    <UiPill v-if="whatsappConsentByPatient[patient.id]" tone="success" :title="t('This number has WhatsApp', 'Este número tiene WhatsApp')">WA</UiPill>
                  </span>
                  <span v-else class="inline-flex items-center gap-1 text-[12.5px] text-warning-text">
                    <svg viewBox="0 0 12 12" aria-hidden="true" class="h-3 w-3 shrink-0">
                      <path d="M6 1.5 11 10.5H1z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
                      <path d="M6 5v2.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                      <circle cx="6" cy="9" r=".6" fill="currentColor" />
                    </svg>
                    {{ t('No phone', 'Sin teléfono') }}
                  </span>
                  <UiPill
                    v-if="patient.invoice_email_enabled"
                    tone="brand"
                    :title="t('Receipts are emailed to this patient', 'A este paciente se le envían los recibos por correo')"
                  >{{ t('Email', 'Correo') }}</UiPill>
                  </div>
                </td>

                <td class="md:max-xl:hidden px-3 py-2.5">
                  <UiSkeleton v-if="enriching" class="h-3 w-20 rounded-ctlSm" />
                  <span v-else-if="enrichFailed" class="text-[12.5px] text-ink-faint2" :title="t('Could not be loaded', 'No se ha podido cargar')"><span aria-hidden="true">—</span><span class="sr-only">{{ t('Could not be loaded', 'No se ha podido cargar') }}</span></span>
                  <span v-else-if="lastVisitText(patient.id)" class="whitespace-nowrap text-[13px] text-ink-700">{{ lastVisitText(patient.id) }}</span>
                  <span v-else class="text-[12.5px] text-ink-faint2">{{ t('Never', 'Nunca') }}</span>
                </td>

                <td class="px-3 py-2.5">
                  <UiSkeleton v-if="enriching" class="h-3 w-24 rounded-ctlSm" />
                  <span v-else-if="enrichFailed" class="text-[12.5px] text-ink-faint2" :title="t('Could not be loaded', 'No se ha podido cargar')"><span aria-hidden="true">—</span><span class="sr-only">{{ t('Could not be loaded', 'No se ha podido cargar') }}</span></span>
                  <template v-else-if="nextVisitInfo(patient.id).date">
                    <p class="whitespace-nowrap text-[13px] text-ink-700">{{ nextVisitInfo(patient.id).date }}</p>
                    <p class="text-[11.5px]" :class="nextVisitInfo(patient.id).colorClass">{{ nextVisitInfo(patient.id).relative }}</p>
                  </template>
                  <p v-else class="text-[13px]" :class="nextVisitInfo(patient.id).colorClass">{{ nextVisitInfo(patient.id).relative }}</p>
                </td>

                <td class="md:max-[1159px]:hidden px-3 py-2.5">
                  <UiSkeleton v-if="enriching" class="h-3 w-24 rounded-ctlSm" />
                  <span v-else-if="enrichFailed" class="text-[12.5px] text-ink-faint2" :title="t('Could not be loaded', 'No se ha podido cargar')"><span aria-hidden="true">—</span><span class="sr-only">{{ t('Could not be loaded', 'No se ha podido cargar') }}</span></span>
                  <template v-else-if="carePlanByPatient[patient.id]">
                    <div class="flex items-center justify-between gap-2">
                      <p class="w-0 min-w-0 flex-1 truncate text-[12.5px] text-ink-700" :title="carePlanByPatient[patient.id].name">{{ carePlanByPatient[patient.id].name }}</p>
                      <p class="shrink-0 font-mono text-[11px] text-ink-muted2">
                        {{ carePlanByPatient[patient.id].completed }}/{{ carePlanByPatient[patient.id].totalVisits ?? '∞' }}
                      </p>
                    </div>
                    <div v-if="carePlanByPatient[patient.id].totalVisits" class="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-chip-bg2">
                      <div
                        class="h-full rounded-full bg-brand"
                        :style="{ width: `${Math.min(100, (carePlanByPatient[patient.id].completed / carePlanByPatient[patient.id].totalVisits!) * 100)}%` }"
                      />
                    </div>
                  </template>
                  <p v-else class="text-[12.5px] text-ink-faint2">{{ t('No plan', 'Sin plan') }}</p>
                </td>

                <td class="hidden px-3 py-2.5 xl:table-cell">
                  <div class="flex flex-wrap items-center gap-1">
                    <UiPill v-for="tag in patient.tags" :key="tag" :tone="tagTone(tag)">{{ tag }}</UiPill>
                  </div>
                </td>

                <td class="px-3 py-2.5 text-right">
                  <!-- A non-breaking space before the label: Vue drops a plain
                  one at the edge of an element, which read "200,00 €a favor". -->
                  <UiSkeleton v-if="enriching" class="ml-auto h-4 w-16 rounded-[6px]" />
                  <span v-else-if="enrichFailed" class="text-[12.5px] text-ink-faint2" :title="t('Could not be loaded', 'No se ha podido cargar')"><span aria-hidden="true">—</span><span class="sr-only">{{ t('Could not be loaded', 'No se ha podido cargar') }}</span></span>
                  <span v-else class="inline-block whitespace-nowrap rounded-[6px] px-2 py-0.5 text-[12.5px]" :class="balancePill(balanceByPatient[patient.id] ?? 0).class"><span class="font-mono">{{ balancePill(balanceByPatient[patient.id] ?? 0).amount }}</span><span v-if="balancePill(balanceByPatient[patient.id] ?? 0).label" class="text-[12px] font-medium">&nbsp;{{ balancePill(balanceByPatient[patient.id] ?? 0).label }}</span>
                  </span>
                </td>

                <td class="px-3 py-2.5 text-right">
                  <PatientsRowActions
                    :patient-id="patient.id"
                    :patient-name="`${patient.first_name} ${patient.last_name}`"
                    :can-contact="!patient.is_minor"
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
          :summary="t(`Page ${page} of ${totalPages} · ${totalCount} patients`, `Página ${page} de ${totalPages} · ${totalCount} pacientes`)"
          @go-to-page="goToPage"
        />
      </div>
      </div>
    </div>
  </div>
</template>

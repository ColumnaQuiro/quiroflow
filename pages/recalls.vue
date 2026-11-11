<script setup lang="ts">
import type { Tables } from '~/types/database.types'
import { sanitizeSearchToken } from '~/utils/searchText'
import { fetchAllRows, fetchByIds } from '~/composables/useFetchAllRows'
import { formatEur } from '~/utils/billing'
import type { CareStop } from '~/composables/useCareStopReasons'

// Recordatorios: patients with no appointment ahead, worked through by the
// front desk. Design: the "QuiroFlow Recordatorios" canvas.
//
// Three tabs, one per place a patient can be in the queue:
//   Por contactar  recall_candidates -- lapsed, not snoozed, not dismissed
//   Pospuestos     recall_parked 'snoozed' -- back on their own on a date
//   Descartados    recall_parked 'dismissed' -- back on their own if they
//                  attend again and lapse (20260924153000), or by Restaurar
//
// Every row action is its own control. The old single "Acción…" <select>
// fired whatever was picked -- sending, logging, prioritising and dismissing
// all in one list with no undo. Overdue counts from the last visit the
// patient ATTENDED: a no-show no longer resets the clock, and is named
// under the date instead.
//
// Each recall has an owner (recall_assignments, 20261022185125): picked per
// row or for a selection, else the clinic's default from Settings > Recalls,
// resolved by the view as assigned_to. The list opens on "Mine" for someone
// who has any, so the calls are split and nobody rings the same patient twice.

type Recall = Tables<'recall_candidates'>
type Parked = Tables<'recall_parked'>
type TeamMember = Pick<Tables<'team_members'>, 'id' | 'full_name' | 'deleted_at'>
interface ContactLogRow {
  patient_id: string
  action: string
  created_at: string
  created_by: string | null
  note: string | null
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { formatShortDate } = useDates()
const logAccess = useAccessLog()
const { preference: language } = useLang()
const { showToast } = useToast()

type Tab = 'queue' | 'snoozed' | 'dismissed'
const tab = ref<Tab>('queue')
const ready = ref(false)

const recalls = ref<Recall[]>([])
const parked = ref<Parked[]>([])
const parkedCounts = ref<{ snoozed: number | null; dismissed: number | null }>({ snoozed: null, dismissed: null })
const teamMembers = ref<TeamMember[]>([])
const lastActionByPatient = ref<Record<string, ContactLogRow>>({})
const actionCountByPatient = ref<Record<string, number>>({})
const hasPhoneByPatient = ref<Record<string, boolean>>({})
const balanceByPatient = ref<Record<string, number>>({})
const onPlan = ref<Set<string>>(new Set())
const loading = ref(true)
// A failed read is said, with a way to try again; it used to fall through to
// "Nobody matches these filters", which reads as an empty queue.
const loadError = ref(false)
// Contact history, phones, balances and care plans arrive after the rows: the
// cells that read them show a skeleton meanwhile rather than "Not contacted
// yet" or "—", which would be wrong for a second.
const contextPending = ref(false)

// --- Filters: four in the bar, the rest behind "Más filtros" ----------------
const search = ref('')
const practitionerFilter = ref('')
// 'mine' | 'unassigned' | '' (everyone) | a team member's id. Starts empty and
// is settled once on mount (initialAssigneeFilter), before the first load.
const assigneeFilter = ref('')
const minWeeksOverdue = ref(3)
const WEEK_OPTIONS = [1, 2, 3, 4, 6, 8, 12]
const notContactedOnly = ref(false)
const moreFiltersOpen = ref(false)
// Alternative to minWeeksOverdue: "last seen on/after this date". Takes over
// the overdue threshold when set; combining the two has no coherent meaning.
const dateFrom = ref('')
const balanceFilter = ref<'any' | 'credit' | 'debit'>('any')
const tagFilter = ref('')
const extraFilterCount = computed(() => [dateFrom.value, balanceFilter.value !== 'any', tagFilter.value].filter(Boolean).length)

// --- Paging. No exact total for the queue, deliberately: recall_candidates
// joins through per-row RLS helpers, and a second full evaluation to count it
// pushed real accounts past Postgres's statement timeout. pageSize+1 rows
// answers "is there more" for the cost of the page itself.
const PAGE_SIZE = 50
const page = ref(1)
const hasNextPage = ref(false)
const maxKnownPage = ref(1)
const visiblePages = computed(() => Array.from({ length: Math.min(maxKnownPage.value, 10) }, (_, i) => i + 1))
// Tag substring matching and "not contacted" depend on data one PostgREST
// predicate cannot express, so with either on, every matching row is loaded
// and filtered here -- correctness over speed for two rarely-used filters.
const isPaginated = computed(() => !tagFilter.value && !notContactedOnly.value)
// Which of the two the rows on screen were fetched as. What is fetched depends
// only on that, not on the tag typed: see onClientFilterChange.
let loadedPaginated = true

// Every column but balance_cents: Postgres drops the balances join when
// nothing reads it (11.7ms against 363ms on a real account). Balances for the
// rows on screen are fetched by id instead.
const RECALL_COLUMNS =
  'patient_id, account_id, first_name, last_name, email, tags, recall_priority, default_practitioner_id, last_appointment_at, days_since_last_appointment, preferred_language, clinic_id, last_no_show_at, assigned_to'

// The list follows the clinic chosen in the sidebar. Patients from before
// clinics were assigned carry none, and belong to every clinic's list.
function scopeToClinic<Q extends { or: (f: string) => Q }>(query: Q): Q {
  return store.currentClinicId && store.clinics.length > 1 ? query.or(`clinic_id.eq.${store.currentClinicId},clinic_id.is.null`) : query
}
function searchTokens() {
  return search.value.trim().split(/\s+/).map(sanitizeSearchToken).filter(Boolean)
}

function buildQueueQuery() {
  let query = (
    balanceFilter.value !== 'any'
      ? supabase.from('recall_candidates').select(`${RECALL_COLUMNS}, balance_cents`)
      : supabase.from('recall_candidates').select(RECALL_COLUMNS)
  ) as any
  for (const token of searchTokens()) query = query.or(`first_name.ilike.%${token}%,last_name.ilike.%${token}%`)
  query = scopeToClinic(query)
  if (practitionerFilter.value) query = query.eq('default_practitioner_id', practitionerFilter.value)
  const assignee = assigneeFilter.value === 'mine' ? (store.teamMember?.id ?? null) : assigneeFilter.value
  if (assigneeFilter.value === 'unassigned' || (assigneeFilter.value === 'mine' && !assignee)) query = query.is('assigned_to', null)
  else if (assignee) query = query.eq('assigned_to', assignee)
  if (dateFrom.value) query = query.gte('last_appointment_at', `${dateFrom.value}T00:00:00`)
  else query = query.gte('days_since_last_appointment', minWeeksOverdue.value * 7)
  if (balanceFilter.value === 'credit') query = query.gt('balance_cents', 0)
  if (balanceFilter.value === 'debit') query = query.lt('balance_cents', 0)
  return query.order('recall_priority', { ascending: false, nullsFirst: false }).order('days_since_last_appointment', { ascending: false })
}

function buildParkedQuery(kind: 'snoozed' | 'dismissed') {
  let query = supabase
    .from('recall_parked')
    .select('patient_id, account_id, clinic_id, first_name, last_name, default_practitioner_id, last_appointment_at, days_since_last_appointment, recall_snoozed_until, recall_dismissed_at, parked_as')
    .eq('parked_as', kind) as any
  for (const token of searchTokens()) query = query.or(`first_name.ilike.%${token}%,last_name.ilike.%${token}%`)
  query = scopeToClinic(query)
  if (practitionerFilter.value) query = query.eq('default_practitioner_id', practitionerFilter.value)
  return kind === 'snoozed' ? query.order('recall_snoozed_until', { ascending: true }) : query.order('recall_dismissed_at', { ascending: false, nullsFirst: false })
}

async function loadParkedCounts() {
  const count = async (kind: 'snoozed' | 'dismissed') => {
    let q = supabase.from('recall_parked').select('patient_id', { count: 'exact', head: true }).eq('parked_as', kind) as any
    q = scopeToClinic(q)
    const { count: n } = await q
    return n ?? 0
  }
  const [snoozed, dismissed] = await Promise.all([count('snoozed'), count('dismissed')])
  parkedCounts.value = { snoozed, dismissed }
}

let loadToken = 0
async function load() {
  const token = ++loadToken
  loading.value = true
  if (tab.value === 'queue') {
    let query = buildQueueQuery()
    loadedPaginated = isPaginated.value
    if (isPaginated.value) {
      const from = (page.value - 1) * PAGE_SIZE
      query = query.range(from, from + PAGE_SIZE)
    }
    const { data, error } = await query
    if (token !== loadToken) return
    if (error) console.error('[recalls] load error', error)
    loadError.value = !!error
    const rows = (data ?? []) as Recall[]
    if (isPaginated.value) {
      hasNextPage.value = rows.length > PAGE_SIZE
      recalls.value = rows.slice(0, PAGE_SIZE)
      maxKnownPage.value = Math.max(maxKnownPage.value, hasNextPage.value ? page.value + 1 : page.value)
    } else {
      hasNextPage.value = false
      recalls.value = rows
    }
    const context = loadContactContext(recalls.value.map((r) => r.patient_id!).filter(Boolean), token)
    // The rows are on screen as soon as they arrive, and the contact context
    // fills its cells after. Not with "not contacted" on, though: that filter
    // reads the context, so the rows would show and then half of them vanish.
    if (!notContactedOnly.value) loading.value = false
    await context
  } else {
    const { data, error } = await buildParkedQuery(tab.value).range(0, 499)
    if (token !== loadToken) return
    if (error) console.error('[recalls] parked load error', error)
    loadError.value = !!error
    parked.value = (data ?? []) as Parked[]
    hasNextPage.value = false
    if (tab.value === 'dismissed') await loadStopReasonsFor(parked.value.map((p) => p.patient_id!), token)
  }
  if (token !== loadToken) return
  loading.value = false
}

// Contact history, phone on file, balances and care plans for the rows on
// screen -- a bounded page, or the full fallback set.
async function loadContactContext(ids: string[], token: number) {
  if (ids.length === 0) {
    lastActionByPatient.value = {}
    actionCountByPatient.value = {}
    hasPhoneByPatient.value = {}
    balanceByPatient.value = {}
    onPlan.value = new Set()
    contextPending.value = false
    return
  }
  contextPending.value = true
  const [logs, phones, balances, plans] = await Promise.all([
    fetchByIds(ids, (chunk) => supabase.from('contact_log').select('patient_id, action, created_at, created_by, note').in('patient_id', chunk).order('created_at', { ascending: false })),
    fetchByIds(ids, (chunk) => supabase.from('patients').select('id, has_phone').in('id', chunk)),
    fetchBalances(ids),
    fetchByIds(ids, (chunk) => supabase.from('care_plan_continuity_alerts').select('patient_id').in('patient_id', chunk)),
  ])
  if (token !== loadToken) return
  const last: Record<string, ContactLogRow> = {}
  const counts: Record<string, number> = {}
  for (const row of logs as ContactLogRow[]) {
    if (!last[row.patient_id]) last[row.patient_id] = row
    counts[row.patient_id] = (counts[row.patient_id] ?? 0) + 1
  }
  lastActionByPatient.value = last
  actionCountByPatient.value = counts
  const phoneMap: Record<string, boolean> = {}
  for (const p of phones) phoneMap[p.id] = p.has_phone
  hasPhoneByPatient.value = phoneMap
  balanceByPatient.value = balances
  onPlan.value = new Set(plans.map((p) => p.patient_id!).filter(Boolean))
  contextPending.value = false
}

async function fetchBalances(ids: string[]): Promise<Record<string, number>> {
  const rows = await fetchByIds(ids, (chunk) => supabase.from('patient_live_balances').select('patient_id, balance_cents').in('patient_id', chunk))
  const out: Record<string, number> = {}
  for (const b of rows) out[b.patient_id!] = b.balance_cents ?? 0
  return out
}

const teamDirectory = useTeamDirectory()
async function loadTeamMembers() {
  // A failed read left the list empty before; it still does.
  await teamDirectory.ensureLoaded().catch(() => {})
  teamMembers.value = teamDirectory.all.value
}
// Who a recall can be given to: a former colleague still names old contact
// log entries, but is offered nowhere.
const assignableMembers = computed(() => teamMembers.value.filter((m) => !m.deleted_at))

// "Mine" when the person has recalls of their own, else everyone. The
// sidebar's badge request already counted them (get_nav_badges'
// recalls_mine, the same 3-week threshold the list opens with), so this
// waits for that answer rather than running the view a second time. The
// sidebar asks on its first mount for anyone who may open this page, so the
// answer comes, as slowly as the view does; the limit is for a request that
// fails, when the list opens on everyone.
async function initialAssigneeFilter() {
  if (!store.teamMember) return ''
  const mine = await waitForRecallsMine(10_000)
  return mine && mine > 0 ? 'mine' : ''
}

function resetView() {
  maxKnownPage.value = 1
  page.value = 1
  selectedIds.value = new Set()
  openMenu.value = null
}
// A filter or a tab: the list, and nothing else. The parked counts and the
// sidebar badge depend on the clinic alone, so reloading them per filter was
// two exact counts and a badge refresh for numbers that could not move.
function reloadList() {
  resetView()
  load()
}
const { refresh: refreshNavBadges, recallsMine } = useNavBadges()
function waitForRecallsMine(ms: number): Promise<number | null> {
  if (recallsMine.value !== null) return Promise.resolve(recallsMine.value)
  return new Promise((resolve) => {
    const stop = watch(recallsMine, (v) => {
      if (v === null) return
      clearTimeout(timer)
      stop()
      resolve(v)
    })
    const timer = setTimeout(() => {
      stop()
      resolve(null)
    }, ms)
  })
}
// After snoozing, dismissing or restoring someone, which moves every count.
function refreshAll() {
  refreshNavBadges(['recalls'])
  reloadList()
  loadParkedCounts()
}

// Synchronous, so the first setting (below) can be told apart from a choice.
let settlingAssigneeFilter = false
watch(assigneeFilter, () => {
  if (!settlingAssigneeFilter) reloadList()
}, { flush: 'sync' })
onMounted(async () => {
  const [, filter] = await Promise.all([loadTeamMembers(), initialAssigneeFilter(), loadParkedCounts()])
  settlingAssigneeFilter = true
  assigneeFilter.value = filter
  settlingAssigneeFilter = false
  await load()
  ready.value = true
})
function goToPage(p: number) {
  page.value = Math.max(1, p)
  load()
}
let searchDebounce: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchDebounce)
  searchDebounce = setTimeout(reloadList, 300)
})
watch([practitionerFilter, dateFrom, minWeeksOverdue, balanceFilter, tab], reloadList)
// The sidebar recounts its own badge on a clinic switch.
watch(() => store.currentClinicId, () => {
  reloadList()
  loadParkedCounts()
})
// Tag and "not contacted" are applied in `filtered`, over rows that do not
// depend on them -- only on whether they are fetched a page at a time or all
// at once. So a fetch only when that flips (the first letter of a tag, the
// last one deleted); each keystroke in between reloaded the full set.
function onClientFilterChange() {
  if (tab.value === 'queue' && isPaginated.value !== loadedPaginated) {
    reloadList()
    return
  }
  selectedIds.value = new Set()
  openMenu.value = null
}
let tagDebounce: ReturnType<typeof setTimeout> | undefined
watch(tagFilter, () => {
  clearTimeout(tagDebounce)
  tagDebounce = setTimeout(onClientFilterChange, 300)
})
watch(notContactedOnly, onClientFilterChange)

const filtered = computed(() =>
  recalls.value.filter((r) => {
    if (tagFilter.value && !(r.tags ?? []).some((tag) => tag.toLowerCase().includes(tagFilter.value.toLowerCase()))) return false
    if (notContactedOnly.value && lastActionByPatient.value[r.patient_id!]) return false
    return true
  }),
)

// --- How a row reads --------------------------------------------------------
function practitionerName(id: string | null) {
  return teamMembers.value.find((m) => m.id === id)?.full_name ?? t('Unassigned', 'Sin asignar')
}
function assigneeName(id: string | null) {
  return id ? (teamMembers.value.find((m) => m.id === id)?.full_name ?? t('Unassigned', 'Sin asignar')) : t('Unassigned', 'Sin asignar')
}
function initials(r: { first_name: string | null; last_name: string | null }) {
  return ((r.first_name?.[0] ?? '') + (r.last_name?.[0] ?? '')).toUpperCase() || '?'
}
function fullName(r: { first_name: string | null; last_name: string | null }) {
  return `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim()
}
function longDate(iso: string | null) {
  if (!iso) return t('N/A', 'N/D')
  return new Date(iso).toLocaleDateString(uiLocaleTag(language.value), { day: 'numeric', month: 'short', year: 'numeric' })
}
function weeksOf(days: number | null) {
  return Math.floor((days ?? 0) / 7)
}
function overdueLabel(days: number | null) {
  const w = weeksOf(days)
  return w === 1 ? t('1 week overdue', '1 semana de retraso') : t(`${w} weeks overdue`, `${w} semanas de retraso`)
}
// Red is money on this page (and the calendar); a long lapse is amber.
function overdueTone(days: number | null) {
  return weeksOf(days) >= 8 ? 'warning' : 'neutral'
}
// A no-show since the last attended visit: said, because the overdue clock
// no longer counts it.
function noShowNote(r: Recall) {
  if (!r.last_no_show_at || !r.last_appointment_at || r.last_no_show_at <= r.last_appointment_at) return null
  return t(`Didn't come on ${formatShortDate(r.last_no_show_at)}`, `No vino el ${formatShortDate(r.last_no_show_at)}`)
}
function balanceText(patientId: string) {
  const c = balanceByPatient.value[patientId] ?? 0
  if (c < 0) return { text: t(`Owes ${formatEur(-c)}`, `Debe ${formatEur(-c)}`), cls: 'text-danger-text' }
  if (c > 0) return { text: t(`${formatEur(c)} in credit`, `${formatEur(c)} a favor`), cls: 'text-success-text' }
  return { text: '—', cls: 'text-ink-faint' }
}
const ACTION_LABELS: Record<string, [string, string]> = {
  sent_whatsapp: ['WhatsApp sent', 'WhatsApp enviado'],
  called_no_answer: ['Called, no answer', 'Llamada, sin respuesta'],
  called_left_message: ['Left a message', 'Dejé un mensaje'],
  booked: ['Booked', 'Reservó cita'],
  other: ['Contacted', 'Contactado'],
}
function hasPhone(patientId: string) {
  return hasPhoneByPatient.value[patientId] ?? false
}
function lastContact(r: Recall): { text: string; sub: string | null; tone: 'done' | 'none' | 'warn' } {
  const entry = lastActionByPatient.value[r.patient_id!]
  if (entry) {
    const pair = ACTION_LABELS[entry.action]
    const who = entry.created_by ? teamMembers.value.find((m) => m.id === entry.created_by)?.full_name?.split(/\s+/)[0] : entry.note?.startsWith('Automation') ? t('automatic', 'automático') : null
    return { text: pair ? t(pair[0], pair[1]) : entry.action, sub: [formatShortDate(entry.created_at), who].filter(Boolean).join(' · '), tone: 'done' }
  }
  if (!hasPhone(r.patient_id!) && !r.email) return { text: t('No phone or email', 'Sin teléfono ni correo'), sub: null, tone: 'warn' }
  return { text: t('Not contacted yet', 'Aún sin contacto'), sub: null, tone: 'none' }
}

// --- Row actions ----------------------------------------------------------------
const openMenu = ref<{ id: string; kind: 'log' | 'more' } | null>(null)
function toggleMenu(id: string, kind: 'log' | 'more') {
  openMenu.value = openMenu.value?.id === id && openMenu.value.kind === kind ? null : { id, kind }
}
function onDocumentClick(e: MouseEvent) {
  if (openMenu.value && !(e.target as HTMLElement).closest('[data-row-menu]')) openMenu.value = null
}
onMounted(() => document.addEventListener('click', onDocumentClick))
onUnmounted(() => document.removeEventListener('click', onDocumentClick))

async function refreshLastAction(patientId: string) {
  const { data } = await supabase.from('contact_log').select('patient_id, action, created_at, created_by, note').eq('patient_id', patientId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (data) {
    lastActionByPatient.value = { ...lastActionByPatient.value, [patientId]: data as ContactLogRow }
    actionCountByPatient.value = { ...actionCountByPatient.value, [patientId]: (actionCountByPatient.value[patientId] ?? 0) + 1 }
  }
}

// After a call that got nobody, the next step is offered, not forced: try
// again in a couple of days (a snooze), or leave them where they are.
const followUp = ref<{ patientId: string; name: string; action: string } | null>(null)
let followUpTimer: ReturnType<typeof setTimeout> | undefined
async function logCall(r: Recall, action: 'called_no_answer' | 'called_left_message' | 'booked') {
  openMenu.value = null
  const { error } = await supabase.from('contact_log').insert({ account_id: store.accountId!, patient_id: r.patient_id!, action, created_by: store.teamMember?.id ?? null })
  if (error) {
    showToast(error.message, 'error')
    return
  }
  await refreshLastAction(r.patient_id!)
  if (action === 'booked') {
    showToast(t('Logged as booked. Book the slot in the calendar if it is not there yet.', 'Registrado como reservado. Si aún no está en el calendario, resérvala allí.'))
    return
  }
  clearTimeout(followUpTimer)
  followUp.value = { patientId: r.patient_id!, name: fullName(r), action }
  followUpTimer = setTimeout(() => (followUp.value = null), 15000)
}

async function togglePriority(r: Recall) {
  openMenu.value = null
  const next = !r.recall_priority
  await supabase.from('patients').update({ recall_priority: next }).eq('id', r.patient_id!)
  r.recall_priority = next
}

// --- Snooze ------------------------------------------------------------------------
function isoDateIn(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const SNOOZE_SPANS = computed(() => [
  { days: 7, label: t('1 week', '1 semana') },
  { days: 14, label: t('2 weeks', '2 semanas') },
  { days: 30, label: t('1 month', '1 mes') },
  { days: 91, label: t('3 months', '3 meses') },
])
const snoozeFor = ref<{ ids: string[]; name: string } | null>(null)
const snoozeUntil = ref('')
const snoozing = ref(false)
function openSnooze(ids: string[], name: string) {
  openMenu.value = null
  snoozeFor.value = { ids, name }
  snoozeUntil.value = isoDateIn(14)
}
async function snooze(ids: string[], until: string) {
  snoozing.value = true
  try {
    // fetchByIds: a bulk snooze can be hundreds of ids, past one URL.
    await fetchByIds(ids, (chunk) => supabase.from('patients').update({ recall_snoozed_until: until }).in('id', chunk).select('id'))
  } catch (e: any) {
    showToast(e?.message ?? String(e), 'error')
    return false
  } finally {
    snoozing.value = false
  }
  showToast(t(`Snoozed until ${formatShortDate(until)}`, `Pospuesto hasta el ${formatShortDate(until)}`))
  refreshAll()
  return true
}
async function confirmSnooze() {
  if (!snoozeFor.value || !snoozeUntil.value) return
  if (await snooze(snoozeFor.value.ids, snoozeUntil.value)) snoozeFor.value = null
}
async function followUpSnooze(days: number) {
  if (!followUp.value) return
  const id = followUp.value.patientId
  followUp.value = null
  await snooze([id], isoDateIn(days))
}

// --- Dismiss / restore / reactivate --------------------------------------------
const dismissFor = ref<{ ids: string[]; name: string } | null>(null)
const dismissing = ref(false)
function openDismiss(ids: string[], name: string) {
  openMenu.value = null
  dismissFor.value = { ids, name }
  dismissReasonId.value = ''
  dismissNote.value = ''
  if (!stopReasonsLoaded.value) loadStopReasons()
}
async function confirmDismiss() {
  if (!dismissFor.value) return
  dismissing.value = true
  try {
    await fetchByIds(dismissFor.value.ids, (chunk) =>
      supabase.from('patients').update({ recall_status: 'dismissed', recall_dismissed_at: new Date().toISOString() }).in('id', chunk).select('id'),
    )
  } catch (e: any) {
    showToast(e?.message ?? String(e), 'error')
    return
  } finally {
    dismissing.value = false
  }
  // The reason, when one was given, after the dismissal: a reason that fails
  // to save does not undo it, and says so.
  if (dismissReasonId.value) {
    const { error } = await supabase.rpc('record_care_stop', { p_patient_ids: dismissFor.value.ids, p_reason_id: dismissReasonId.value, p_note: dismissNote.value })
    if (error) showToast(t(`Dismissed, but the reason was not saved: ${error.message}`, `Descartado, pero el motivo no se ha guardado: ${error.message}`), 'error')
  }
  dismissFor.value = null
  showToast(t('Dismissed from recalls.', 'Descartado de recordatorios.'))
  refreshAll()
}

// --- Reasons for stopping care (Settings > Recalls) ------------------------------
// Optional on Descartar; shown, set and changed on the Dismissed tab. Snooze
// is "not now", not a reason, so it asks for none.
const { reasons: stopReasons, loaded: stopReasonsLoaded, load: loadStopReasons, nameOf: stopReasonName, fetchCurrent: fetchCurrentStops } = useCareStopReasons()
const dismissReasonId = ref('')
const dismissNote = ref('')
const stopByPatient = ref<Record<string, CareStop>>({})
const stopFor = ref<Parked | null>(null)
async function loadStopReasonsFor(ids: string[], token: number) {
  const [stops] = await Promise.all([fetchCurrentStops(ids), stopReasonsLoaded.value ? null : loadStopReasons()])
  if (token === loadToken) stopByPatient.value = stops
}
async function onStopSaved() {
  stopFor.value = null
  await loadStopReasonsFor(parked.value.map((p) => p.patient_id!), loadToken)
}
async function restore(p: Parked) {
  const values = p.parked_as === 'dismissed' ? { recall_status: 'active', recall_dismissed_at: null } : { recall_snoozed_until: null }
  const { error } = await supabase.from('patients').update(values).eq('id', p.patient_id!)
  if (error) {
    showToast(error.message, 'error')
    return
  }
  showToast(p.parked_as === 'dismissed' ? t('Back in recalls.', 'De vuelta en recordatorios.') : t('Back in the list.', 'De vuelta en la lista.'))
  refreshAll()
}

// --- WhatsApp ----------------------------------------------------------------------
const sendingTo = ref<Recall | null>(null)
function onSent() {
  if (sendingTo.value) refreshLastAction(sendingTo.value.patient_id!)
  sendingTo.value = null
}
const historyFor = ref<Recall | null>(null)

// --- Selection (applies to the current view) -----------------------------------
const selectedIds = ref<Set<string>>(new Set())
const selectedRecalls = computed(() => filtered.value.filter((r) => selectedIds.value.has(r.patient_id!)))
const allVisibleSelected = computed(() => filtered.value.length > 0 && filtered.value.every((r) => selectedIds.value.has(r.patient_id!)))
// Nobody without a phone is sent a WhatsApp: the bulk send says how many it
// skips instead of failing on them one by one.
const reachableSelected = computed(() => selectedRecalls.value.filter((r) => hasPhone(r.patient_id!)))
const unreachableCount = computed(() => selectedRecalls.value.length - reachableSelected.value.length)
function toggleSelectAll() {
  const next = new Set(selectedIds.value)
  if (allVisibleSelected.value) for (const r of filtered.value) next.delete(r.patient_id!)
  else for (const r of filtered.value) next.add(r.patient_id!)
  selectedIds.value = next
}
function toggleSelect(id: string) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}
const bulkWhatsAppOpen = ref(false)
function onBulkSent() {
  for (const r of reachableSelected.value) refreshLastAction(r.patient_id!)
}
function closeBulkWhatsApp() {
  bulkWhatsAppOpen.value = false
  selectedIds.value = new Set()
}
const assignMenuOpen = ref(false)
async function bulkAssignPractitioner(teamMemberId: string) {
  const ids = selectedRecalls.value.map((r) => r.patient_id!)
  if (ids.length === 0) return
  await fetchByIds(ids, (chunk) => supabase.from('patients').update({ default_practitioner_id: teamMemberId }).in('id', chunk).select('id'))
  for (const r of recalls.value) if (ids.includes(r.patient_id!)) r.default_practitioner_id = teamMemberId
  assignMenuOpen.value = false
  selectedIds.value = new Set()
}
// --- Who follows them up ---------------------------------------------------------
// Through the server, which tells the colleague (staffPush recall_assignments).
// A row the filter no longer matches leaves the list there and then.
const assigning = ref(false)
const assignToMenuOpen = ref(false)
function matchesAssigneeFilter(assignedTo: string | null) {
  if (assigneeFilter.value === 'unassigned') return assignedTo === null
  if (assigneeFilter.value === 'mine') return assignedTo !== null && assignedTo === store.teamMember?.id
  return !assigneeFilter.value || assignedTo === assigneeFilter.value
}
async function assignRecalls(ids: string[], teamMemberId: string | null) {
  if (ids.length === 0) return false
  assigning.value = true
  try {
    await $fetch('/api/recalls/assign', { method: 'POST', body: { patientIds: ids, teamMemberId } })
  } catch (e: any) {
    showToast(e?.data?.statusMessage ?? e?.message ?? String(e), 'error')
    return false
  } finally {
    assigning.value = false
  }
  const set = new Set(ids)
  for (const r of recalls.value) if (set.has(r.patient_id!)) r.assigned_to = teamMemberId
  recalls.value = recalls.value.filter((r) => !set.has(r.patient_id!) || matchesAssigneeFilter(r.assigned_to))
  refreshNavBadges(['recalls'])
  if (ids.length > 1) {
    showToast(teamMemberId ? t(`${ids.length} assigned to ${assigneeName(teamMemberId)}`, `${ids.length} asignados a ${assigneeName(teamMemberId)}`) : t(`${ids.length} left unassigned`, `${ids.length} sin asignar`))
    assignToMenuOpen.value = false
    selectedIds.value = new Set()
  }
  return true
}
async function onRowAssign(r: Recall, e: Event) {
  const select = e.target as HTMLSelectElement
  // Not saved: the picker goes back to who it was.
  if (!(await assignRecalls([r.patient_id!], select.value || null))) select.value = r.assigned_to ?? ''
}

const selectionName = computed(() => (selectedRecalls.value.length === 1 ? fullName(selectedRecalls.value[0]) : t(`${selectedRecalls.value.length} patients`, `${selectedRecalls.value.length} pacientes`)))

// --- Export ----------------------------------------------------------------------
function csvEscape(v: string) {
  return /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
const exporting = ref(false)
async function exportCsv() {
  exporting.value = true
  const all = await fetchAllRows<Recall>((from, to) => buildQueueQuery().range(from, to))
  const matched = all.filter((r) => {
    if (tagFilter.value && !(r.tags ?? []).some((tag) => tag.toLowerCase().includes(tagFilter.value.toLowerCase()))) return false
    if (notContactedOnly.value && lastActionByPatient.value[r.patient_id!]) return false
    return true
  })
  const balances = await fetchBalances(matched.map((r) => r.patient_id!).filter(Boolean))
  const header = [t('Patient', 'Paciente'), t('Last visit', 'Última visita'), t('Days overdue', 'Días de retraso'), t('Practitioner', 'Profesional'), t('Assigned to', 'Asignado a'), t('Balance', 'Saldo'), t('Last contact', 'Último contacto')]
  const rows = matched.map((r) => [fullName(r), longDate(r.last_appointment_at), String(r.days_since_last_appointment ?? ''), practitionerName(r.default_practitioner_id), assigneeName(r.assigned_to), formatEur(balances[r.patient_id!] ?? 0), lastContact(r).text])
  const csv = [header, ...rows].map((cols) => cols.map(csvEscape).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `recordatorios-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  logAccess('export', null, { export: 'recalls', rows: rows.length })
  exporting.value = false
}

const tabs = computed(() => [
  { key: 'queue' as const, label: t('To contact', 'Por contactar'), count: null },
  { key: 'snoozed' as const, label: t('Snoozed', 'Pospuestos'), count: parkedCounts.value.snoozed },
  { key: 'dismissed' as const, label: t('Dismissed', 'Descartados'), count: parkedCounts.value.dismissed },
])
const clinicName = computed(() => (store.clinics.length > 1 ? store.currentClinic?.name : null))

// The shared empty state, drawn inside the list's own card: its border and
// shadow would otherwise put a card inside a card.
const INSET_EMPTY = '!py-0 [&>div]:max-w-none [&>div]:gap-3 [&>div]:border-0 [&>div]:py-7 [&>div]:shadow-none'
// The queue's columns, from xl. Below that the row stacks: eight columns
// beside a 236px sidebar left the patient's name ~30px at 1024 and wrapped
// the overdue chip into two lines even at 1440. The practitioner now sits
// under the name, as it already did on the Snoozed and Dismissed tabs.
const QUEUE_COLUMNS = 'xl:grid-cols-[44px_minmax(0,2fr)_140px_144px_104px_minmax(0,1.4fr)_224px]'
</script>

<template>
  <div class="flex h-full flex-col" data-cy="recalls-page" :data-ready="ready ? 'true' : 'false'">
    <PageHeader :title="t('Recalls', 'Recuperaciones')" :meta="clinicName ? t(`Patients with no next appointment, ${clinicName}`, `Pacientes sin próxima cita, ${clinicName}`) : t('Patients with no next appointment', 'Pacientes sin próxima cita')">
      <UiBtn v-if="tab === 'queue'" variant="secondary" :disabled="exporting" @click="exportCsv">{{ exporting ? t('Exporting…', 'Exportando…') : t('Export CSV', 'Exportar CSV') }}</UiBtn>
    </PageHeader>

    <!-- Tighter on a phone, where the third tab used to run off the edge. -->
    <div role="tablist" class="flex shrink-0 overflow-x-auto border-b border-line bg-surface px-2 sm:gap-1 sm:px-6">
      <button
        v-for="tb in tabs"
        :key="tb.key"
        type="button"
        role="tab"
        :aria-selected="tab === tb.key"
        :data-cy="`recalls-tab-${tb.key}`"
        class="-mb-px flex h-12 shrink-0 items-center gap-1.5 border-b-2 px-2 text-[14px] font-semibold sm:px-3"
        :class="tab === tb.key ? 'border-brand text-ink-900' : 'border-transparent text-ink-muted hover:text-ink-700'"
        @click="tab = tb.key"
      >
        {{ tb.label }}
        <UiPill v-if="tb.count !== null" :tone="tab === tb.key ? 'brand' : 'neutral'" class="font-mono">{{ tb.count }}</UiPill>
      </button>
    </div>

    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-24 pt-4 sm:px-6">
      <p class="mb-3 text-[12.5px] text-ink-muted">
        {{
          tab === 'queue'
            ? t('Overdue counts from the last visit they attended. Priority first, then longest overdue.', 'El retraso cuenta desde la última visita a la que vinieron. Prioridad primero, luego más retraso.')
            : tab === 'snoozed'
              ? t('Back in the list on their own on the date shown.', 'Vuelven solos a la lista en la fecha indicada.')
              : t('Back on their own if they attend again and lapse; or restore them now.', 'Vuelven solos si acuden otra vez y vuelve a pasar el plazo; o restáuralos ya.')
        }}
      </p>

      <!-- Filters -->
      <div class="flex flex-wrap items-center gap-2">
        <label class="flex h-9 touch:h-11 w-full items-center gap-2 rounded-ctl border border-line-control bg-surface px-3 focus-within:border-brand focus-within:shadow-focus sm:w-72">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="shrink-0 text-ink-muted" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input v-model="search" type="search" data-cy="recalls-search" :aria-label="t('Search patient', 'Buscar paciente')" :placeholder="t('Search patient', 'Buscar paciente')" class="min-w-0 flex-1 bg-transparent text-[14px] text-ink-900 outline-none placeholder:text-ink-faint" />
        </label>
        <template v-if="tab === 'queue'">
          <select
            v-model.number="minWeeksOverdue"
            :disabled="!!dateFrom"
            data-cy="recalls-weeks"
            :aria-label="t('Overdue', 'Retraso')"
            class="h-9 touch:h-11 rounded-full border border-brand-tintBorder bg-brand-tint px-3 text-[13.5px] font-semibold text-brand-text focus:outline-none disabled:opacity-40"
          >
            <option v-for="w in WEEK_OPTIONS" :key="w" :value="w">{{ t(`Overdue: ${w}+ weeks`, `Retraso: ${w}+ semanas`) }}</option>
          </select>
        </template>
        <select
          v-if="tab === 'queue'"
          v-model="assigneeFilter"
          data-cy="recalls-assignee-filter"
          :aria-label="t('Assigned to', 'Asignado a')"
          class="h-9 touch:h-11 rounded-full border px-3 text-[13.5px] font-semibold focus:outline-none"
          :class="assigneeFilter ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'"
        >
          <option value="mine">{{ t('Assigned to me', 'Asignados a mí') }}</option>
          <option value="unassigned">{{ t('Unassigned', 'Sin asignar') }}</option>
          <option value="">{{ t("Everyone's", 'De todo el equipo') }}</option>
          <option v-for="m in assignableMembers" :key="m.id" :value="m.id">{{ t(`Assigned to ${m.full_name}`, `Asignados a ${m.full_name}`) }}</option>
        </select>
        <select
          v-model="practitionerFilter"
          :aria-label="t('Practitioner', 'Profesional')"
          class="h-9 touch:h-11 rounded-full border px-3 text-[13.5px] font-semibold focus:outline-none"
          :class="practitionerFilter ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'"
        >
          <option value="">{{ t('Any practitioner', 'Cualquier profesional') }}</option>
          <option v-for="m in teamMembers" :key="m.id" :value="m.id">{{ m.full_name }}</option>
        </select>
        <template v-if="tab === 'queue'">
          <button
            type="button"
            data-cy="recalls-not-contacted"
            :aria-pressed="notContactedOnly"
            class="h-9 touch:h-11 rounded-full border px-3.5 text-[13.5px] font-semibold"
            :class="notContactedOnly ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'"
            @click="notContactedOnly = !notContactedOnly"
          >
            {{ t('Not contacted yet', 'Sin contactar') }}
          </button>
          <button
            type="button"
            data-cy="recalls-more-filters"
            :aria-expanded="moreFiltersOpen"
            class="h-9 touch:h-11 rounded-full border border-dashed border-line-control px-3.5 text-[13.5px] font-semibold text-ink-500"
            @click="moreFiltersOpen = !moreFiltersOpen"
          >
            {{ t('More filters', 'Más filtros') }}<span v-if="extraFilterCount"> · {{ extraFilterCount }}</span>
          </button>
        </template>
      </div>
      <div v-if="tab === 'queue' && moreFiltersOpen" class="mt-2 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-3" data-cy="recalls-more-panel">
        <label class="flex flex-col gap-1 text-[12.5px] font-semibold text-ink-700">
          {{ t('Balance', 'Saldo') }}
          <select v-model="balanceFilter" class="h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-2 text-[13.5px] font-normal text-ink-900">
            <option value="any">{{ t('Any', 'Cualquiera') }}</option>
            <option value="debit">{{ t('Owing', 'Debe') }}</option>
            <option value="credit">{{ t('In credit', 'A favor') }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 text-[12.5px] font-semibold text-ink-700">
          {{ t('Tag', 'Etiqueta') }}
          <input v-model="tagFilter" type="search" class="h-9 touch:h-11 w-40 rounded-ctl border border-line-control bg-surface px-2 text-[13.5px] font-normal text-ink-900" />
        </label>
        <label class="flex flex-col gap-1 text-[12.5px] font-semibold text-ink-700">
          {{ t('Last visit since (instead of weeks)', 'Última visita desde (en vez de semanas)') }}
          <input v-model="dateFrom" type="date" class="h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-2 text-[13.5px] font-normal text-ink-900" />
        </label>
        <button v-if="extraFilterCount" type="button" class="h-9 touch:h-11 px-2 text-[13px] font-semibold text-brand-text" @click="(dateFrom = ''), (balanceFilter = 'any'), (tagFilter = '')">{{ t('Clear', 'Borrar') }}</button>
      </div>

      <!-- The list -->
      <div class="mt-4 overflow-visible rounded-card border border-line bg-surface">
        <!-- Bulk bar -->
        <div v-if="tab === 'queue' && selectedIds.size > 0" class="flex flex-wrap items-center gap-2 rounded-t-card border-b border-brand-tintBorder bg-brand-tint px-4 py-2" data-cy="recalls-bulk">
          <strong class="text-[14px] text-brand-text">{{ t(`${selectedIds.size} selected`, `${selectedIds.size} seleccionados`) }}</strong>
          <UiBtn variant="primary" data-cy="recalls-bulk-whatsapp" :disabled="reachableSelected.length === 0" @click="bulkWhatsAppOpen = true">
            {{ t(`WhatsApp to ${reachableSelected.length}`, `WhatsApp a ${reachableSelected.length}`) }}
          </UiBtn>
          <span v-if="unreachableCount" class="text-[12.5px] text-ink-500" data-cy="recalls-bulk-skipped">{{ t(`${unreachableCount} without a phone, skipped`, `${unreachableCount} sin teléfono, se salta`) }}</span>
          <div class="relative" data-row-menu>
            <button type="button" data-cy="recalls-bulk-assign" :disabled="assigning" class="h-9 touch:h-11 rounded-ctl px-3 text-[13.5px] font-semibold text-brand-text disabled:opacity-50" @click="assignToMenuOpen = !assignToMenuOpen">{{ t('Assign to…', 'Asignar a…') }}</button>
            <div v-if="assignToMenuOpen" role="menu" class="absolute left-0 top-full z-20 mt-1 w-52 rounded-ctl border border-line bg-surface py-1 shadow-popover" data-cy="recalls-bulk-assign-menu">
              <button type="button" role="menuitem" class="block min-h-9 touch:min-h-11 w-full px-3 text-left text-[13.5px] text-ink-500 hover:bg-surface-subtle" @click="assignRecalls(selectedRecalls.map((r) => r.patient_id!), null)">{{ t('Nobody', 'Nadie') }}</button>
              <button v-for="m in assignableMembers" :key="m.id" type="button" role="menuitem" class="block min-h-9 touch:min-h-11 w-full px-3 text-left text-[13.5px] text-ink-700 hover:bg-surface-subtle" @click="assignRecalls(selectedRecalls.map((r) => r.patient_id!), m.id)">{{ m.full_name }}</button>
            </div>
          </div>
          <div class="relative" data-row-menu>
            <button type="button" class="h-9 touch:h-11 rounded-ctl px-3 text-[13.5px] font-semibold text-brand-text" @click="assignMenuOpen = !assignMenuOpen">{{ t('Assign practitioner', 'Asignar profesional') }}</button>
            <div v-if="assignMenuOpen" role="menu" class="absolute left-0 top-full z-20 mt-1 w-52 rounded-ctl border border-line bg-surface py-1 shadow-popover">
              <button v-for="m in teamMembers" :key="m.id" type="button" role="menuitem" class="block min-h-9 touch:min-h-11 w-full px-3 text-left text-[13.5px] text-ink-700 hover:bg-surface-subtle" @click="bulkAssignPractitioner(m.id)">{{ m.full_name }}</button>
            </div>
          </div>
          <button type="button" data-cy="recalls-bulk-snooze" class="h-9 touch:h-11 rounded-ctl px-3 text-[13.5px] font-semibold text-brand-text" @click="openSnooze(selectedRecalls.map((r) => r.patient_id!), selectionName)">{{ t('Snooze…', 'Posponer…') }}</button>
          <button type="button" data-cy="recalls-bulk-dismiss" class="h-9 touch:h-11 rounded-ctl px-3 text-[13.5px] font-semibold text-brand-text" @click="openDismiss(selectedRecalls.map((r) => r.patient_id!), selectionName)">{{ t('Dismiss…', 'Descartar…') }}</button>
          <button type="button" class="ml-auto h-9 touch:h-11 rounded-ctl px-3 text-[13.5px] font-semibold text-ink-500" @click="selectedIds = new Set()">{{ t('Clear selection', 'Quitar selección') }}</button>
        </div>

        <!-- Queue -->
        <template v-if="tab === 'queue'">
          <div
            v-if="loading || (!loadError && filtered.length > 0)"
            class="hidden h-10 items-center gap-3 border-b border-line bg-surface-subtle px-4 text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted xl:grid"
            :class="QUEUE_COLUMNS"
          >
            <label class="flex h-9 touch:h-11 w-9 touch:w-11 items-center justify-center"><input type="checkbox" :checked="allVisibleSelected" :aria-label="t('Select all', 'Seleccionar todos')" class="h-[18px] w-[18px] accent-brand" @change="toggleSelectAll" /></label>
            <span>{{ t('Patient', 'Paciente') }}</span><span>{{ t('Last visit', 'Última visita') }}</span><span>{{ t('Assigned to', 'Asignado a') }}</span><span class="text-right">{{ t('Balance', 'Saldo') }}</span><span>{{ t('Last contact', 'Último contacto') }}</span><span></span>
          </div>
          <div v-if="loading" class="space-y-3 p-4"><UiSkeleton v-for="i in 6" :key="i" class="h-12 rounded-ctl" /></div>
          <UiEmptyState
            v-else-if="loadError"
            :title="t(`Couldn't load the list`, 'No se ha podido cargar la lista')"
            :description="t('The connection dropped or the server took too long to answer. Nothing has been changed.', 'Se ha cortado la conexión o el servidor ha tardado demasiado en responder. No se ha cambiado nada.')"
            :class="INSET_EMPTY"
            data-cy="recalls-load-error"
          >
            <template #icon>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
            </template>
            <template #actions>
              <UiBtn @click="load()">{{ t('Try again', 'Reintentar') }}</UiBtn>
            </template>
          </UiEmptyState>
          <UiEmptyState v-else-if="filtered.length === 0" :title="t('Nobody matches these filters', 'Nadie coincide con estos filtros')" :class="INSET_EMPTY" data-cy="recalls-empty">
            <template #icon>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </template>
          </UiEmptyState>
          <div
            v-for="r in filtered"
            v-else
            :key="r.patient_id!"
            data-cy="recall-row"
            :data-patient-id="r.patient_id"
            class="grid grid-cols-[44px_minmax(0,1fr)] gap-x-3 gap-y-2 border-b border-line-row px-4 py-3 xl:items-center"
            :class="[QUEUE_COLUMNS, selectedIds.has(r.patient_id!) ? 'bg-brand-tint' : '']"
          >
            <!-- Stacked below xl: everything after the checkbox is pinned to
                 the second column (col-start-2), so no line falls into the
                 checkbox's 44px. The balance did, and showed as a stray dash. -->
            <label class="flex h-9 touch:h-11 w-9 touch:w-11 items-center justify-center">
              <input type="checkbox" :checked="selectedIds.has(r.patient_id!)" :aria-label="t(`Select ${fullName(r)}`, `Seleccionar a ${fullName(r)}`)" class="h-[18px] w-[18px] accent-brand" @change="toggleSelect(r.patient_id!)" />
            </label>
            <div class="col-start-2 flex min-w-0 items-center gap-2.5 xl:col-start-auto">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[12.5px] font-bold text-brand-text">{{ initials(r) }}</span>
              <div class="min-w-0">
                <!-- Wraps rather than truncates: a cut-off surname is the one
                     thing the front desk needs to read before ringing. -->
                <NuxtLink :to="`/patients/${r.patient_id}`" class="block break-words text-[14.5px] font-semibold leading-snug text-ink-900 hover:text-brand-text">{{ fullName(r) }}</NuxtLink>
                <span v-if="r.default_practitioner_id" class="block text-[12.5px] text-ink-muted" data-cy="recall-practitioner">{{ practitionerName(r.default_practitioner_id) }}</span>
                <div v-if="r.recall_priority || onPlan.has(r.patient_id!) || (r.tags ?? []).length" class="mt-1 flex flex-wrap gap-1">
                  <UiPill v-if="r.recall_priority" tone="warning" data-cy="recall-priority">{{ t('Priority', 'Prioridad') }}</UiPill>
                  <NuxtLink v-if="onPlan.has(r.patient_id!)" to="/care-plan-alerts" class="rounded-pill hover:opacity-80">
                    <UiPill tone="info">{{ t('Care plan', 'Plan de cuidados') }}<UiChevron dir="right" class="-ml-1 !h-3 !w-3" /></UiPill>
                  </NuxtLink>
                  <UiPill v-for="tag in r.tags" :key="tag">{{ tag }}</UiPill>
                </div>
              </div>
            </div>
            <div class="col-start-2 flex flex-col items-start gap-1 xl:col-start-auto">
              <span class="text-[13.5px] text-ink-700">{{ longDate(r.last_appointment_at) }}</span>
              <UiPill :tone="overdueTone(r.days_since_last_appointment)" class="whitespace-nowrap" data-cy="recall-overdue">{{ overdueLabel(r.days_since_last_appointment) }}</UiPill>
              <span v-if="noShowNote(r)" class="text-[12px] text-ink-muted" data-cy="recall-no-show">{{ noShowNote(r) }}</span>
            </div>
            <label class="col-start-2 flex min-w-0 items-center gap-1.5 xl:col-start-auto">
              <span class="shrink-0 text-[12.5px] text-ink-muted xl:sr-only">{{ t('Assigned to', 'Asignado a') }}</span>
              <select
                :value="r.assigned_to ?? ''"
                :disabled="assigning"
                data-cy="recall-assignee"
                :aria-label="t(`Who follows up ${fullName(r)}`, `Quién hace el seguimiento de ${fullName(r)}`)"
                class="h-9 touch:h-11 min-w-0 max-w-full truncate rounded-ctl border bg-surface pl-2 text-[13px] focus:border-brand focus:outline-none xl:w-full"
                :class="r.assigned_to ? 'border-line-control font-semibold text-ink-900' : 'border-dashed border-line-control text-ink-muted'"
                @change="onRowAssign(r, $event)"
              >
                <option value="">{{ t('Unassigned', 'Sin asignar') }}</option>
                <option v-for="m in assignableMembers" :key="m.id" :value="m.id">{{ m.full_name }}</option>
              </select>
            </label>
            <!-- A zero balance is a dash in the column, and nothing at all in
                 the stacked row, where a lone dash said nothing. -->
            <div v-if="contextPending" class="col-start-2 hidden xl:col-start-auto xl:flex xl:justify-end"><UiSkeleton class="h-4 w-16 rounded" /></div>
            <span
              v-else
              class="col-start-2 text-[13.5px] font-semibold xl:col-start-auto xl:text-right"
              :class="[balanceText(r.patient_id!).cls, balanceByPatient[r.patient_id!] ? '' : 'hidden xl:block']"
            >{{ balanceText(r.patient_id!).text }}</span>
            <div class="col-start-2 min-w-0 xl:col-start-auto" data-cy="recall-last-contact">
              <UiSkeleton v-if="contextPending" class="h-4 w-28 rounded" />
              <button v-else-if="actionCountByPatient[r.patient_id!]" type="button" class="text-left text-[13.5px] text-ink-900 hover:underline" @click="historyFor = r">{{ lastContact(r).text }}</button>
              <span v-else class="text-[13.5px]" :class="lastContact(r).tone === 'warn' ? 'font-semibold text-warning-text' : 'text-ink-muted'">{{ lastContact(r).text }}</span>
              <span v-if="!contextPending && lastContact(r).sub" class="block text-[12px] text-ink-muted">{{ lastContact(r).sub }}</span>
            </div>
            <!-- Row actions: each its own control -->
            <div class="relative col-start-2 flex items-center gap-1.5 xl:col-start-auto xl:justify-end" data-row-menu>
              <button
                type="button"
                data-cy="recall-whatsapp"
                :disabled="!hasPhone(r.patient_id!)"
                :title="hasPhone(r.patient_id!) ? t('Send the recall on WhatsApp', 'Enviar el recordatorio por WhatsApp') : t('No phone: add one on their chart', 'Sin teléfono: añádelo en su ficha')"
                class="flex h-9 touch:h-11 items-center gap-1.5 rounded-ctl border px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:border-line disabled:bg-surface disabled:text-ink-faint"
                :class="hasPhone(r.patient_id!) ? 'border-success-border bg-success-bg text-success-text' : ''"
                @click="sendingTo = r"
              >
                WhatsApp
              </button>
              <UiBtn data-cy="recall-log" aria-haspopup="menu" :aria-expanded="openMenu?.id === r.patient_id && openMenu?.kind === 'log'" class="!px-3" @click="toggleMenu(r.patient_id!, 'log')">
                {{ t('Log call', 'Registrar') }}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" class="-mr-0.5 h-3.5 w-3.5 shrink-0"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
              </UiBtn>
              <button type="button" data-cy="recall-more" :aria-label="t(`More for ${fullName(r)}`, `Más acciones para ${fullName(r)}`)" aria-haspopup="menu" :aria-expanded="openMenu?.id === r.patient_id && openMenu?.kind === 'more'" class="flex h-9 touch:h-11 w-9 touch:w-11 items-center justify-center rounded-ctl border border-line-control bg-surface text-ink-500 hover:border-line-controlHover" @click="toggleMenu(r.patient_id!, 'more')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
              </button>
              <div v-if="openMenu?.id === r.patient_id && openMenu?.kind === 'log'" role="menu" class="absolute right-0 top-full z-20 mt-1 flex w-60 flex-col rounded-card border border-line bg-surface p-1.5 shadow-popover" data-cy="recall-log-menu">
                <span class="px-2.5 pb-1 pt-1.5 text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted">{{ t('Log a call', 'Registrar llamada') }}</span>
                <button type="button" role="menuitem" data-cy="recall-log-no-answer" class="min-h-9 touch:min-h-11 rounded-ctlSm px-2.5 text-left text-[14px] text-ink-900 hover:bg-surface-subtle" @click="logCall(r, 'called_no_answer')">{{ t('No answer', 'Sin respuesta') }}</button>
                <button type="button" role="menuitem" data-cy="recall-log-message" class="min-h-9 touch:min-h-11 rounded-ctlSm px-2.5 text-left text-[14px] text-ink-900 hover:bg-surface-subtle" @click="logCall(r, 'called_left_message')">{{ t('Left a message', 'Dejé un mensaje') }}</button>
                <button type="button" role="menuitem" data-cy="recall-log-booked" class="min-h-9 touch:min-h-11 rounded-ctlSm bg-success-bg px-2.5 text-left text-[14px] font-semibold text-success-text" @click="logCall(r, 'booked')">{{ t('Booked an appointment', 'Reservó cita') }}</button>
              </div>
              <div v-if="openMenu?.id === r.patient_id && openMenu?.kind === 'more'" role="menu" class="absolute right-0 top-full z-20 mt-1 flex w-56 flex-col rounded-card border border-line bg-surface p-1.5 shadow-popover" data-cy="recall-more-menu">
                <button type="button" role="menuitem" data-cy="recall-priority-toggle" class="min-h-9 touch:min-h-11 rounded-ctlSm px-2.5 text-left text-[14px] text-ink-900 hover:bg-surface-subtle" @click="togglePriority(r)">{{ r.recall_priority ? t('Remove priority', 'Quitar prioridad') : t('Mark as priority', 'Marcar prioridad') }}</button>
                <button type="button" role="menuitem" data-cy="recall-snooze" class="min-h-9 touch:min-h-11 rounded-ctlSm px-2.5 text-left text-[14px] text-ink-900 hover:bg-surface-subtle" @click="openSnooze([r.patient_id!], fullName(r))">{{ t('Snooze…', 'Posponer…') }}</button>
                <button type="button" role="menuitem" data-cy="recall-dismiss" class="min-h-9 touch:min-h-11 rounded-ctlSm px-2.5 text-left text-[14px] text-ink-900 hover:bg-surface-subtle" @click="openDismiss([r.patient_id!], fullName(r))">{{ t('Dismiss…', 'Descartar…') }}</button>
              </div>
            </div>
          </div>
          <UiPaginationFooter
            v-if="!loading && isPaginated && (page > 1 || recalls.length > 0)"
            :page="page"
            :visible-pages="visiblePages"
            :has-prev="page > 1"
            :has-next="hasNextPage"
            :summary="t(`${recalls.length} shown`, `${recalls.length} mostrados`)"
            @go-to-page="goToPage"
          />
        </template>

        <!-- Snoozed / dismissed -->
        <template v-else>
          <div v-if="loading" class="space-y-3 p-4"><UiSkeleton v-for="i in 4" :key="i" class="h-12 rounded-ctl" /></div>
          <UiEmptyState
            v-else-if="loadError"
            :title="t(`Couldn't load the list`, 'No se ha podido cargar la lista')"
            :description="t('The connection dropped or the server took too long to answer. Nothing has been changed.', 'Se ha cortado la conexión o el servidor ha tardado demasiado en responder. No se ha cambiado nada.')"
            :class="INSET_EMPTY"
            data-cy="recalls-load-error"
          >
            <template #icon>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
            </template>
            <template #actions>
              <UiBtn @click="load()">{{ t('Try again', 'Reintentar') }}</UiBtn>
            </template>
          </UiEmptyState>
          <UiEmptyState
            v-else-if="parked.length === 0"
            :title="tab === 'snoozed' ? t('Nobody is snoozed', 'No hay nadie pospuesto') : t('Nobody has been dismissed', 'No hay nadie descartado')"
            :class="INSET_EMPTY"
            data-cy="recalls-parked-empty"
          >
            <template #icon>
              <svg v-if="tab === 'snoozed'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
            </template>
          </UiEmptyState>
          <div v-for="p in parked" v-else :key="p.patient_id!" data-cy="parked-row" class="flex flex-wrap items-center gap-3 border-b border-line-row px-4 py-3">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-chip-bg text-[12.5px] font-bold text-ink-500">{{ initials(p) }}</span>
            <div class="min-w-0 flex-1">
              <NuxtLink :to="`/patients/${p.patient_id}`" class="block break-words text-[14.5px] font-semibold leading-snug text-ink-900 hover:text-brand-text">{{ fullName(p) }}</NuxtLink>
              <span class="text-[12.5px] text-ink-muted">{{ t('Last visit', 'Última visita') }} {{ longDate(p.last_appointment_at) }} · {{ practitionerName(p.default_practitioner_id) }}</span>
            </div>
            <span class="text-[13.5px] text-ink-700" data-cy="parked-when">
              <template v-if="p.parked_as === 'snoozed'">{{ t(`Back on ${formatShortDate(p.recall_snoozed_until!)}`, `Vuelve el ${formatShortDate(p.recall_snoozed_until!)}`) }}</template>
              <template v-else-if="p.recall_dismissed_at">{{ t(`Dismissed on ${formatShortDate(p.recall_dismissed_at)}`, `Descartado el ${formatShortDate(p.recall_dismissed_at)}`) }}</template>
              <template v-else>{{ t('Dismissed', 'Descartado') }}</template>
            </span>
            <button
              v-if="p.parked_as === 'dismissed'"
              type="button"
              data-cy="parked-stop-reason"
              class="h-9 touch:h-11 rounded-ctl px-2 text-[13px]"
              :class="stopByPatient[p.patient_id!] ? 'bg-chip-bg font-semibold text-chip-text' : 'font-semibold text-brand-text hover:underline'"
              :title="stopByPatient[p.patient_id!]?.note ?? undefined"
              @click="stopFor = p"
            >
              {{ stopByPatient[p.patient_id!] ? stopReasonName(stopByPatient[p.patient_id!]!.reason_id) : t('Add reason', 'Añadir motivo') }}
            </button>
            <UiBtn data-cy="parked-restore" @click="restore(p)">
              {{ p.parked_as === 'snoozed' ? t('Bring back now', 'Reactivar ya') : t('Restore', 'Restaurar') }}
            </UiBtn>
          </div>
        </template>
      </div>
    </div>

    <!-- After an unanswered call: the next step, offered -->
    <div v-if="followUp" role="status" data-cy="recall-follow-up" class="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-[480px] flex-col gap-3 rounded-card bg-ink-900 p-4 text-surface-page shadow-popover">
      <span class="text-[14px] leading-snug">
        <strong>{{ followUp.action === 'called_no_answer' ? t('No answer', 'Llamada sin respuesta') : t('Message left', 'Mensaje dejado') }}</strong>
        {{ t(`logged for ${followUp.name}. Try again later?`, `registrado para ${followUp.name}. ¿Lo volvemos a intentar más adelante?`) }}
      </span>
      <div class="flex flex-wrap gap-2">
        <button type="button" data-cy="recall-follow-up-2d" class="h-9 touch:h-11 rounded-ctl bg-brand px-3 text-[13.5px] font-semibold text-brand-on hover:bg-brand-hover" @click="followUpSnooze(2)">{{ t('In 2 days', 'En 2 días') }}</button>
        <button type="button" class="h-9 touch:h-11 rounded-ctl border border-surface-page/30 px-3 text-[13.5px] font-semibold" @click="followUpSnooze(7)">{{ t('In 1 week', 'En 1 semana') }}</button>
        <button type="button" data-cy="recall-follow-up-keep" class="h-9 touch:h-11 px-3 text-[13.5px] font-semibold opacity-80" @click="followUp = null">{{ t('Keep in the list', 'Dejarlo en la lista') }}</button>
      </div>
    </div>

    <UiConfirmDialog
      v-if="snoozeFor"
      :title="t(`Snooze ${snoozeFor.name}`, `Posponer a ${snoozeFor.name}`)"
      :confirm-label="t(`Snooze until ${snoozeUntil ? formatShortDate(snoozeUntil) : '…'}`, `Posponer hasta el ${snoozeUntil ? formatShortDate(snoozeUntil) : '…'}`)"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="snoozing || !snoozeUntil"
      @confirm="confirmSnooze"
      @cancel="snoozeFor = null"
    >
      <p class="text-[14px] leading-relaxed text-ink-500">{{ t("Out of the list, and back on their own on the day you choose if they still haven't booked.", 'Sale de la lista y vuelve sola el día que elijas, si sigue sin cita.') }}</p>
      <div role="radiogroup" :aria-label="t('Until when', 'Hasta cuándo')" class="grid grid-cols-2 gap-2" data-cy="snooze-options">
        <button
          v-for="s in SNOOZE_SPANS"
          :key="s.days"
          type="button"
          role="radio"
          :aria-checked="snoozeUntil === isoDateIn(s.days)"
          class="flex min-h-14 flex-col items-start justify-center rounded-ctl border px-3 text-left"
          :class="snoozeUntil === isoDateIn(s.days) ? 'border-brand bg-brand-tint' : 'border-line-control bg-surface'"
          @click="snoozeUntil = isoDateIn(s.days)"
        >
          <span class="text-[14px] font-semibold text-ink-900">{{ s.label }}</span>
          <span class="text-[12.5px] text-ink-muted">{{ t(`until ${formatShortDate(isoDateIn(s.days))}`, `hasta el ${formatShortDate(isoDateIn(s.days))}`) }}</span>
        </button>
      </div>
      <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
        {{ t('Or a date', 'O una fecha') }}
        <input v-model="snoozeUntil" type="date" data-cy="snooze-date" :min="isoDateIn(1)" class="h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] font-normal text-ink-900" />
      </label>
    </UiConfirmDialog>

    <UiConfirmDialog
      v-if="dismissFor"
      :title="t(`Dismiss ${dismissFor.name}?`, `¿Descartar a ${dismissFor.name}?`)"
      :confirm-label="t('Dismiss', 'Descartar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="dismissing"
      @confirm="confirmDismiss"
      @cancel="dismissFor = null"
    >
      <p class="text-[14px] leading-relaxed text-ink-500">{{ t('They stop appearing in recalls: nobody messages or calls them from here.', 'Deja de aparecer en recordatorios: no se le escribe ni se le llama desde aquí.') }}</p>
      <p class="rounded-ctl border border-line bg-surface-subtle px-3.5 py-3 text-[13.5px] leading-snug text-ink-700">
        {{ t('If they come to an appointment and then lapse again, they come back on their own. You can also restore them any time from Dismissed.', 'Si vuelve a una cita y después pasa otra vez el plazo, reaparece sola. Y puedes restaurarlo cuando quieras desde Descartados.') }}
      </p>
      <PatientsCareStopFields v-model:reason-id="dismissReasonId" v-model:note="dismissNote" :reasons="stopReasons" optional />
    </UiConfirmDialog>

    <PatientsCareStopDialog
      v-if="stopFor"
      :patient-id="stopFor.patient_id!"
      :patient-name="fullName(stopFor)"
      :reasons="stopReasons"
      :current="stopByPatient[stopFor.patient_id!] ?? null"
      @close="stopFor = null"
      @saved="onStopSaved"
    />

    <ContactHistoryModal v-if="historyFor" :patient-id="historyFor.patient_id!" :patient-name="fullName(historyFor)" @close="historyFor = null" />
    <SendWhatsAppModal
      v-if="sendingTo"
      :patient-id="sendingTo.patient_id!"
      :patient-first-name="sendingTo.first_name ?? ''"
      :patient-preferred-language="sendingTo.preferred_language ?? undefined"
      :default-template-name="store.whatsappRecallTemplateName"
      @close="sendingTo = null"
      @sent="onSent"
    />
    <BulkSendWhatsAppModal
      v-if="bulkWhatsAppOpen"
      :targets="reachableSelected.map((r) => ({ patientId: r.patient_id!, firstName: r.first_name ?? '' }))"
      :default-template-name="store.whatsappRecallTemplateName"
      @close="closeBulkWhatsApp"
      @sent="onBulkSent"
    />
  </div>
</template>

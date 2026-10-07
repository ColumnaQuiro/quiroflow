<script setup lang="ts">
import { formatEur, formatLongWeekdayDate, formatShortDate, formatTime, formatWeekdayDate } from '~/utils/billing'
import type { BusinessHours } from '~/utils/businessHours'
import { dayKeyFor, hasBusinessHoursConfigured, outsideWorkingHours, practitionerWindowsForDay, unionWorkingWindows, windowsForDay, withinWindows } from '~/utils/businessHours'
import type { AppointmentTypeOverride } from '~/utils/appointmentOverrides'
import { appointmentStage, matchesFilter, needsNextBookingFlag, STAGE_FILTERS, stageCounts, type AppointmentStage, type StageFilter } from '~/utils/appointmentStage'
import { shortPatientName } from '~/utils/appointmentBlock'
import { bonoForVisit, type VisitPayment } from '~/utils/visitPayment'
import { effectivePriceCents } from '~/utils/appointmentOverrides'
import { orderTypes } from '~/utils/appointmentTypes'
import type { MoveClash } from '~/utils/moveClash'
import { FILTER_DOT_CLASS, STAGE_TONE, STAGE_TONE_CLASS } from '~/composables/useAppointmentStage'
import type { BlockView } from '~/components/calendar/AppointmentBlock.vue'
import type { FlowRow } from '~/components/calendar/FlowTracker.vue'

const START_HOUR = 8
const END_HOUR = 20
const TOTAL_MIN = (END_HOUR - START_HOUR) * 60

// Row scale: these are floors, not fixed values -- on a viewport taller
// than 12 hours' worth of rows, the actual per-hour height grows to fill
// whatever vertical space is available (tracked via ResizeObserver below).
// Raised well past what most viewports compute on their own so rows read
// as comfortably tall on a normal screen; the grid (12h worth of rows) then
// runs taller than the viewport on most screens and the scroll container
// (scrollAreaRef, overflow-y-auto below) takes over instead of shrinking
// rows to force everything to fit above the fold.
const DAY_HOUR_PX_MIN = 127
const WEEK_HOUR_PX_MIN = 81
const DAY_HEADER_PX = 40 // h-10 room-header row, excluded from available grid height
const WEEK_HEADER_PX = 70 // day label + per-day counts + room-label rows (week view has room sub-columns per day, like Day view)
const WEEK_ROOM_COL_PX = 128 // min width per room sub-column

const scrollAreaRef = ref<HTMLElement | null>(null)
const scrollAreaHeight = ref(0)
let scrollAreaObserver: ResizeObserver | null = null
onMounted(() => {
  if (!scrollAreaRef.value) return
  scrollAreaObserver = new ResizeObserver(([entry]) => {
    scrollAreaHeight.value = entry.contentRect.height
  })
  scrollAreaObserver.observe(scrollAreaRef.value)
})
onUnmounted(() => scrollAreaObserver?.disconnect())

const DAY_HOUR_PX = computed(() => Math.max(DAY_HOUR_PX_MIN, Math.floor((scrollAreaHeight.value - DAY_HEADER_PX) / (END_HOUR - START_HOUR))))
const WEEK_HOUR_PX = computed(() => Math.max(WEEK_HOUR_PX_MIN, Math.floor((scrollAreaHeight.value - WEEK_HEADER_PX) / (END_HOUR - START_HOUR))))

// A short appointment's floor only needs to fit one line: below 40px a
// block collapses to name, stage and money on a single row (utils/
// appointmentBlock), close to a real 15min slot's natural height, instead of
// forcing every short appointment to occupy ~2 grid rows.
const DAY_MIN_BLOCK_PX = 22
const WEEK_MIN_BLOCK_PX = 18
// Availability/unavailable bands only need to fit a centered one-line label.
const DAY_MIN_AVAILABILITY_PX = 20
const WEEK_MIN_AVAILABILITY_PX = 16

// Overlapping appointments split into equal-width side-by-side columns --
// every appointment stays fully visible (nothing layered behind another),
// at the cost of each one getting narrower as more pile up at the same
// time. Past maxLanes, the remaining appointments in that cluster collapse
// into a single "+N more" chip in the last lane rather than splitting into
// slivers too narrow to read at all. Day view's room columns are wider
// than week view's, so it tolerates a couple more lanes before that kicks in.
const DAY_MAX_LANES = 6
const WEEK_MAX_LANES = 4
const OVERFLOW_CHIP_PX = 20

interface Room { id: string; name: string }
interface AppointmentType { id: string; name: string; duration_minutes: number; color: string; default_price_cents: number; sort_order: number | null; archived_at: string | null }
interface TeamMember { id: string; full_name: string; color: string; business_hours: BusinessHours | null }
interface TeamMemberClinic { team_member_id: string; clinic_id: string }

interface AvailabilityBlock { id: string; room_id: string | null; practitioner_id: string | null; starts_at: string; ends_at: string; note: string | null }

interface AppointmentRow {
  id: string
  patient_id: string
  room_id: string | null
  practitioner_id: string | null
  appointment_type_id: string | null
  starts_at: string
  ends_at: string
  status: string
  checked_in_at: string | null
  flow_with_practitioner_at: string | null
  flow_checkout_at: string | null
  rescheduled: boolean
  confirmation_status: string | null
  deleted_at: string | null
  note: string | null
  source: string
  confirmation_sent_at: string | null
  reminder_sent_at: string | null
  same_day_info_sent_at: string | null
  created_at: string
  patients: { first_name: string; last_name: string | null; sticky_note: string | null } | null
  appointment_types: { name: string; color: string; default_price_cents: number } | null
  team_members: { full_name: string; color: string } | null
  /**
   * Set only on a moved-away marker: the slot this visit USED to hold, drawn
   * faded where it was. The real visit is `_movedFrom`, and `_movedTo` is
   * where it is now.
   */
  _movedFrom?: AppointmentRow
  _movedTo?: string
}

const supabase = useSupabaseClient()
const { fetchVisitPayments } = useVisitPayments()
const store = useAccountStore()
const { can, restricted } = usePermission()
// calendar_read_only: sees the diary, changes nothing in it. The database
// has refused the writes since 0047; this stops offering them -- booking,
// dragging, resizing, blocking time -- instead of letting each one fail.
const readOnly = computed(() => restricted('calendar_read_only'))
const t = useT()

const SLOT_MIN = computed(() => store.currentClinic?.slot_duration_minutes ?? 30)

// Cash Shift ("Caja") was only reachable from the account-menu dropdown --
// surfacing it directly on the calendar too, where staff actually work
// through the day, matches PracticeHub's placement.
const cashShiftOpen = ref(false)
const mobileInfoOpen = ref(false)
// The phone header's "more" menu (view, cash shift, block time, the day's info).
const phoneMenuOpen = ref(false)
function phoneMenu(action: () => void) {
  phoneMenuOpen.value = false
  action()
}

// Defaults to 'workweek', but this is really just the fallback for a
// browser that's never opened the calendar before -- the real value is
// whatever the user last picked, persisted in localStorage below so a
// refresh doesn't silently snap back to a hardcoded default.
const CALENDAR_VIEW_MODE_KEY = 'quiroflow-calendar-view-mode'
const viewMode = ref<'day' | 'workweek' | 'week'>('workweek')
onMounted(() => {
  const stored = localStorage.getItem(CALENDAR_VIEW_MODE_KEY)
  if (stored === 'day' || stored === 'workweek' || stored === 'week') viewMode.value = stored
  // A phone that has never chosen gets the day, which is the agenda there --
  // a week of room columns does not fit 375px.
  else if (window.matchMedia('(max-width: 767px)').matches) viewMode.value = 'day'
})
watch(viewMode, (v) => localStorage.setItem(CALENDAR_VIEW_MODE_KEY, v))
// PracticeHub never shows a merged "all practitioners" calendar -- with
// several practitioners double-booking the same room at different times,
// a merged view stacks unrelated appointments on top of each other into an
// unreadable pile. One practitioner tab at a time, like PH, sidesteps that
// entirely instead of trying to render overlaps nicely.
const CALENDAR_PRACTITIONER_KEY = 'quiroflow-calendar-practitioner'
// An appointment can end up with no practitioner at all -- a PracticeHub
// import whose practitioner name matched nobody, a public-API booking that
// omitted one, a form saved as "Unassigned". With one tab per practitioner
// and nothing else, those rows match no tab and simply never render, while
// still being counted in "Today at a glance" -- so the grid disagrees with
// the number above it and the appointment looks lost. This filter value is
// the tab that shows them.
const UNASSIGNED_PRACTITIONER = '__unassigned'
// The whole clinic at once. It was left out on purpose while two
// practitioners double-booked into one room stacked into an unreadable pile;
// overlapping visits now split into side-by-side lanes (assignOverlapLayout),
// and the front desk's real question -- "who is in the building, who still
// owes" -- is about everyone, not one practitioner. Opt-in: the calendar still
// opens on the last tab used, or the first practitioner.
const ALL_PRACTITIONERS = '__all'
const practitionerFilter = ref('')
const anchorDate = ref(new Date())
const rooms = ref<Room[]>([])
const appointmentTypes = ref<AppointmentType[]>([])
// Archived types (Settings -> Appointment Types) are not offered for a new
// appointment, but one already on an appointment stays choosable in that
// appointment's own panel -- otherwise opening "Change" on an old visit would
// show no type and saving would quietly clear it.
const activeAppointmentTypes = computed(() => appointmentTypes.value.filter((x) => !x.archived_at))
function typesForPanel(currentTypeId: string | null | undefined) {
  return appointmentTypes.value.filter((x) => !x.archived_at || x.id === currentTypeId)
}
const teamMembers = ref<TeamMember[]>([])
const teamMemberClinics = ref<TeamMemberClinic[]>([])
const overrides = ref<AppointmentTypeOverride[]>([])
const appointments = ref<AppointmentRow[]>([])
const availabilityBlocks = ref<AvailabilityBlock[]>([])
const loading = ref(true)

const modalOpen = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const editingAppointment = ref<AppointmentRow | null>(null)
// The open appointment is looked up by id in the live list, so a reload after
// a step taken in the panel hands it the fresh row.
const openAppointment = computed(() => {
  if (!modalOpen.value || modalMode.value !== 'edit' || !editingAppointment.value) return null
  const id = editingAppointment.value.id
  // The flow tracker opens today's visits while the grid may be on another
  // week, so today's own rows are the fallback -- and a moved-away marker
  // opens its visit wherever it went, often a day not on screen.
  return (
    appointments.value.find((a) => a.id === id) ??
    todayRows.value.find((a) => a.id === id) ??
    movedAwayMarkers.value.find((m) => m._movedFrom?.id === id)?._movedFrom ??
    null
  )
})
/** The tab the appointment panel opens on; the flow tracker's "Cobrar" asks for Cobro. */
const panelInitialTab = ref<'summary' | 'billing'>('summary')
const prefill = ref<{ date: string; time: string; roomId: string } | null>(null)

// Booking from a patient's page (/calendar?patient=<id>): the slot is still
// chosen here, as always, but whichever way the new-appointment panel opens
// it starts with that patient instead of a search. Cleared once the visit is
// booked, or with the chip's x.
const route = useRoute()
const bookingFor = ref<{ id: string; name: string } | null>(null)
watch(
  () => route.query.patient,
  async (id) => {
    if (typeof id !== 'string' || !id) {
      bookingFor.value = null
      return
    }
    const { data } = await supabase.from('patients').select('id, first_name, last_name').eq('id', id).maybeSingle()
    if (route.query.patient !== id) return
    bookingFor.value = data ? { id: data.id, name: `${data.first_name} ${data.last_name ?? ''}`.trim() } : null
  },
  { immediate: true },
)
function stopBookingFor() {
  bookingFor.value = null
  navigateTo({ query: { ...route.query, patient: undefined } }, { replace: true })
}

const blockModalOpen = ref(false)
const editingBlock = ref<AvailabilityBlock | null>(null)
const blockPrefill = ref<{ date: string; time: string; roomId: string } | null>(null)

// "Display" toggles in the left panel, per the redesign spec.
//
// Cancelled visits leave the grid: the slot they held is free, and a struck-
// through block sitting in it reads as "taken". showCancelled brings them
// back for the times someone needs to see what was there. (It was
// hideCancelled, default on; flipped so the switch reads the way it acts.)
const settings = reactive({
  privacyMode: false,
  flowTracker: true,
  showAvailability: true,
  showCancelled: false,
  hideRescheduled: false,
  hideDeleted: true,
})
const displayToggles = computed<{ key: keyof typeof settings; label: string }[]>(() => [
  { key: 'privacyMode', label: t('Privacy mode', 'Modo privacidad') },
  { key: 'flowTracker', label: t('Flow tracker', 'Seguimiento de flujo') },
  { key: 'showAvailability', label: t('Show availability', 'Mostrar disponibilidad') },
  { key: 'showCancelled', label: t('Show cancelled', 'Mostrar canceladas') },
  { key: 'hideRescheduled', label: t('Hide rescheduled', 'Ocultar reprogramadas') },
  { key: 'hideDeleted', label: t('Hide deleted', 'Ocultar eliminadas') },
])

function pad(n: number) {
  return String(n).padStart(2, '0')
}
function toDateKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function startOfDay(d: Date) {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}
function startOfWeek(d: Date) {
  const c = startOfDay(d)
  const day = c.getDay()
  const diff = day === 0 ? -6 : 1 - day
  c.setDate(c.getDate() + diff)
  return c
}
function addDays(d: Date, n: number) {
  const c = new Date(d)
  c.setDate(c.getDate() + n)
  return c
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
function addMonths(d: Date, n: number) {
  const c = new Date(d)
  c.setMonth(c.getMonth() + n)
  return c
}
function isSameDate(a: Date, b: Date) {
  return toDateKey(a) === toDateKey(b)
}

const weekStart = computed(() => startOfWeek(anchorDate.value))
const weekDays = computed(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart.value, i)))
// Work week shows the same Mon-Sun grid as Week, just fewer day columns
// (Mon-Fri) -- data fetching and week navigation stay identical, this only
// slices which day columns render.
const visibleWeekDays = computed(() => (viewMode.value === 'workweek' ? weekDays.value.slice(0, 5) : weekDays.value))

const rangeLabel = computed(() => {
  if (viewMode.value === 'day') return formatLongWeekdayDate(anchorDate.value)
  const days = visibleWeekDays.value
  return `${formatShortDate(weekStart.value)} – ${formatShortDate(days[days.length - 1])}`
})
function stepDate(dir: -1 | 1) {
  anchorDate.value = addDays(anchorDate.value, viewMode.value === 'day' ? dir : dir * 7)
}
function goToday() {
  anchorDate.value = new Date()
}

// Single mini month in the sidebar, per the redesign spec (the old two-month
// picker is dropped). Clicking a day jumps the main calendar there.
const miniBase = ref(startOfMonth(anchorDate.value))
const miniMonthLabel = computed(() => miniBase.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))
function miniCalendarGrid(monthStart: Date): (Date | null)[] {
  const year = monthStart.getFullYear()
  const month = monthStart.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstWeekday = (monthStart.getDay() + 6) % 7
  const cells: (Date | null)[] = Array(firstWeekday).fill(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  return cells
}
const miniGrid = computed(() => miniCalendarGrid(miniBase.value))
function selectMiniDate(d: Date) {
  anchorDate.value = d
}
const miniWeekdayAbbrevs = computed(() => [
  t('Mo', 'Lu'),
  t('Tu', 'Ma'),
  t('We', 'Mi'),
  t('Th', 'Ju'),
  t('Fr', 'Vi'),
  t('Sa', 'Sá'),
  t('Su', 'Do'),
])

async function loadReferenceData() {
  const [{ data: types }, { data: members }, { data: ovr }, { data: memberClinics }] = await Promise.all([
    supabase.from('appointment_types').select('id, name, duration_minutes, color, default_price_cents, sort_order, archived_at'),
    supabase.from('team_members').select('id, full_name, color, business_hours').is('deleted_at', null).eq('is_practitioner', true).order('full_name'),
    supabase.from('appointment_type_overrides').select('appointment_type_id, team_member_id, duration_minutes, price_cents'),
    supabase.from('team_member_clinics').select('team_member_id, clinic_id'),
  ])
  appointmentTypes.value = orderTypes(types ?? [])
  // business_hours comes back as Supabase's recursive Json type, which never
  // narrows to BusinessHours on its own -- cast at the read site, same as
  // settings/team/[id].vue and settings/online-booking.vue already do.
  teamMembers.value = (members ?? []) as unknown as TeamMember[]
  overrides.value = ovr ?? []
  teamMemberClinics.value = memberClinics ?? []
}

// Only practitioners (is_practitioner, independent of the account_roles
// permission a person holds -- an Owner can also be a treating
// practitioner) assigned to the clinic currently in view, so a multi-clinic
// account doesn't clutter the tab bar with staff who don't work here.
const clinicTeamMembers = computed(() =>
  teamMembers.value.filter((m) => teamMemberClinics.value.some((tc) => tc.team_member_id === m.id && tc.clinic_id === store.currentClinicId)),
)

// Keeps practitionerFilter pointing at a real, visible tab -- restores the
// last-used practitioner from localStorage when it's still valid for this
// clinic, otherwise falls back to the first tab (e.g. right after switching
// clinics, or on first load).
function ensureValidPractitionerFilter() {
  // The unassigned tab is only offered alongside real practitioner tabs
  // (below), so it counts as valid only while there is a tab bar to leave it
  // from -- otherwise switching to a clinic with no practitioners would strand
  // the calendar on a filter nothing can clear.
  const unassignedSelectable = clinicTeamMembers.value.length > 0
  const pseudo = (v: string) => (v === UNASSIGNED_PRACTITIONER || v === ALL_PRACTITIONERS) && unassignedSelectable
  if (pseudo(practitionerFilter.value)) return
  if (clinicTeamMembers.value.some((m) => m.id === practitionerFilter.value)) return
  const stored = localStorage.getItem(CALENDAR_PRACTITIONER_KEY) ?? ''
  const restorable = pseudo(stored) || clinicTeamMembers.value.some((m) => m.id === stored)
  practitionerFilter.value = (restorable ? stored : '') || (clinicTeamMembers.value[0]?.id ?? '')
}
watch(practitionerFilter, (v) => {
  if (v) localStorage.setItem(CALENDAR_PRACTITIONER_KEY, v)
})

// What the create forms should prefill their Practitioner select with. The
// unassigned tab is a filter, not a team member, so it prefills as no choice
// rather than as an id that matches no option (and no row in team_members).
const prefillPractitionerId = computed(() =>
  practitionerFilter.value === UNASSIGNED_PRACTITIONER || practitionerFilter.value === ALL_PRACTITIONERS ? '' : practitionerFilter.value,
)
/** One real practitioner's tab is open (not "everyone", not "no practitioner"). */
const singlePractitionerId = computed(() => (clinicTeamMembers.value.some((m) => m.id === practitionerFilter.value) ? practitionerFilter.value : null))

// A quick switch between clinics must not leave the first clinic's rooms as
// the columns of the second.
let roomsToken = 0
async function loadRooms() {
  const token = ++roomsToken
  if (!store.currentClinicId) {
    rooms.value = []
    return
  }
  const { data } = await supabase
    .from('calendar_resources')
    .select('id, name')
    .eq('clinic_id', store.currentClinicId)
    .order('name')
  if (token !== roomsToken) return
  rooms.value = data ?? []
}

// `silent` reloads without the skeleton: after a step in the open panel the
// grid should update in place, not blink.
const APPOINTMENT_SELECT =
  'id, patient_id, room_id, practitioner_id, appointment_type_id, starts_at, ends_at, status, checked_in_at, flow_with_practitioner_at, flow_checkout_at, rescheduled, confirmation_status, confirmation_sent_at, reminder_sent_at, same_day_info_sent_at, created_at, deleted_at, note, source, patients(first_name, last_name, sticky_note), appointment_types(name, color, default_price_cents), team_members(full_name, color)'

async function loadAppointments(silent = false) {
  if (!store.currentClinicId) {
    appointments.value = []
    loading.value = false // or "No clinic selected" sits behind the skeleton
    loadToday() // clears today's panels too
    return
  }
  if (!silent) loading.value = true
  const rangeStart = viewMode.value === 'day' ? startOfDay(anchorDate.value) : weekStart.value
  const rangeEnd = viewMode.value === 'day' ? addDays(rangeStart, 1) : addDays(rangeStart, 7)

  const token = ++loadToken
  let query = supabase
    .from('appointments')
    .select(APPOINTMENT_SELECT)
    .eq('clinic_id', store.currentClinicId)
    .gte('starts_at', rangeStart.toISOString())
    .lt('starts_at', rangeEnd.toISOString())
    .order('starts_at')
  if (practitionerFilter.value === UNASSIGNED_PRACTITIONER) query = query.is('practitioner_id', null)
  else if (practitionerFilter.value && practitionerFilter.value !== ALL_PRACTITIONERS) query = query.eq('practitioner_id', practitionerFilter.value)
  const { data } = await query
  if (token !== loadToken) return

  appointments.value = (data as unknown as AppointmentRow[]) ?? []
  const patientIds = [...new Set(appointments.value.map((a) => a.patient_id))]
  const appointmentIds = appointments.value.map((a) => a.id)
  loading.value = false
  // The owing badge and "Sin próxima" are detail on blocks that are already
  // right without them, so the grid no longer waits two more round trips for
  // them. Both are per patient, not per range, so what the last range left
  // behind is still true for anyone in this one until they land.
  Promise.all([loadLiveBalances(token, patientIds), loadFutureAppointmentIds(token, patientIds)]).catch((e) =>
    console.error('calendar: balances / next visits failed', e),
  )
  // Today's panels (glance, flow tracker) describe today whatever range is in
  // view, so paging through weeks does not refetch them -- only a first load,
  // a clinic switch or an edit marks them stale. Started once the grid has
  // drawn, not beside its queries: the grid is what the desk is waiting for,
  // and on a slow connection the extra requests held its skeleton up.
  if (todayStale) {
    todayStale = false
    loadToday()
      .catch((e) => console.error('calendar: today failed', e))
      .finally(() => (todayLoaded.value = true)) // a failure shows zeros, not a placeholder forever
  }
  // Second-rank detail -- the bono count, how often a visit was moved, the
  // waitlist offers standing on freed slots. The grid is usable without them,
  // so they fill in after it renders rather than holding it back for the
  // three sequential rounds fetchVisitPayments needs.
  loadBlockDetails(token, appointmentIds, patientIds, rangeStart, rangeEnd).catch((e) => console.error('calendar: block details failed', e))
  loadMovedAwayMarkers(token, rangeStart, rangeEnd).catch((e) => console.error('calendar: moved-away markers failed', e))
}

// Where a visit used to be. Moving an appointment moves the row itself --
// nothing is left at the old time -- so the slot it held is drawn from
// appointment_reschedules: one faded marker per move out of this range, for
// the visit wherever it is now (often outside the range: moved to tomorrow).
// "Hide rescheduled" hides these markers, and only these; it used to hide
// the moved visits themselves, which made confirmed visits vanish from
// today and completed ones from past days.
const movedAwayMarkers = ref<AppointmentRow[]>([])
async function loadMovedAwayMarkers(token: number, rangeStart: Date, rangeEnd: Date) {
  const { data: moves } = await supabase
    .from('appointment_reschedules')
    .select('id, appointment_id, from_starts_at')
    .eq('account_id', store.accountId!)
    .gte('from_starts_at', rangeStart.toISOString())
    .lt('from_starts_at', rangeEnd.toISOString())
  if (token !== loadToken) return
  const loaded = new Map(appointments.value.map((a) => [a.id, a]))
  const missing = [...new Set((moves ?? []).map((m) => m.appointment_id).filter((id) => !loaded.has(id)))]
  if (missing.length) {
    const rows = await fetchByIds(missing, (chunk) => {
      let q = supabase.from('appointments').select(APPOINTMENT_SELECT).eq('clinic_id', store.currentClinicId!).in('id', chunk)
      if (practitionerFilter.value === UNASSIGNED_PRACTITIONER) q = q.is('practitioner_id', null)
      else if (practitionerFilter.value && practitionerFilter.value !== ALL_PRACTITIONERS) q = q.eq('practitioner_id', practitionerFilter.value)
      return q
    })
    if (token !== loadToken) return
    for (const a of rows as unknown as AppointmentRow[]) loaded.set(a.id, a)
  }
  const markers: AppointmentRow[] = []
  for (const m of moves ?? []) {
    const real = loaded.get(m.appointment_id)
    // Another clinic's visit, or one the practitioner filter leaves out.
    if (!real) continue
    const fromMs = Date.parse(m.from_starts_at)
    // Moved away and later back again: the visit is in that slot itself.
    if (fromMs === Date.parse(real.starts_at)) continue
    const durationMs = Date.parse(real.ends_at) - Date.parse(real.starts_at)
    markers.push({
      ...real,
      id: `moved-${m.id}`,
      starts_at: new Date(fromMs).toISOString(),
      ends_at: new Date(fromMs + durationMs).toISOString(),
      _movedFrom: real,
      _movedTo: real.starts_at,
    })
  }
  movedAwayMarkers.value = markers
}

// Bumped on every load, so a slow response for a range the user has already
// navigated away from cannot land on top of the current one.
let loadToken = 0
// Set by anything that could have changed today's visits; the next grid load
// refreshes today's panels and clears it. Starts set, for the first load.
let todayStale = true
/** After a write: the grid in place, and today's panels, which the write may have touched. */
function reloadAfterChange() {
  todayStale = true
  return loadAppointments(true)
}

const visitPaymentById = ref<Record<string, VisitPayment>>({})
const activePackageByPatient = ref<Record<string, { package_name: string; sessions_total: number; sessions_used: number }>>({})
const movedCountById = ref<Record<string, number>>({})
interface WaitlistOffer {
  id: string
  offered_starts_at: string
  offered_ends_at: string | null
  offered_room_id: string | null
  offered_practitioner_id: string | null
  offer_expires_at: string | null
  patients: { first_name: string; last_name: string | null } | null
}
const waitlistOffers = ref<WaitlistOffer[]>([])

async function loadBlockDetails(token: number, appointmentIds: string[], patientIds: string[], rangeStart: Date, rangeEnd: Date) {
  // Id lists go through fetchByIds: a whole-clinic week is several hundred
  // appointments, and one .in() that long is refused with 414 -- which reads
  // as "nothing found" and quietly blanks every bono and moved count.
  const [payments, packages, reschedules, { data: offers }] = await Promise.all([
    fetchVisitPayments(appointmentIds),
    // Newest first inside each chunk; a chunk holds whole patients, so each
    // patient's packs stay in order.
    fetchByIds(patientIds, (chunk) =>
      supabase.from('package_purchases').select('patient_id, package_name, sessions_total, sessions_used, is_closed').in('patient_id', chunk).order('purchased_at', { ascending: false }),
    ),
    fetchByIds(appointmentIds, (chunk) => supabase.from('appointment_reschedules').select('appointment_id').in('appointment_id', chunk)),
    supabase
      .from('waitlist_entries')
      .select('id, offered_starts_at, offered_ends_at, offered_room_id, offered_practitioner_id, offer_expires_at, patients(first_name, last_name)')
      .eq('clinic_id', store.currentClinicId!)
      .eq('status', 'offered')
      .gte('offered_starts_at', rangeStart.toISOString())
      .lt('offered_starts_at', rangeEnd.toISOString()),
  ])
  if (token !== loadToken) return

  visitPaymentById.value = payments
  // Newest pack with sessions left, per patient -- the one tomorrow's visit
  // will draw from (bonoForVisit). A bono PracticeHub has closed keeps the
  // sessions that were on it and is not one of them.
  const active: typeof activePackageByPatient.value = {}
  for (const p of packages) {
    if (active[p.patient_id] || p.is_closed || p.sessions_used >= p.sessions_total) continue
    active[p.patient_id] = p
  }
  activePackageByPatient.value = active
  const moved: Record<string, number> = {}
  for (const r of reschedules) moved[r.appointment_id] = (moved[r.appointment_id] ?? 0) + 1
  movedCountById.value = moved
  waitlistOffers.value = ((offers as unknown as WaitlistOffer[]) ?? []).filter((o) => o.offered_starts_at)
}

// patient_live_balances.outstanding_cents: what the patient has unpaid. Only
// the owing side is ever drawn on the calendar -- a credit balance is not the
// front desk's problem at a glance, and it lives in the hover card and the
// panel.
//
// Not -balance_cents, which is what this read before. The balance is
// paid-minus-invoiced over the patient's whole history, so a child on a
// parent's bono carried a red badge for visits the parent had paid for: 49
// patients wore one, 10 owed anything. See utils/owing.ts.
const outstandingByPatient = ref<Record<string, number>>({})
function owesCents(patientId: string) {
  return Math.max(0, outstandingByPatient.value[patientId] ?? 0)
}

// --- Today, whatever day the grid is on ---
// "Today at a glance" and the flow tracker describe the real calendar day,
// not the day or week the grid is navigated to, so they load on their own.
// The glance mirrors PracticeHub's widget: "Booked" is every visit that
// belonged to today at some point (including ones since moved to another
// day), and the other four are a breakdown of that same total. The flow
// tracker covers the whole clinic whichever practitioner tab is open: it is
// who is in the building, and the building is shared.
const todayRows = ref<AppointmentRow[]>([])
const todayGlance = ref({ booked: 0, seen: 0, rescheduled: 0, cancelled: 0, missed: 0 })
const todayOwedByPatient = ref<Record<string, number>>({})
// Until the first answer, the glance and the tracker show placeholders, not
// zeros: "0 booked" on a full day reads as a fact.
const todayLoaded = ref(false)
let todayToken = 0
async function loadToday() {
  const clinicId = store.currentClinicId
  if (!clinicId) {
    todayRows.value = []
    todayGlance.value = { booked: 0, seen: 0, rescheduled: 0, cancelled: 0, missed: 0 }
    todayLoaded.value = true
    return
  }
  const token = ++todayToken
  const start = startOfDay(new Date())
  const end = addDays(start, 1)
  const [{ data: rows }, { data: moves }] = await Promise.all([
    supabase.from('appointments').select(APPOINTMENT_SELECT).eq('clinic_id', clinicId).gte('starts_at', start.toISOString()).lt('starts_at', end.toISOString()).order('starts_at'),
    supabase
      .from('appointment_reschedules')
      .select('appointment_id, to_starts_at')
      .eq('account_id', store.accountId!)
      .gte('from_starts_at', start.toISOString())
      .lt('from_starts_at', end.toISOString()),
  ])
  if (token !== todayToken) return
  // A deleted visit never happened; it is neither booked nor anyone's flow.
  const live = ((rows as unknown as AppointmentRow[]) ?? []).filter((a) => !a.deleted_at)
  const liveIds = new Set(live.map((a) => a.id))
  const movedAway = new Set(
    (moves ?? [])
      .filter((m) => (m.to_starts_at < start.toISOString() || m.to_starts_at >= end.toISOString()) && !liveIds.has(m.appointment_id))
      .map((m) => m.appointment_id),
  )
  todayGlance.value = {
    booked: live.length + movedAway.size,
    seen: live.filter((a) => a.status === 'completed').length,
    rescheduled: movedAway.size,
    cancelled: live.filter((a) => a.status === 'cancelled').length,
    missed: live.filter((a) => a.status === 'no_show').length,
  }
  todayRows.value = live
  todayLoaded.value = true

  // What each patient waiting to pay owes, for the tracker's "debe X €".
  const paying = [...new Set(live.filter((a) => stageOf(a) === 'checkout').map((a) => a.patient_id))]
  if (paying.length === 0) {
    todayOwedByPatient.value = {}
    return
  }
  const balances = await fetchByIds(paying, (chunk) => supabase.from('patient_live_balances').select('patient_id, outstanding_cents').in('patient_id', chunk))
  if (token !== todayToken) return
  const owed: Record<string, number> = {}
  for (const b of balances) owed[b.patient_id!] = Math.max(0, b.outstanding_cents ?? 0)
  todayOwedByPatient.value = owed
}
/** "32 %": whole numbers, es-ES spacing, of the day's Booked total. */
function glancePct(count: number) {
  const booked = todayGlance.value.booked
  return `${booked > 0 ? Math.round((count / booked) * 100) : 0}\u00a0%`
}
const glanceRows = computed(() => [
  { key: 'booked', label: t('Booked', 'Reservadas'), value: String(todayGlance.value.booked), tone: 'text-ink-900' },
  { key: 'seen', label: t('Seen', 'Atendidas'), value: `${todayGlance.value.seen} (${glancePct(todayGlance.value.seen)})`, tone: 'text-success-text' },
  { key: 'rescheduled', label: t('Rescheduled', 'Reprogramadas'), value: `${todayGlance.value.rescheduled} (${glancePct(todayGlance.value.rescheduled)})`, tone: 'text-warning-text' },
  { key: 'cancelled', label: t('Cancelled', 'Canceladas'), value: `${todayGlance.value.cancelled} (${glancePct(todayGlance.value.cancelled)})`, tone: 'text-danger-text' },
  { key: 'missed', label: t('Missed', 'Perdidas'), value: `${todayGlance.value.missed} (${glancePct(todayGlance.value.missed)})`, tone: 'text-ink-muted2' },
])

const flowRows = computed<FlowRow[]>(() =>
  todayRows.value
    .map((a) => ({ a, stage: stageOf(a) }))
    .filter(({ stage }) => stage === 'arrived' || stage === 'withp' || stage === 'checkout')
    .map(({ a, stage }) => {
      const name = `${a.patients?.first_name ?? ''} ${a.patients?.last_name ?? ''}`.trim()
      let sub = ''
      if (stage === 'arrived') {
        const arrived = formatTime(a.checked_in_at!)
        const booked = formatTime(a.starts_at)
        sub = t(`arrived ${arrived} · booked ${booked}`, `llegó ${arrived} · cita ${booked}`)
      } else if (stage === 'withp') {
        const since = formatTime(a.flow_with_practitioner_at!)
        const who = firstName(a.team_members?.full_name)
        sub = `${t(`since ${since}`, `desde ${since}`)}${who ? ` · ${who}` : ''}`
      } else {
        const owed = todayOwedByPatient.value[a.patient_id] ?? 0
        const since = formatTime(a.flow_checkout_at!)
        sub = owed > 0 ? t(`owes ${formatEur(owed)}`, `debe ${formatEur(owed)}`) : t(`since ${since}`, `desde ${since}`)
      }
      return { id: a.id, name, stage, sub }
    }),
)

function findVisit(id: string) {
  return appointments.value.find((a) => a.id === id) ?? todayRows.value.find((a) => a.id === id) ?? null
}
function openFromFlow(id: string, tab: 'summary' | 'billing' = 'summary') {
  const appt = findVisit(id)
  if (appt) openEditModal(appt, tab)
}
// The tracker's one step forward, the same writes the appointment panel's
// primary button makes. From "Por cobrar" the next thing is taking the
// money, so that opens the panel on Cobro instead of writing anything.
const flowBusy = ref(false)
async function advanceFromFlow(id: string) {
  const appt = findVisit(id)
  if (!appt || flowBusy.value) return
  const stage = stageOf(appt)
  if (stage === 'checkout') {
    openEditModal(appt, 'billing')
    return
  }
  const at = new Date().toISOString()
  const values = stage === 'arrived' ? { flow_with_practitioner_at: at } : stage === 'withp' ? { flow_checkout_at: at } : null
  if (!values) return
  flowBusy.value = true
  const { error } = await supabase.from('appointments').update(values).eq('id', id)
  flowBusy.value = false
  if (error) {
    console.error('calendar: flow step failed', error)
    return
  }
  await reloadAfterChange()
}
async function loadLiveBalances(token: number, patientIds: string[]) {
  if (patientIds.length === 0) {
    outstandingByPatient.value = {}
    return
  }
  const data = await fetchByIds(patientIds, (chunk) => supabase.from('patient_live_balances').select('patient_id, outstanding_cents').in('patient_id', chunk))
  if (token !== loadToken) return
  const map: Record<string, number> = {}
  for (const b of data) map[b.patient_id!] = b.outstanding_cents ?? 0
  outstandingByPatient.value = map
}

// Which of today's/this-view's appointments' patients have some OTHER
// upcoming appointment already on the books -- drives the calendar-with-X
// icon on a block ("no future appointment") so staff can spot who needs a
// follow-up booked without opening each patient.
const futureAppointmentIdsByPatient = ref<Record<string, Set<string>>>({})
// Who the map above has been asked about. The grid now draws before it
// answers, and absence from the map reads as "nothing booked" -- without
// this every block would wear "Sin próxima" until the answer landed.
const futureCheckedPatients = ref<Set<string>>(new Set())
async function loadFutureAppointmentIds(token: number, patientIds: string[]) {
  if (patientIds.length === 0) {
    futureAppointmentIdsByPatient.value = {}
    futureCheckedPatients.value = new Set()
    return
  }
  const data = await fetchByIds(patientIds, (chunk) =>
    // Not one the clinic deleted: deleting leaves the row, still 'booked'.
    supabase.from('appointments').select('id, patient_id').in('patient_id', chunk).neq('status', 'cancelled').is('deleted_at', null).gt('starts_at', new Date().toISOString()),
  )
  if (token !== loadToken) return
  const map: Record<string, Set<string>> = {}
  for (const a of data) {
    ;(map[a.patient_id] ??= new Set()).add(a.id)
  }
  futureAppointmentIdsByPatient.value = map
  futureCheckedPatients.value = new Set(patientIds)
}
function hasFutureAppointment(appt: AppointmentRow) {
  if (!futureCheckedPatients.value.has(appt.patient_id)) return true // not known yet, so not flagged
  const ids = futureAppointmentIdsByPatient.value[appt.patient_id]
  if (!ids) return false
  return ids.size > 1 || !ids.has(appt.id)
}


// Its own counter, not loadToken: blocks reload alone after a block is
// saved, and that must not void an appointments load still in flight.
let blocksToken = 0
async function loadAvailabilityBlocks() {
  const token = ++blocksToken
  if (!store.currentClinicId) {
    availabilityBlocks.value = []
    return
  }
  const rangeStart = viewMode.value === 'day' ? startOfDay(anchorDate.value) : weekStart.value
  const rangeEnd = viewMode.value === 'day' ? addDays(rangeStart, 1) : addDays(rangeStart, 7)

  const { data } = await supabase
    .from('availability_blocks')
    .select('id, room_id, practitioner_id, starts_at, ends_at, note')
    .eq('clinic_id', store.currentClinicId)
    .lt('starts_at', rangeEnd.toISOString())
    .gt('ends_at', rangeStart.toISOString())
    .order('starts_at')
  if (token !== blocksToken) return
  availabilityBlocks.value = data ?? []
}

// The range in view: appointments and blocks side by side, not one after the
// other -- neither needs anything from the other.
function loadRange() {
  return Promise.all([loadAppointments(), loadAvailabilityBlocks().catch((e) => console.error('calendar: availability failed', e))])
}

// First paint used to be five round trips in a row (types/team -> rooms ->
// appointments -> balances -> blocks), and on the way the range was fetched
// two or three times over: restoring the saved view and then the saved
// practitioner each tripped the watcher below, the first time with no
// practitioner at all -- the whole clinic's week, thrown away.
//
// Now the page settles its view and practitioner before anything watches
// them, and asks for the range at the same time as the reference data
// whenever the practitioner it will show is already known (the one used last
// time). If the reference data then says that tab is gone, the filter moves
// and the watcher reloads; loadToken drops the stale answer.
const referenceLoaded = ref(false)
let mounted = false
onMounted(async () => {
  const clinicAtStart = store.currentClinicId
  const stored = localStorage.getItem(CALENDAR_PRACTITIONER_KEY)
  if (stored) practitionerFilter.value = stored
  const reference = Promise.all([loadReferenceData(), loadRooms()])
  const early = stored ? rangeKey() : null
  if (early) loadRange()
  await reference.catch((e) => console.error('calendar: reference data failed', e))
  referenceLoaded.value = true
  ensureValidPractitionerFilter()
  // The watchers below only start listening now, so the filter settling
  // above is not a second load.
  await nextTick()
  mounted = true
  // Anything that moved meanwhile -- the tab, or a click on Next while the
  // team was still loading -- means the early answer is for the wrong range.
  if (store.currentClinicId !== clinicAtStart) await onClinicChanged()
  else if (rangeKey() !== early) await loadRange()
})
function rangeKey() {
  return `${viewMode.value}|${toDateKey(anchorDate.value)}|${practitionerFilter.value}`
}
async function onClinicChanged() {
  todayStale = true
  // Rooms are only the day view's columns; the practitioner tabs come from
  // the team already loaded, so the range need not wait for them.
  const roomsLoaded = loadRooms().catch((e) => console.error('calendar: rooms failed', e))
  const before = practitionerFilter.value
  ensureValidPractitionerFilter()
  // A changed filter reloads through the watcher below.
  await Promise.all([roomsLoaded, practitionerFilter.value === before ? loadRange() : null])
}
watch(() => store.currentClinicId, () => {
  if (mounted) onClinicChanged()
})
watch([viewMode, anchorDate, practitionerFilter], () => {
  if (!mounted) return
  loadRange()
})

const dayColumns = computed(() => [...rooms.value, { id: '__none', name: t('Unassigned', 'Sin asignar') }])

function blockLabel(block: AvailabilityBlock) {
  if (block.note) return block.note
  const who = block.practitioner_id ? teamMembers.value.find((m) => m.id === block.practitioner_id)?.full_name : null
  if (who) return t(`Blocked for ${who}`, `Bloqueado para ${who}`)
  return block.room_id === null ? t('Blocked (whole clinic)', 'Bloqueado (toda la clínica)') : t('Blocked', 'Bloqueado')
}

function blocksForRoom(roomId: string) {
  if (!settings.showAvailability) return []
  return availabilityBlocks.value.filter((b) => (b.room_id === roomId || b.room_id === null) && blockAppliesToFilter(b))
}
// A practitioner's own block shows on their tab and on the whole-clinic one,
// where its label ("Bloqueado para Marta") says whose it is.
function blockAppliesToFilter(b: AvailabilityBlock) {
  return b.practitioner_id === null || b.practitioner_id === practitionerFilter.value || practitionerFilter.value === ALL_PRACTITIONERS
}
function openBlockCreateModal(roomId?: string) {
  blockPrefill.value = { date: toDateKey(anchorDate.value), time: '09:00', roomId: roomId ?? '' }
  editingBlock.value = null
  blockModalOpen.value = true
}
function openBlockEditModal(block: AvailabilityBlock) {
  editingBlock.value = block
  blockModalOpen.value = true
}
async function onBlockSaved() {
  blockModalOpen.value = false
  await loadAvailabilityBlocks()
}

function isApptVisible(appt: AppointmentRow) {
  if (appt.status === 'cancelled' && !settings.showCancelled) return false
  // A moved visit is a real visit wherever it now sits, so it always shows.
  // What "Hide rescheduled" hides is the marker left at its old slot.
  if (appt._movedFrom) {
    if (settings.hideRescheduled) return false
    return isApptVisible(appt._movedFrom)
  }
  if (appt.deleted_at && settings.hideDeleted) return false
  return true
}

// The loaded range grouped by calendar day, once per change to it. Every
// column, day header and count used to filter the whole list for itself, on
// every render -- and the grid renders on every slot the pointer crosses, so
// a whole-clinic week re-parsed each start time thousands of times a second.
const appointmentsByDay = computed(() => {
  const byDay = new Map<string, AppointmentRow[]>()
  for (const a of appointments.value) {
    const key = toDateKey(new Date(a.starts_at))
    const rows = byDay.get(key)
    if (rows) rows.push(a)
    else byDay.set(key, [a])
  }
  return byDay
})

// Best-effort practitioner line under a room's column header (the app has
// no fixed room->practitioner assignment, so this reflects whoever's
// actually booked in that room today).
function roomPractitionerLabel(roomId: string) {
  const match = appointments.value.find((a) => (a.room_id ?? '__none') === roomId && a.team_members?.full_name)
  return match?.team_members?.full_name ?? ''
}

function timeToPx(iso: string, hourPx: number) {
  const d = new Date(iso)
  const mins = d.getHours() * 60 + d.getMinutes() - START_HOUR * 60
  return Math.max(0, (mins / 60) * hourPx)
}
function durationToPx(startIso: string, endIso: string, hourPx: number, minFloor: number) {
  const mins = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000
  return Math.max(minFloor, (mins / 60) * hourPx)
}

const dayGridHeight = computed(() => (END_HOUR - START_HOUR) * DAY_HOUR_PX.value)
const weekGridHeight = computed(() => (END_HOUR - START_HOUR) * WEEK_HOUR_PX.value)
const hourMarks = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)
function hourLabel(h: number) {
  return `${pad(h)}:00`
}
// m is minutes elapsed since START_HOUR (matches slotMarks below).
function slotLabel(m: number) {
  const total = START_HOUR * 60 + m
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

// Sub-hour gridlines at the clinic's own slot size (commonly 15 or 30min),
// drawn lighter than the hour lines so the grid reads as one visual scale
// like PracticeHub's, rather than only marking full hours.
const slotMarks = computed(() => {
  const marks: number[] = []
  for (let m = SLOT_MIN.value; m < TOTAL_MIN; m += SLOT_MIN.value) {
    if (m % 60 !== 0) marks.push(m)
  }
  return marks
})

// Which hours are hatched as "nobody working".
//
// On one practitioner's tab that is their own schedule (Settings -> Team),
// with the clinic's hours standing in only for someone who never set any. On
// the whole-clinic and no-practitioner tabs it is the union of everyone
// assigned here: an hour is only closed if NO ONE works it. null means
// "unrestricted" -- nobody configured anything that could close an hour --
// and then nothing is hatched, same opt-in rule as before.
function workingWindowsFor(date: Date): [string, string][] | null {
  const clinicHours = store.currentClinic?.business_hours as BusinessHours | null | undefined
  const pid = singlePractitionerId.value
  if (pid) {
    const hours = clinicTeamMembers.value.find((m) => m.id === pid)?.business_hours ?? null
    if (!hasBusinessHoursConfigured(clinicHours) && !hasBusinessHoursConfigured(hours)) return null
    return practitionerWindowsForDay(windowsForDay(date, clinicHours), hours, dayKeyFor(date))
  }
  return unionWorkingWindows(date, clinicHours, clinicTeamMembers.value.map((m) => m.business_hours))
}

function isWorkingTime(date: Date): boolean {
  const windows = workingWindowsFor(date)
  return windows === null || withinWindows(date.getHours() * 60 + date.getMinutes(), windows)
}
// Whether a time is outside the hours of the practitioner an appointment
// actually belongs to.
//
// isWorkingTime above answers what the GRID should hatch, and on anything but
// a single practitioner's tab that is the union of everyone working -- an
// hour is only closed when nobody works it. Right for shading, wrong for a
// move: it says Wednesday 09:30 is open because Natacha works it, while the
// appointment being dropped there belongs to Jordana, who does not. Lauren
// McCoy was reassigned to Jordana and then moved twice inside her Wednesday
// morning, and neither step said anything.
//
// teamMembers rather than clinicTeamMembers: a practitioner not assigned to
// the clinic being viewed would otherwise fall back to the clinic's hours,
// which is the same silent pass this is fixing.
function apptOutsideWorkingHours(at: Date, practitionerId: string | null): boolean {
  return outsideWorkingHours(
    at,
    store.currentClinic?.business_hours as BusinessHours | null | undefined,
    (teamMembers.value.find((m) => m.id === practitionerId)?.business_hours ?? null) as BusinessHours | null,
  )
}

// Closed stretches of one day as merged rects, so a closed morning is one
// hatched band carrying one "Fuera de horario" label rather than a stack of
// slot-sized stripes. Worked out at the clinic's slot size, so a lunch break
// ending at :30 still hatches correctly.
function closedSlotRects(forDate: Date, hourPx: number) {
  const windows = workingWindowsFor(forDate)
  if (windows === null) return []
  const slotPx = (SLOT_MIN.value / 60) * hourPx
  const rects: { top: number; height: number }[] = []
  for (let m = 0; m < TOTAL_MIN; m += SLOT_MIN.value) {
    if (withinWindows(START_HOUR * 60 + m, windows)) continue
    const top = (m / 60) * hourPx
    const last = rects[rects.length - 1]
    if (last && Math.abs(last.top + last.height - top) < 0.5) last.height += slotPx
    else rects.push({ top, height: slotPx })
  }
  return rects
}
// Per day on screen, at the current view's scale -- every room column of a
// day shares its day's rects, so they are worked out once, not per column.
const closedRectsByDay = computed(() => {
  const hourPx = viewMode.value === 'day' ? DAY_HOUR_PX.value : WEEK_HOUR_PX.value
  const days = viewMode.value === 'day' ? [anchorDate.value] : visibleWeekDays.value
  return new Map(days.map((d) => [toDateKey(d), closedSlotRects(d, hourPx)]))
})
function closedRectsFor(day: Date) {
  return closedRectsByDay.value.get(toDateKey(day)) ?? []
}

// Placeholder visits while a range loads: a few per column at fixed, varied
// times, so the skeleton reads as a diary rather than as stripes. Hours
// nobody works stay hatched and empty, as they will be once it loads.
const SKELETON_BLOCKS: [number, number][][] = [
  [[1, 1], [2.5, 0.5], [4, 1], [6.5, 1.5]],
  [[0.5, 1], [3, 1], [5.5, 0.5], [8, 1]],
  [[2, 1.5], [4.5, 1], [7.5, 0.5], [9, 1]],
  [[1.5, 0.5], [3.5, 1.5], [7, 1]],
]
function skeletonBlocks(index: number, hourPx: number, day?: Date) {
  const closed = day ? closedRectsFor(day) : []
  return SKELETON_BLOCKS[index % SKELETON_BLOCKS.length]
    .map(([at, hours]) => ({ top: at * hourPx + 1, height: hours * hourPx - 3 }))
    .filter((b) => !closed.some((r) => b.top < r.top + r.height && b.top + b.height > r.top))
}
// Before the rooms are known: three columns for a day, one per day for a week.
const skeletonColumns = computed<(Date | null)[]>(() => (viewMode.value === 'day' ? [null, null, null] : visibleWeekDays.value))
// The unassigned column is usually empty; placeholders there would promise
// visits that are not coming. Unless it is the only column there is.
function skeletonInColumn(roomId: string) {
  return roomId !== '__none' || rooms.value.length === 0
}

// --- Stage, block, counts ---
// One stage per appointment, from utils/appointmentStage -- the block, the
// counts row and the day headers all read it from there.
function stageOf(appt: AppointmentRow): AppointmentStage {
  return appointmentStage(appt)
}

function firstName(full: string | null | undefined) {
  return (full ?? '').trim().split(/\s+/)[0] || null
}

// Built once per appointment per change, not on every render: a fresh object
// each time re-rendered every block on the grid whenever anything on the
// page moved -- the pointer crossing a slot was enough.
const blockViewById = computed(() => {
  const views = new Map<string, BlockView>()
  for (const a of appointments.value) views.set(a.id, buildBlockView(a))
  return views
})
function blockView(appt: AppointmentRow): BlockView {
  // Today's rows (the flow tracker's) can be outside the range on screen.
  return blockViewById.value.get(appt.id) ?? buildBlockView(appt)
}
function buildBlockView(appt: AppointmentRow): BlockView {
  const stage = stageOf(appt)
  const payment = visitPaymentById.value[appt.id] ?? { kind: 'none' as const }
  return {
    id: appt.id,
    name: `${appt.patients?.first_name ?? ''} ${appt.patients?.last_name ?? ''}`.trim(),
    shortName: shortPatientName(appt.patients?.first_name, appt.patients?.last_name),
    stage,
    arrivedAt: appt.checked_in_at ? formatTime(appt.checked_in_at) : null,
    timeLabel: formatTime(appt.starts_at),
    typeName: appt.appointment_types?.name ?? null,
    typeColor: appt.appointment_types?.color ?? null,
    practitionerName: firstName(appt.team_members?.full_name),
    owesCents: owesCents(appt.patient_id),
    bono: bonoForVisit(payment, activePackageByPatient.value[appt.patient_id]),
    hasNote: !!appt.patients?.sticky_note?.trim(),
    movedCount: movedCountById.value[appt.id] ?? 0,
    noNext: needsNextBookingFlag(stage, appt.starts_at, hasFutureAppointment(appt), now.value),
  }
}

// The counts row's toggle. One at a time: it answers "show me who is X", and
// everything else dims rather than disappears, so the day keeps its shape.
const stageFilter = ref<StageFilter | null>(null)
function isDimmed(appt: AppointmentRow) {
  return !!stageFilter.value && !matchesFilter(stageFilter.value, stageOf(appt), owesCents(appt.patient_id))
}
function toggleStageFilter(f: StageFilter) {
  stageFilter.value = stageFilter.value === f ? null : f
}

function countsFor(rows: AppointmentRow[]) {
  return stageCounts(rows.filter((a) => !a.deleted_at).map((a) => ({ stage: stageOf(a), patientId: a.patient_id, owesCents: owesCents(a.patient_id) })))
}
// The row above the grid covers what the grid shows: the day in Day view,
// the visible days otherwise.
const rangeCounts = computed(() => {
  const days = viewMode.value === 'day' ? [anchorDate.value] : visibleWeekDays.value
  return countsFor(days.flatMap((d) => appointmentsByDay.value.get(toDateKey(d)) ?? []))
})
const { stageLabel, filterLabel } = useStageLabels()
const countChips = computed(() =>
  STAGE_FILTERS.map((f) => ({
    key: f,
    n: rangeCounts.value.counts[f],
    label: f === 'owes' ? `${filterLabel(f)} · ${formatEur(rangeCounts.value.owedCents)}` : filterLabel(f),
  })).filter((c) => c.n > 0 || stageFilter.value === c.key),
)
/** The words after the bold total: "citas hoy". */
const countsNoun = computed(() => {
  const one = rangeCounts.value.total === 1
  const today = viewMode.value === 'day' && isSameDate(anchorDate.value, new Date())
  const noun = t(one ? 'appointment' : 'appointments', one ? 'cita' : 'citas')
  return today ? `${noun} ${t('today', 'hoy')}` : noun
})
const dayHeaderCountsByDay = computed(() => {
  const byDay = new Map<string, { unconfirmed: number; owe: number }>()
  for (const [key, rows] of appointmentsByDay.value) {
    const c = countsFor(rows).counts
    byDay.set(key, { unconfirmed: c.pending, owe: c.owes })
  }
  return byDay
})
function dayHeaderCounts(day: Date) {
  return dayHeaderCountsByDay.value.get(toDateKey(day)) ?? { unconfirmed: 0, owe: 0 }
}

// Stage key for the side panel: one row per stage, drawn with the same pill
// the blocks use.
const STAGE_KEY: AppointmentStage[] = ['pending', 'online', 'resched', 'confirmed', 'arrived', 'withp', 'checkout', 'completed', 'noshow']

// Equal-width column positioning for an overlapping block: each lane gets
// an even fraction of the column's width (_totalCols-wide), at its natural
// time-based top/height -- unlike a cascade, lanes never overlap each
// other, so there's no need to crop height or stack z-index to keep a
// block from hiding the one behind it.
function columnStyle(block: LayoutBlock, top: number, height: number) {
  const totalCols = Math.max(block._totalCols, 1)
  const widthPct = 100 / totalCols
  return {
    left: `calc(${block._col * widthPct}% + 2px)`,
    width: `calc(${widthPct}% - 4px)`,
    top: `${top}px`,
    height: `${height}px`,
    zIndex: '10',
  }
}

function openCreateModal() {
  openCreateAt(anchorDate.value, '09:00', null)
}
function openCreateModalForDay(day: Date) {
  if (reschedulingAppointment.value) {
    pickRescheduleSlot(day, '09:00', null)
    return
  }
  openCreateAt(day, '09:00', null)
}

interface LaidOutAppointment extends AppointmentRow {
  _col: number
  _totalCols: number
}
interface OverflowBlock {
  _overflow: true
  _col: number
  _totalCols: number
  starts_at: string
  count: number
}
type LayoutBlock = LaidOutAppointment | OverflowBlock

function isOverflowBlock(b: LayoutBlock): b is OverflowBlock {
  return (b as OverflowBlock)._overflow === true
}

// Assigns each appointment in a pre-sorted (by start time) list a lane via
// a greedy sweep (grouped into clusters of transitively overlapping
// appointments). The lane index (_col) and cluster size (_totalCols) drive
// an equal-width column split in the template, so every appointment in a
// cluster stays fully visible instead of any of them being hidden behind
// another. Past maxLanes, the remaining appointments in that cluster
// collapse into a single "+N more" marker in the last lane.
//
// "Overlapping" is judged by each block's RENDERED end, not its real
// ends_at: durationToPx enforces a minimum block height so short
// appointments stay readable, which means a block can visually extend past
// its real end time. Two back-to-back 15min appointments booked tighter
// than that minimum would otherwise both get "no conflict, full width" from
// this function while visually overlapping on screen the moment they
// render -- effMs converts that same minFloorPx into minutes so the
// clustering sees exactly the collision the render will actually produce.
function assignOverlapLayout(sorted: AppointmentRow[], maxLanes: number, hourPx: number, minFloorPx: number): LayoutBlock[] {
  const minDurationMs = (minFloorPx / hourPx) * 3600000
  const effEndMs = (appt: AppointmentRow) => {
    const start = new Date(appt.starts_at).getTime()
    const end = new Date(appt.ends_at).getTime()
    return Math.max(end, start + minDurationMs)
  }

  const result: LayoutBlock[] = []
  let cluster: LaidOutAppointment[] = []
  let clusterEnd = -Infinity

  // The lanes are written onto the raw rows: this runs inside a computed
  // (layoutByColumn), and writing through the reactive proxy would tell
  // everything reading a block to update again. The computed returning a new
  // layout is what re-renders the blocks.
  function flush() {
    if (cluster.length === 0) return
    const colEnds: number[] = []
    const lanes: number[] = []
    for (const appt of cluster) {
      const start = new Date(appt.starts_at).getTime()
      let col = colEnds.findIndex((end) => end <= start)
      if (col === -1) {
        col = colEnds.length
        colEnds.push(0)
      }
      colEnds[col] = effEndMs(appt)
      lanes.push(col)
      toRaw(appt)._col = col
    }
    const totalCols = colEnds.length
    if (totalCols <= maxLanes) {
      for (const appt of cluster) toRaw(appt)._totalCols = totalCols
      result.push(...cluster)
    } else {
      const visible = cluster.filter((_, i) => lanes[i] < maxLanes - 1)
      const hidden = cluster.filter((_, i) => lanes[i] >= maxLanes - 1)
      for (const a of visible) toRaw(a)._totalCols = maxLanes
      result.push(...visible)
      result.push({
        _overflow: true,
        _col: maxLanes - 1,
        _totalCols: maxLanes,
        starts_at: hidden.reduce((min, a) => (a.starts_at < min ? a.starts_at : min), hidden[0].starts_at),
        count: hidden.length,
      })
    }
    cluster = []
    clusterEnd = -Infinity
  }

  for (const appt of sorted as LaidOutAppointment[]) {
    const start = new Date(appt.starts_at).getTime()
    if (cluster.length > 0 && start >= clusterEnd) flush()
    cluster.push(appt)
    clusterEnd = Math.max(clusterEnd, effEndMs(appt))
  }
  flush()
  return result
}

// Every column's blocks, laid out once per change to what is on screen.
// Day view splits columns by room, but two appointments can still be
// double-booked (or just overlap) in the same room -- without the lanes,
// they'd all render at full column width and stack on top of each other.
//
// Week view mirrors Day view's room columns (one sub-column per room, per
// day) instead of cramming every room's appointments into a single day
// column -- that's what was forcing 3-4 way lane splits and truncating
// patient names down to a few characters even when nothing was genuinely
// double-booked.
function columnKey(dayKey: string, roomId: string) {
  return `${dayKey}|${roomId}`
}
const layoutByColumn = computed(() => {
  const day = viewMode.value === 'day'
  const columns = new Map<string, AppointmentRow[]>()
  const place = (dayKey: string, a: AppointmentRow) => {
    if (!isApptVisible(a)) return
    const key = columnKey(dayKey, a.room_id ?? '__none')
    const col = columns.get(key)
    if (col) col.push(a)
    else columns.set(key, [a])
  }
  for (const [dayKey, rows] of appointmentsByDay.value) {
    for (const a of rows) place(dayKey, a)
  }
  // Laid out with the visits rather than under them, so a marker and the
  // visit booked into the freed slot sit side by side instead of one
  // covering the other. Counts, today's glance and conflict checks read
  // appointmentsByDay, which the markers never enter.
  for (const m of movedAwayMarkers.value) place(toDateKey(new Date(m.starts_at)), m)
  const layouts = new Map<string, LayoutBlock[]>()
  for (const [key, rows] of columns) {
    rows.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    layouts.set(
      key,
      day
        ? assignOverlapLayout(rows, DAY_MAX_LANES, DAY_HOUR_PX.value, DAY_MIN_BLOCK_PX)
        : assignOverlapLayout(rows, WEEK_MAX_LANES, WEEK_HOUR_PX.value, WEEK_MIN_BLOCK_PX),
    )
  }
  return layouts
})
function layoutForRoomOnDay(day: Date, roomId: string): LayoutBlock[] {
  return layoutByColumn.value.get(columnKey(toDateKey(day), roomId)) ?? []
}
function blocksForRoomOnDay(day: Date, roomId: string) {
  if (!settings.showAvailability) return []
  const dayStart = startOfDay(day).getTime()
  const dayEnd = addDays(startOfDay(day), 1).getTime()
  return availabilityBlocks.value.filter(
    (b) =>
      (b.room_id === roomId || b.room_id === null) &&
      blockAppliesToFilter(b) &&
      new Date(b.starts_at).getTime() < dayEnd &&
      new Date(b.ends_at).getTime() > dayStart,
  )
}
function showOverflowDay(day: Date) {
  anchorDate.value = day
  viewMode.value = 'day'
}
function openEditModal(appointment: AppointmentRow, tab: 'summary' | 'billing' = 'summary') {
  closeHoverCardNow()
  panelInitialTab.value = tab
  editingAppointment.value = appointment
  modalMode.value = 'edit'
  modalOpen.value = true
}
async function onSaved() {
  modalOpen.value = false
  await reloadAfterChange()
}
async function onCreated() {
  if (bookingFor.value) stopBookingFor()
  await onSaved()
}

// --- Drag-to-move / drag-to-resize ---
// Mutates the real appointment object in `appointments.value` live during
// the drag rather than tracking a separate shadow position -- the existing
// per-column layout functions (blocksForRoom/layoutForRoom/
// layoutForRoomOnDay, timeToPx/durationToPx/columnStyle) already key off
// an appointment's own starts_at/ends_at/room_id, so this gets a fully
// WYSIWYG live preview (including realistic overlap-column behavior) for
// free instead of a separate rendering path just for the dragged block.
interface DragState {
  apptId: string
  mode: 'move' | 'resize'
  pointerId: number
  startClientX: number
  startClientY: number
  origStartsAt: string
  origEndsAt: string
  origRoomId: string | null
}
const dragState = ref<DragState | null>(null)
// Distinguishes "dragged" from "clicked" -- a pointerdown/pointerup pair
// with no meaningful movement in between should still open the edit modal
// like before, but the browser's own synthesized click after a real drag
// must NOT reopen it. Reset by the click handler itself once consumed.
const dragMoved = ref(false)
let dragColumnRects: { roomId: string | null; dayKey: string; rect: DOMRect }[] = []

function hourPxForView() {
  return viewMode.value === 'day' ? DAY_HOUR_PX.value : WEEK_HOUR_PX.value
}
// Inverse of timeToPx, but returns a raw (signed, snapped) minute delta for
// drag math instead of an absolute "HH:MM" -- snapMin always measures from
// the grid's top and can't represent a negative offset.
function pxToMinutesSinceStart(px: number, hourPx: number) {
  const totalMin = (px / hourPx) * 60
  return Math.round(totalMin / SLOT_MIN.value) * SLOT_MIN.value
}
function captureColumnRects() {
  dragColumnRects = Array.from(document.querySelectorAll<HTMLElement>('[data-cal-col]')).map((el) => ({
    roomId: !el.dataset.roomId || el.dataset.roomId === '__none' ? null : el.dataset.roomId,
    dayKey: el.dataset.dayKey || toDateKey(anchorDate.value),
    rect: el.getBoundingClientRect(),
  }))
}
function columnAtPoint(x: number, y: number) {
  return dragColumnRects.find((c) => x >= c.rect.left && x <= c.rect.right && y >= c.rect.top && y <= c.rect.bottom)
}

function startAppointmentDrag(appt: AppointmentRow, mode: 'move' | 'resize', e: PointerEvent) {
  if (appt.status !== 'booked' || readOnly.value) return
  // A slot click while reschedule-mode is active (see startReschedule below)
  // is what moves the appointment now -- starting an unrelated drag on some
  // other block mid-pick would just be confusing.
  if (reschedulingAppointment.value) return
  e.stopPropagation()
  dragState.value = {
    apptId: appt.id,
    mode,
    pointerId: e.pointerId,
    startClientX: e.clientX,
    startClientY: e.clientY,
    origStartsAt: appt.starts_at,
    origEndsAt: appt.ends_at,
    origRoomId: appt.room_id,
  }
  dragMoved.value = false
  captureColumnRects()
  window.addEventListener('pointermove', onAppointmentDragMove)
  window.addEventListener('pointerup', onAppointmentDragEnd)
}

function onAppointmentDragMove(e: PointerEvent) {
  const s = dragState.value
  if (!s || e.pointerId !== s.pointerId) return
  const dx = e.clientX - s.startClientX
  const dy = e.clientY - s.startClientY
  if (!dragMoved.value) {
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return
    dragMoved.value = true
    closeHoverCardNow()
  }
  const appt = appointments.value.find((a) => a.id === s.apptId)
  if (!appt) return
  const deltaMin = pxToMinutesSinceStart(dy, hourPxForView())

  if (s.mode === 'resize') {
    const newEnd = new Date(new Date(s.origEndsAt).getTime() + deltaMin * 60000)
    const minEnd = new Date(new Date(s.origStartsAt).getTime() + SLOT_MIN.value * 60000)
    appt.ends_at = (newEnd < minEnd ? minEnd : newEnd).toISOString()
  } else {
    const newStart = new Date(new Date(s.origStartsAt).getTime() + deltaMin * 60000)
    const durationMs = new Date(s.origEndsAt).getTime() - new Date(s.origStartsAt).getTime()
    const col = columnAtPoint(e.clientX, e.clientY)
    let finalStart = newStart
    if (col) {
      appt.room_id = col.roomId
      const [y, m, d] = col.dayKey.split('-').map(Number)
      finalStart = new Date(y, m - 1, d, newStart.getHours(), newStart.getMinutes(), 0, 0)
    }
    appt.starts_at = finalStart.toISOString()
    appt.ends_at = new Date(finalStart.getTime() + durationMs).toISOString()
  }
}

interface PendingReschedule {
  appointmentId: string
  patientId: string
  patientName: string
  appointmentTypeName: string | null
  origStartsAt: string
  newStartsAt: string
  newEndsAt: string
  newRoomId: string | null
  revert: () => void
}
const pendingReschedule = ref<PendingReschedule | null>(null)

// A move, resize or slot pick that lands on another patient or a block asks
// first (CalendarMoveClashDialog), the way a new booking needs "allow double
// booking" ticked. `proceed` carries on exactly as a clash-free move would;
// `back` undoes the live preview.
const { findMoveClashes } = useMoveClashCheck()
const moveClash = ref<{ clashes: MoveClash[]; proceed: () => void; back: () => void } | null>(null)
function onMoveClashConfirm() {
  const c = moveClash.value
  moveClash.value = null
  c?.proceed()
}
function onMoveClashCancel() {
  const c = moveClash.value
  moveClash.value = null
  c?.back()
}

// A drag that leaves the start where it was -- a resize, or the same time in
// another room -- is not a reschedule: the patient comes when they were told
// to. It saves as it is, with no reason to give, no "moved" flag, no
// appointment_reschedules row and no "your appointment has moved" message.
async function saveInPlace(appointmentId: string, values: { ends_at: string; room_id: string | null }, revert: () => void) {
  const { error } = await supabase.from('appointments').update(values).eq('id', appointmentId)
  if (error) {
    revert()
    alert(error.message)
    return
  }
  await reloadAfterChange()
}

// --- Reschedule mode ---
// Drag-and-drop above only works within whatever days/rooms are currently
// rendered in the DOM -- there's no way to drag an appointment onto a week
// that isn't on screen. This is the PracticeHub-style alternative: a
// "Reschedule" button (on the hover card and the edit modal) puts the
// calendar into a picking mode that survives free navigation -- anchorDate,
// viewMode, and the mini-calendar all keep working normally -- and the next
// click on an empty slot (any day, any view, once you've navigated there)
// builds the same PendingReschedule object the drag flow does, reusing its
// confirm dialog/audit-row/fee/resend-confirmation logic unchanged.
interface ReschedulingAppointment {
  id: string
  patientId: string
  patientName: string
  appointmentTypeName: string | null
  startsAt: string
  endsAt: string
  // Whose hours the slot about to be picked has to be checked against. The
  // drag path reads it off the appointment row it is moving; this path has
  // navigated away from that row, so it is carried.
  practitionerId: string | null
}
const reschedulingAppointment = ref<ReschedulingAppointment | null>(null)

function startReschedule(appt: {
  id: string
  patient_id: string
  practitioner_id: string | null
  starts_at: string
  ends_at: string
  patients: { first_name: string; last_name: string | null } | null
  appointment_types: { name: string } | null
}) {
  modalOpen.value = false
  hoveredAppt.value = null
  reschedulingAppointment.value = {
    id: appt.id,
    patientId: appt.patient_id,
    patientName: appt.patients ? `${appt.patients.first_name} ${appt.patients.last_name ?? ''}`.trim() : '',
    appointmentTypeName: appt.appointment_types?.name ?? null,
    startsAt: appt.starts_at,
    endsAt: appt.ends_at,
    practitionerId: appt.practitioner_id,
  }
}
function cancelRescheduleMode() {
  reschedulingAppointment.value = null
}

// Builds the exact same PendingReschedule shape onAppointmentDragEnd does,
// from a slot click instead of a drag. `day`/`time`/`roomId` come from
// whichever grid the user clicked in (Day or Week view, any date). If the
// appointment being moved happens to also be in the currently-loaded range
// (e.g. rescheduling within the same visible week), it's live-mutated the
// same way a drag does for an immediate WYSIWYG preview and a working
// revert() on cancel; if it isn't (a genuinely different week), there's
// nothing in memory to preview -- confirmReschedule()'s reload is what
// makes the new position show up once that week comes into view.
async function pickRescheduleSlot(day: Date, time: string, roomId: string | null) {
  const src = reschedulingAppointment.value
  if (!src || moveClash.value) return
  const [h, m] = time.split(':').map(Number)
  const newStartsAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0)
  const durationMs = new Date(src.endsAt).getTime() - new Date(src.startsAt).getTime()
  const newEndsAt = new Date(newStartsAt.getTime() + durationMs)

  if (
    apptOutsideWorkingHours(newStartsAt, src.practitionerId) ||
    apptOutsideWorkingHours(new Date(newEndsAt.getTime() - 1), src.practitionerId)
  ) {
    if (!confirm(t('This falls outside working hours. Move it anyway?', 'Esto queda fuera del horario de atención. ¿Moverla de todos modos?'))) return
  }

  const clashes = await findMoveClashes({ appointmentId: src.id, practitionerId: src.practitionerId, roomId, startsAt: newStartsAt, endsAt: newEndsAt })
  // Picking mode may have been left while the lookup was out.
  if (reschedulingAppointment.value !== src) return
  if (clashes.length) {
    // Going back leaves picking mode on: the next click is another try.
    moveClash.value = { clashes, proceed: () => placeRescheduled(src, newStartsAt, newEndsAt, roomId), back: () => {} }
    return
  }
  placeRescheduled(src, newStartsAt, newEndsAt, roomId)
}

function placeRescheduled(src: ReschedulingAppointment, newStartsAt: Date, newEndsAt: Date, roomId: string | null) {
  const live = appointments.value.find((a) => a.id === src.id)
  const orig = live ? { starts_at: live.starts_at, ends_at: live.ends_at, room_id: live.room_id } : null
  function revert() {
    if (live && orig) {
      live.starts_at = orig.starts_at
      live.ends_at = orig.ends_at
      live.room_id = orig.room_id
    }
  }
  if (live) {
    live.starts_at = newStartsAt.toISOString()
    live.ends_at = newEndsAt.toISOString()
    live.room_id = roomId
  }

  pendingReschedule.value = {
    appointmentId: src.id,
    patientId: src.patientId,
    patientName: src.patientName,
    appointmentTypeName: src.appointmentTypeName,
    origStartsAt: src.startsAt,
    newStartsAt: newStartsAt.toISOString(),
    newEndsAt: newEndsAt.toISOString(),
    newRoomId: roomId,
    revert,
  }
  reschedulingAppointment.value = null
}

async function onAppointmentDragEnd(e: PointerEvent) {
  const s = dragState.value
  window.removeEventListener('pointermove', onAppointmentDragMove)
  window.removeEventListener('pointerup', onAppointmentDragEnd)
  if (!s || e.pointerId !== s.pointerId) return
  dragState.value = null
  if (!dragMoved.value) return

  const appt = appointments.value.find((a) => a.id === s.apptId)
  if (!appt) return
  const orig = { starts_at: s.origStartsAt, ends_at: s.origEndsAt, room_id: s.origRoomId }

  function revert() {
    appt!.starts_at = orig.starts_at
    appt!.ends_at = orig.ends_at
    appt!.room_id = orig.room_id
  }

  if (
    apptOutsideWorkingHours(new Date(appt.starts_at), appt.practitioner_id) ||
    apptOutsideWorkingHours(new Date(new Date(appt.ends_at).getTime() - 1), appt.practitioner_id)
  ) {
    if (!confirm(t('This falls outside working hours. Save it anyway?', 'Esto queda fuera del horario de atención. ¿Guardarlo de todos modos?'))) {
      revert()
      return
    }
  }

  // Where it was dropped, taken now: the lookup below is a round trip, and
  // the live row can be replaced by a reload in the meantime.
  const next = { starts_at: appt.starts_at, ends_at: appt.ends_at, room_id: appt.room_id }
  const same = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime()
  const sameStart = same(next.starts_at, orig.starts_at)
  // Snapped back to where it started: nothing to save or to ask about.
  if (sameStart && same(next.ends_at, orig.ends_at) && next.room_id === orig.room_id) return

  function proceed() {
    if (sameStart) {
      saveInPlace(appt!.id, { ends_at: next.ends_at, room_id: next.room_id }, revert)
      return
    }
    pendingReschedule.value = {
      appointmentId: appt!.id,
      patientId: appt!.patient_id,
      patientName: appt!.patients ? `${appt!.patients.first_name} ${appt!.patients.last_name ?? ''}`.trim() : '',
      appointmentTypeName: appt!.appointment_types?.name ?? null,
      origStartsAt: orig.starts_at,
      newStartsAt: next.starts_at,
      newEndsAt: next.ends_at,
      newRoomId: next.room_id,
      revert,
    }
  }

  const clashes = await findMoveClashes({ appointmentId: appt.id, practitionerId: appt.practitioner_id, roomId: next.room_id, startsAt: next.starts_at, endsAt: next.ends_at })
  if (clashes.length) {
    moveClash.value = { clashes, proceed, back: revert }
    return
  }
  proceed()
}

function cancelReschedule() {
  pendingReschedule.value?.revert()
  pendingReschedule.value = null
}

async function confirmReschedule(payload: { reasonId: string | null; note: string; applyFee: boolean; resendConfirmation: boolean }) {
  const pending = pendingReschedule.value
  if (!pending) return

  const { error } = await supabase
    .from('appointments')
    .update({ starts_at: pending.newStartsAt, ends_at: pending.newEndsAt, room_id: pending.newRoomId, rescheduled: true })
    .eq('id', pending.appointmentId)
  if (error) {
    pending.revert()
    alert(error.message)
    pendingReschedule.value = null
    return
  }

  await supabase.from('appointment_reschedules').insert({
    account_id: store.accountId!,
    appointment_id: pending.appointmentId,
    from_starts_at: pending.origStartsAt,
    to_starts_at: pending.newStartsAt,
    reason_id: payload.reasonId,
    note: payload.note || null,
    fee_applied: payload.applyFee,
    created_by: store.teamMember?.id ?? null,
  })

  if (payload.applyFee && store.schedulingPolicyFeeCents) {
    // No number, no invoice: an unnumbered fee is worse than an uncharged one.
    const { data: invoiceNumber } = await supabase.rpc('next_invoice_number', { p_account_id: store.accountId! })
    if (invoiceNumber) {
      const { data: feeInvoice } = await supabase
        .from('invoices')
        .insert({ account_id: store.accountId!, patient_id: pending.patientId, invoice_number: invoiceNumber, status: 'unpaid', total_cents: store.schedulingPolicyFeeCents })
        .select('id')
        .single()
      if (feeInvoice) {
        await supabase.from('invoice_line_items').insert({
          account_id: store.accountId!,
          invoice_id: feeInvoice.id,
          description: 'Scheduling policy fee',
          quantity: 1,
          price_cents: store.schedulingPolicyFeeCents,
        })
      }
    }
  }

  if (payload.resendConfirmation) {
    fire('appointment.rescheduled', { patientId: pending.patientId, appointmentId: pending.appointmentId })
  }

  pendingReschedule.value = null
  // Reschedule-mode moves can land on a day/week that isn't the one already
  // loaded into `appointments.value` (drag-and-drop moves never leave the
  // loaded range, so this was a no-op for that flow before) -- reloading
  // whatever range is currently in view is what makes the appointment show
  // up in its new slot if that's the range being looked at, and disappear
  // from it otherwise.
  await reloadAfterChange()
}

// Wraps openEditModal so the click the browser synthesizes right after a
// real drag doesn't reopen the modal the drag was meant to replace.
function handleAppointmentClick(appt: AppointmentRow) {
  if (dragMoved.value) {
    dragMoved.value = false
    return
  }
  // A slot click while reschedule-mode is active is what moves the
  // appointment -- opening some other appointment's edit modal mid-pick
  // would be a confusing second interaction on top of that.
  if (reschedulingAppointment.value) return
  openEditModal(appt)
}

const { fire } = useAutomations()

// The visit's price with the practitioner's override, for "45 € al cobrar"
// and for the Cobro tab.
function priceFor(appt: AppointmentRow) {
  if (!appt.appointment_type_id || !appt.appointment_types) return 0
  return effectivePriceCents(appt.appointment_types.default_price_cents, appt.appointment_type_id, appt.practitioner_id ?? '', overrides.value)
}
function paymentFor(appt: AppointmentRow): VisitPayment {
  return visitPaymentById.value[appt.id] ?? { kind: 'none' }
}

// Hovering a block (mouse only) or moving the keyboard's cell onto it shows
// the read-only hover card. A short show delay avoids flicker when the mouse
// just passes over. The card has no controls, so it takes no pointer events
// and there is nothing to travel onto; on touch there is no card at all -- a
// tap opens the panel, whose header says the same things.
const hoveredAppt = ref<AppointmentRow | null>(null)
const hoverPos = ref({ x: 0, y: 0 })
const hoverCardEl = ref<any>(null)
let hoverShowTimer: ReturnType<typeof setTimeout> | null = null
let hoverHideTimer: ReturnType<typeof setTimeout> | null = null
let hoverAnchorRect: DOMRect | null = null
let hoverX = 0
let hoverResizeObserver: ResizeObserver | null = null

// Hovercard is a fixed 300px wide (AppointmentHoverCard.vue) -- shown on
// whichever side of the block actually has room, so on a block near the
// right edge of the screen it opens to the left instead of clamping back
// over the block itself and blocking clicks on it.
const HOVERCARD_WIDTH = 300
const HOVERCARD_GAP = 10

// The card's height isn't just unknown until first render -- it keeps
// changing after that too (usePatientFinancialSummary's balance/package
// fetch resolves async, "Recent activity" populates once loaded), so a
// single post-mount measurement still clipped a card that grew taller
// after that. A ResizeObserver re-clamps every time the real height
// changes instead, however many times that happens.
function updateHoverY() {
  if (!hoverAnchorRect) return
  const height = hoverCardEl.value?.$el?.offsetHeight ?? 380
  hoverPos.value = { x: hoverX, y: Math.max(8, Math.min(hoverAnchorRect.top, window.innerHeight - height - 8)) }
}

watch(hoveredAppt, async (appt) => {
  hoverResizeObserver?.disconnect()
  hoverResizeObserver = null
  if (!appt) return
  await nextTick()
  const el = hoverCardEl.value?.$el as HTMLElement | undefined
  if (!el) return
  hoverResizeObserver = new ResizeObserver(updateHoverY)
  hoverResizeObserver.observe(el)
  updateHoverY()
})
onUnmounted(() => hoverResizeObserver?.disconnect())

function onBlockPointerEnter(appt: AppointmentRow, event: PointerEvent) {
  if (event.pointerType !== 'mouse' || dragState.value || modalOpen.value) return
  showHoverCardFor(appt, (event.currentTarget as HTMLElement).getBoundingClientRect(), 300)
}
function showHoverCardFor(appt: AppointmentRow, rect: DOMRect, delay: number) {
  if (hoverHideTimer) {
    clearTimeout(hoverHideTimer)
    hoverHideTimer = null
  }
  if (hoverShowTimer) clearTimeout(hoverShowTimer)
  hoverShowTimer = setTimeout(() => {
    hoveredAppt.value = appt
    const spaceRight = window.innerWidth - rect.right
    const spaceLeft = rect.left
    const showRight = spaceRight >= HOVERCARD_WIDTH + HOVERCARD_GAP || spaceRight >= spaceLeft
    hoverX = showRight
      ? Math.min(rect.right + HOVERCARD_GAP, window.innerWidth - HOVERCARD_WIDTH - HOVERCARD_GAP)
      : Math.max(HOVERCARD_GAP, rect.left - HOVERCARD_WIDTH - HOVERCARD_GAP)
    hoverAnchorRect = rect
    // Rough guess for the instant the card appears, before the resize
    // observer above has attached and measured anything real yet.
    hoverPos.value = { x: hoverX, y: Math.max(8, Math.min(rect.top, window.innerHeight - 380)) }
  }, delay)
}
function cancelHoverShow() {
  if (hoverShowTimer) {
    clearTimeout(hoverShowTimer)
    hoverShowTimer = null
  }
  hoverHideTimer = setTimeout(() => (hoveredAppt.value = null), 200)
}
// Dragging an appointment keeps the pointer over the calendar the whole
// time, so mouseleave never fires on the original block -- the hover card
// would otherwise stay open (and stale) through the entire drag.
function closeHoverCardNow() {
  if (hoverShowTimer) {
    clearTimeout(hoverShowTimer)
    hoverShowTimer = null
  }
  if (hoverHideTimer) {
    clearTimeout(hoverHideTimer)
    hoverHideTimer = null
  }
  hoveredAppt.value = null
}
const hoveredRoomName = computed(() => rooms.value.find((r) => r.id === hoveredAppt.value?.room_id)?.name ?? null)

// --- Empty slots: hover, keyboard focus, touch ---
// Every column on screen, left to right: rooms in Day view, day x room in the
// week views. A cell is (column, minute since START_HOUR), one slot tall.
const gridColumns = computed(() => {
  const days = viewMode.value === 'day' ? [anchorDate.value] : visibleWeekDays.value
  return days.flatMap((day) => dayColumns.value.map((c) => ({ day, dayKey: toDateKey(day), roomId: c.id, roomName: c.name })))
})
interface Cell { col: number; min: number }
const focusCell = ref<Cell | null>(null)
const hoverCell = ref<Cell | null>(null)
const gridHasFocus = ref(false)
let lastPointerType = 'mouse'

function colIndex(dayKey: string, roomId: string) {
  return gridColumns.value.findIndex((c) => c.dayKey === dayKey && c.roomId === roomId)
}
function cellStart(cell: Cell): Date {
  const c = gridColumns.value[cell.col]
  const d = new Date(c.day)
  d.setHours(START_HOUR, cell.min, 0, 0)
  return d
}
function cellTimeLabel(cell: Cell) {
  return slotLabel(cell.min)
}
// Where in its column an event landed, in px from the top. Measured from
// clientY rather than read off offsetY: offsetY is relative to whatever
// element was hit, and is not set at all on some synthesised events -- a
// tap came through as "Reservar NaN:NaN".
function yInColumn(e: MouseEvent) {
  return e.clientY - (e.currentTarget as HTMLElement).getBoundingClientRect().top
}
function snapMin(offsetY: number, hourPx: number) {
  if (!Number.isFinite(offsetY)) return 0
  const m = Math.floor(((offsetY / hourPx) * 60) / SLOT_MIN.value) * SLOT_MIN.value
  return Math.min(Math.max(0, m), TOTAL_MIN - SLOT_MIN.value)
}

// The visible appointment covering a cell, if any -- what Enter opens.
function appointmentAtCell(cell: Cell): AppointmentRow | null {
  const c = gridColumns.value[cell.col]
  if (!c) return null
  const at = cellStart(cell).getTime()
  return (
    appointments.value.find(
      (a) =>
        isApptVisible(a) &&
        a.status !== 'cancelled' &&
        (a.room_id ?? '__none') === c.roomId &&
        toDateKey(new Date(a.starts_at)) === c.dayKey &&
        new Date(a.starts_at).getTime() <= at &&
        new Date(a.ends_at).getTime() > at,
    ) ?? null
  )
}
// Free = nothing booked or blocked across the slot, and somebody works then.
// Hatched hours still take a click (with the out-of-hours confirm), but the
// grid does not invite one there.
function cellIsFree(cell: Cell): boolean {
  const c = gridColumns.value[cell.col]
  if (!c) return false
  const start = cellStart(cell).getTime()
  const end = start + SLOT_MIN.value * 60000
  const overlaps = (s: string, e: string) => new Date(s).getTime() < end && new Date(e).getTime() > start
  if (appointments.value.some((a) => isApptVisible(a) && a.status !== 'cancelled' && (a.room_id ?? '__none') === c.roomId && overlaps(a.starts_at, a.ends_at))) return false
  if (blocksForRoomOnDay(c.day, c.roomId).some((b) => overlaps(b.starts_at, b.ends_at))) return false
  if (freedSlotsFor(c.dayKey, c.roomId).some((f) => overlaps(f.offered_starts_at, f.offered_ends_at ?? f.offered_starts_at))) return false
  return isWorkingTime(new Date(start))
}

// What the ghost is drawn on: the keyboard's cell while the grid has focus,
// otherwise whatever the pointer is over.
const ghostCell = computed<Cell | null>(() => (gridHasFocus.value && focusCell.value) || hoverCell.value)
// While the create panel is open, the slot it is booking is marked solid on
// the grid -- it has no backdrop, so the two are read side by side.
function createGhostFor(dayKey: string, roomId: string) {
  if (!modalOpen.value || modalMode.value !== 'create' || !prefill.value) return null
  if (prefill.value.date !== dayKey || (prefill.value.roomId || '__none') !== roomId) return null
  const [h, m] = prefill.value.time.split(':').map(Number)
  return { min: h * 60 + m - START_HOUR * 60, label: prefill.value.time }
}
function ghostFor(dayKey: string, roomId: string) {
  const cell = ghostCell.value
  if (!cell || readOnly.value || reschedulingAppointment.value || (modalOpen.value && modalMode.value === 'create')) return null
  const c = gridColumns.value[cell.col]
  if (!c || c.dayKey !== dayKey || c.roomId !== roomId) return null
  if (appointmentAtCell(cell)) return null
  return { min: cell.min, free: cellIsFree(cell), label: cellTimeLabel(cell) }
}
// The appointment under the keyboard's cell is "selected": ringed, and the
// one Enter opens.
const selectedApptId = computed(() => {
  if (!gridHasFocus.value || !focusCell.value) return null
  return appointmentAtCell(focusCell.value)?.id ?? null
})

// Keyboard focus on a block shows the same card, straight away.
watch(
  () => selectedApptId.value,
  (id) => {
    if (!id) {
      if (hoveredAppt.value && !hoverCell.value) closeHoverCardNow()
      return
    }
    const appt = appointments.value.find((a) => a.id === id)
    nextTick(() => {
      const el = document.querySelector<HTMLElement>(`[data-appt-id="${id}"]`)
      if (appt && el) showHoverCardFor(appt, el.getBoundingClientRect(), 0)
    })
  },
)

function onColumnPointerMove(e: PointerEvent, dayKey: string, roomId: string, hourPx: number) {
  if (e.pointerType !== 'mouse' || dragState.value) return
  // Only the bare column: over a block or a band the pointer is on that, not
  // on a free slot.
  if (e.target !== e.currentTarget) {
    hoverCell.value = null
    return
  }
  const col = colIndex(dayKey, roomId)
  const min = snapMin(yInColumn(e), hourPx)
  if (hoverCell.value?.col !== col || hoverCell.value?.min !== min) hoverCell.value = { col, min }
}
function onColumnPointerDown(e: PointerEvent) {
  lastPointerType = e.pointerType
}

// A tap on touch shows the ghost first and books on the second tap on the
// same cell, so a finger resting on the grid while scrolling does not open a
// form. A mouse click books straight away, as it always has.
function onColumnClick(e: MouseEvent, day: Date, roomId: string, hourPx: number) {
  // The cell under the pointer, not the nearest slot boundary: a click in the
  // lower half of 18:00-18:30 is a click on 18:00.
  const cell = { col: colIndex(toDateKey(day), roomId), min: snapMin(yInColumn(e), hourPx) }
  const time = slotLabel(cell.min)
  const room = roomId === '__none' ? null : roomId
  if (reschedulingAppointment.value) {
    pickRescheduleSlot(day, time, room)
    return
  }
  if (lastPointerType === 'touch' || lastPointerType === 'pen') {
    const same = focusCell.value?.col === cell.col && focusCell.value?.min === cell.min && gridHasFocus.value
    focusCell.value = cell
    gridHasFocus.value = true
    if (!same) return
  }
  // Arrow keys carry on from wherever the mouse last booked.
  focusCell.value = cell
  openCreateAt(day, time, room)
}

function openCreateAt(day: Date, time: string, roomId: string | null) {
  // Every way of booking -- the button, a slot click, Enter on a cell, the
  // phone agenda -- ends here, so a read-only calendar is refused once.
  if (readOnly.value) return
  prefill.value = { date: toDateKey(day), time, roomId: roomId ?? '' }
  modalMode.value = 'create'
  editingAppointment.value = null
  modalOpen.value = true
}

const gridRef = ref<HTMLElement | null>(null)
// Only KEYBOARD focus draws the focus cell. A mouse click also focuses the
// grid (it is tabbable), and drawing a ghost at the keyboard's cell then would
// fight the one under the pointer.
function onGridFocus() {
  if (!gridRef.value?.matches(':focus-visible')) return
  activateKeyboardFocus()
}
function activateKeyboardFocus() {
  gridHasFocus.value = true
  if (!focusCell.value) {
    // Start where the day is: now, if it is on screen, else the first hour
    // anybody works.
    const nowMin = now.value.getHours() * 60 + now.value.getMinutes() - START_HOUR * 60
    const onScreen = gridColumns.value.findIndex((c) => isSameDate(c.day, now.value))
    const min = onScreen >= 0 && nowMin >= 0 && nowMin < TOTAL_MIN ? Math.floor(nowMin / SLOT_MIN.value) * SLOT_MIN.value : 0
    focusCell.value = { col: Math.max(0, onScreen), min }
  }
}
function onGridBlur(e: FocusEvent) {
  if (gridRef.value?.contains(e.relatedTarget as Node | null)) return
  gridHasFocus.value = false
}
function onGridKeydown(e: KeyboardEvent) {
  if (!gridHasFocus.value && e.key.startsWith('Arrow')) {
    e.preventDefault()
    activateKeyboardFocus()
    return
  }
  const cell = focusCell.value
  if (!cell) return
  const lastCol = gridColumns.value.length - 1
  const lastMin = TOTAL_MIN - SLOT_MIN.value
  let next: Cell | null = null
  switch (e.key) {
    case 'ArrowUp':
      next = { col: cell.col, min: Math.max(0, cell.min - SLOT_MIN.value) }
      break
    case 'ArrowDown':
      next = { col: cell.col, min: Math.min(lastMin, cell.min + SLOT_MIN.value) }
      break
    case 'ArrowLeft':
      next = { col: Math.max(0, cell.col - 1), min: cell.min }
      break
    case 'ArrowRight':
      next = { col: Math.min(lastCol, cell.col + 1), min: cell.min }
      break
    case 'Enter':
    case ' ': {
      e.preventDefault()
      // Mid-load, what is in a cell is not known yet: Enter could book over a
      // visit that is on its way. The cursor still moves.
      if (loading.value) return
      const appt = appointmentAtCell(cell)
      if (appt) handleAppointmentClick(appt)
      else {
        const c = gridColumns.value[cell.col]
        if (reschedulingAppointment.value) pickRescheduleSlot(c.day, slotLabel(cell.min), c.roomId === '__none' ? null : c.roomId)
        else openCreateAt(c.day, slotLabel(cell.min), c.roomId === '__none' ? null : c.roomId)
      }
      return
    }
    case 'Escape':
      gridRef.value?.blur()
      return
    default:
      return
  }
  e.preventDefault()
  focusCell.value = next
  nextTick(() => document.querySelector('[data-grid-focus]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
}
// Read out by screen readers as the focus moves.
const focusAnnouncement = computed(() => {
  const cell = focusCell.value
  if (!gridHasFocus.value || !cell) return ''
  const c = gridColumns.value[cell.col]
  if (!c) return ''
  const appt = appointmentAtCell(cell)
  const where = `${viewMode.value === 'day' ? '' : `${formatWeekdayDate(c.day)}, `}${c.roomName}, ${cellTimeLabel(cell)}`
  if (appt) return `${where}: ${blockView(appt).name}, ${stageLabel(stageOf(appt), appt.checked_in_at ? formatTime(appt.checked_in_at) : null)}`
  return `${where}: ${cellIsFree(cell) ? t('free', 'libre') : t('unavailable', 'no disponible')}`
})
// Where the keyboard's cell sits in its column, for the focus ring.
function focusRectFor(dayKey: string, roomId: string, hourPx: number) {
  const cell = focusCell.value
  if (!gridHasFocus.value || !cell) return null
  const c = gridColumns.value[cell.col]
  if (!c || c.dayKey !== dayKey || c.roomId !== roomId) return null
  return { top: (cell.min / 60) * hourPx, height: (SLOT_MIN.value / 60) * hourPx }
}

// A slot freed by a cancellation and offered to the waitlist. It is not free
// -- someone has until the offer expires to take it -- so it is drawn where
// the cancelled visit was, naming who has it and until when.
function freedSlotsFor(dayKey: string, roomId: string) {
  const nowMs = now.value.getTime()
  return waitlistOffers.value.filter(
    (o) =>
      (o.offered_room_id ?? '__none') === roomId &&
      toDateKey(new Date(o.offered_starts_at)) === dayKey &&
      (!o.offer_expires_at || new Date(o.offer_expires_at).getTime() > nowMs) &&
      (practitionerFilter.value === ALL_PRACTITIONERS || !o.offered_practitioner_id || o.offered_practitioner_id === practitionerFilter.value),
  )
}
function freedSlotLabel(o: WaitlistOffer) {
  const who = `${o.patients?.first_name ?? ''} ${o.patients?.last_name ?? ''}`.trim() || t('the waitlist', 'la lista de espera')
  return t(`Slot offered to ${who}`, `Hueco ofrecido a ${who}`)
}
// "Moved to Thu 1 Oct 10:00" on the marker left at a visit's old slot --
// same day reads as just the time.
function movedMarkerName(m: AppointmentRow) {
  if (settings.privacyMode) return t('Moved', 'Movida')
  return `${m.patients?.first_name ?? ''} ${m.patients?.last_name ?? ''}`.trim()
}
function movedMarkerLabel(m: AppointmentRow) {
  const to = new Date(m._movedTo!)
  const sameDay = toDateKey(to) === toDateKey(new Date(m.starts_at))
  const day = to.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const when = sameDay ? formatTime(m._movedTo!) : `${day} ${formatTime(m._movedTo!)}`
  return t(`Moved to ${when}`, `Movida al ${when}`)
}
function freedSlotUntil(o: WaitlistOffer) {
  return o.offer_expires_at ? t(`replies by ${formatTime(o.offer_expires_at)}`, `responde antes de las ${formatTime(o.offer_expires_at)}`) : ''
}

// --- Phone: the day as a one-column agenda ---
// Below md the day view is PhoneAgenda instead of the room grid. Its
// "Mis citas / Toda la clínica" switch is the practitioner filter, reduced to
// the two choices that make sense on a phone.
const isPhone = useMediaQuery('(max-width: 767px)')
const showAgenda = computed(() => isPhone.value && viewMode.value === 'day')
const myPractitionerId = computed(() => (clinicTeamMembers.value.some((m) => m.id === store.teamMember?.id) ? store.teamMember!.id : null))
const agendaScope = computed<'mine' | 'all'>(() => (myPractitionerId.value && practitionerFilter.value === myPractitionerId.value ? 'mine' : 'all'))
function setAgendaScope(scope: 'mine' | 'all') {
  practitionerFilter.value = scope === 'mine' && myPractitionerId.value ? myPractitionerId.value : ALL_PRACTITIONERS
}
// Arriving on the agenda with some other practitioner's tab selected: pick
// the phone's own meaning -- my day if I have one, else the clinic's.
watch([showAgenda, () => clinicTeamMembers.value.length], ([on]) => {
  if (!on || !clinicTeamMembers.value.length) return
  if (practitionerFilter.value !== ALL_PRACTITIONERS && practitionerFilter.value !== myPractitionerId.value) setAgendaScope(myPractitionerId.value ? 'mine' : 'all')
})
const agendaItems = computed(() => {
  return (appointmentsByDay.value.get(toDateKey(anchorDate.value)) ?? [])
    .filter(isApptVisible)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((a) => ({ id: a.id, startsAt: a.starts_at, endsAt: a.ends_at, view: blockView(a), stickyNote: a.patients?.sticky_note?.trim() || null }))
})
const agendaCounts = computed(() => {
  const c = dayHeaderCounts(anchorDate.value)
  return { unconfirmed: c.unconfirmed, owe: c.owe, waiting: rangeCounts.value.counts.arrived }
})
function openAgendaItem(id: string) {
  const appt = appointments.value.find((a) => a.id === id)
  if (appt) openEditModal(appt)
}

// "Now": a red line across today, in every view, that moves with the clock.
// Red is otherwise kept for money on this calendar; the now-line is the one
// deliberate exception, because it has to be found at a glance across a
// screen full of tinted blocks.
const now = ref(new Date())
// The phone header shows "Today" only when another day is on screen.
const isTodayShown = computed(() => isSameDate(anchorDate.value, now.value))
let nowTimer: ReturnType<typeof setInterval> | null = null
// A tab left in the background can go minutes without its timers firing;
// catch up the moment it is looked at again.
function tickNow() {
  now.value = new Date()
}
function onVisible() {
  if (document.visibilityState === 'visible') tickNow()
}
onMounted(() => {
  nowTimer = setInterval(tickNow, 30000)
  document.addEventListener('visibilitychange', onVisible)
})
onUnmounted(() => {
  if (nowTimer) clearInterval(nowTimer)
  document.removeEventListener('visibilitychange', onVisible)
})
const nowWithinHours = computed(() => now.value.getHours() >= START_HOUR && now.value.getHours() < END_HOUR)
const showNowLine = computed(() => viewMode.value === 'day' && isSameDate(now.value, anchorDate.value) && nowWithinHours.value)
const nowLinePx = computed(() => timeToPx(now.value.toISOString(), DAY_HOUR_PX.value))
// Week views: the line runs across today's room columns only, and the time
// sits in the gutter when today is one of the days shown.
const showWeekNowLabel = computed(() => viewMode.value !== 'day' && nowWithinHours.value && visibleWeekDays.value.some((d) => isSameDate(d, now.value)))
const nowLineWeekPx = computed(() => timeToPx(now.value.toISOString(), WEEK_HOUR_PX.value))
function showNowLineOn(day: Date) {
  return nowWithinHours.value && isSameDate(day, now.value)
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Phones get one compact row: the date, Today, back/forward, and a
         "more" menu for everything else. The full toolbar below wrapped onto
         three rows of 44px controls there, pushing the day itself half off
         the screen, and its "+ New Appointment" repeated the agenda's own
         round button. CSS rather than isPhone, so the server renders the
         right one and nothing jumps on load. -->
    <header class="relative flex shrink-0 flex-col border-b border-line bg-surface px-3 py-2 md:hidden" data-cy="calendar-phone-header">
      <div class="flex items-center gap-1.5">
        <p class="min-w-0 flex-1 truncate pl-1 text-[16px] font-[640] tracking-tightTitle text-ink-900">{{ rangeLabel }}</p>
        <button
          v-if="!isTodayShown"
          type="button"
          class="h-9 shrink-0 rounded-ctlSm border border-line-control px-3 text-[13px] font-medium text-ink-600"
          @click="goToday"
        >
          {{ t('Today', 'Hoy') }}
        </button>
        <button type="button" :aria-label="t('Previous period', 'Periodo anterior')" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctlSm border border-line-control text-ink-500" @click="stepDate(-1)">
          <svg width="7" height="11" viewBox="0 0 7 11" fill="none"><path d="M6 1L1 5.5L6 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <button type="button" :aria-label="t('Next period', 'Periodo siguiente')" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctlSm border border-line-control text-ink-500" @click="stepDate(1)">
          <svg width="7" height="11" viewBox="0 0 7 11" fill="none"><path d="M1 1L6 5.5L1 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <button
          type="button"
          :aria-label="t('More', 'Más')"
          :aria-expanded="phoneMenuOpen"
          data-cy="calendar-phone-more"
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctlSm border border-line-control text-ink-500"
          @click="phoneMenuOpen = !phoneMenuOpen"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
        </button>
      </div>
      <div v-if="bookingFor || readOnly" class="mt-2 flex">
        <span v-if="bookingFor && !readOnly" class="inline-flex h-8 max-w-full items-center gap-1.5 rounded-pill bg-brand-tint pl-3 pr-1.5 text-[12.5px] font-semibold text-brand-text">
          <span class="truncate">{{ t(`Booking for ${bookingFor.name} · pick a time`, `Reservando para ${bookingFor.name} · elige una hora`) }}</span>
          <button type="button" class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-pill hover:bg-surface" :aria-label="t('Stop booking for this patient', 'Dejar de reservar para este paciente')" @click="stopBookingFor">&times;</button>
        </span>
        <span v-else-if="readOnly" class="inline-flex h-7 items-center rounded-pill bg-chip-bg px-3 text-[12.5px] font-semibold text-chip-text">{{ t('Read-only', 'Solo lectura') }}</span>
      </div>

      <template v-if="phoneMenuOpen">
        <div class="fixed inset-0 z-30" @click="phoneMenuOpen = false" />
        <div class="absolute right-3 top-[calc(100%-4px)] z-40 w-60 overflow-hidden rounded-card border border-line bg-surface py-1 shadow-popover" role="menu" data-cy="calendar-phone-menu">
          <p class="px-3.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[.05em] text-ink-faint">{{ t('View', 'Vista') }}</p>
          <button
            v-for="v in ([['day', t('Day', 'Día')], ['workweek', t('Work week', 'Semana laboral')], ['week', t('Week', 'Semana')]] as const)"
            :key="v[0]"
            type="button"
            role="menuitemradio"
            :aria-checked="viewMode === v[0]"
            class="flex h-10 w-full items-center justify-between px-3.5 text-left text-[14px] text-ink-900 active:bg-surface-subtle"
            @click="phoneMenu(() => (viewMode = v[0]))"
          >
            {{ v[1] }}
            <svg v-if="viewMode === v[0]" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8.4L6.6 11.4L12.5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="text-brand" /></svg>
          </button>
          <div class="my-1 h-px bg-line-divider" />
          <button v-if="!readOnly && !showAgenda" type="button" role="menuitem" class="flex h-10 w-full items-center px-3.5 text-left text-[14px] font-medium text-brand-text active:bg-surface-subtle" @click="phoneMenu(() => openCreateModal())">
            {{ t('New appointment', 'Nueva cita') }}
          </button>
          <button v-if="!readOnly" type="button" role="menuitem" class="flex h-10 w-full items-center px-3.5 text-left text-[14px] text-ink-900 active:bg-surface-subtle" @click="phoneMenu(() => openBlockCreateModal())">
            {{ t('Block time', 'Bloquear horario') }}
          </button>
          <button v-if="can('payments_allocate')" type="button" role="menuitem" class="flex h-10 w-full items-center px-3.5 text-left text-[14px] text-ink-900 active:bg-surface-subtle" @click="phoneMenu(() => (cashShiftOpen = true))">
            {{ t('Cash Shift', 'Turno de Caja') }}
          </button>
          <button type="button" role="menuitem" class="flex h-10 w-full items-center px-3.5 text-left text-[14px] text-ink-900 active:bg-surface-subtle" @click="phoneMenu(() => (mobileInfoOpen = true))">
            {{ t("Today's info", 'Información del día') }}
          </button>
        </div>
      </template>
    </header>

    <header class="hidden shrink-0 flex-col gap-2.5 border-b border-line bg-surface px-4 py-2.5 md:flex lg:min-h-14 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:px-6 lg:py-2.5">
      <div class="flex items-center gap-4">
        <h1 class="text-[18px] font-[640] tracking-tightTitle text-ink-900">{{ t('Calendar', 'Calendario') }}</h1>
        <div class="flex items-center gap-1">
          <button type="button" :aria-label="t('Previous', 'Anterior')" class="flex h-8 w-8 touch:h-11 touch:w-11 items-center justify-center rounded-ctlSm border border-line-control text-ink-500 hover:border-line-controlHover hover:bg-surface-subtle [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" @click="stepDate(-1)">
            <svg width="7" height="11" viewBox="0 0 7 11" fill="none"><path d="M6 1L1 5.5L6 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <button type="button" class="flex h-8 touch:h-11 items-center rounded-ctlSm border border-line-control px-2.5 text-[12.5px] font-medium text-ink-600 hover:border-line-controlHover hover:bg-surface-subtle [@media(pointer:coarse)]:h-11" @click="goToday">{{ t('Today', 'Hoy') }}</button>
          <button type="button" :aria-label="t('Next', 'Siguiente')" class="flex h-8 w-8 touch:h-11 touch:w-11 items-center justify-center rounded-ctlSm border border-line-control text-ink-500 hover:border-line-controlHover hover:bg-surface-subtle [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" @click="stepDate(1)">
            <svg width="7" height="11" viewBox="0 0 7 11" fill="none"><path d="M1 1L6 5.5L1 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        </div>
        <span class="text-[13.5px] font-[560] text-ink-700">{{ rangeLabel }}</span>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <select v-model="viewMode" :aria-label="t('View', 'Vista')" class="h-8 touch:h-11 rounded-ctlSm border border-line-control bg-surface px-2 text-[12.5px] font-medium text-ink-600 hover:border-line-controlHover focus:border-brand focus:outline-none [@media(pointer:coarse)]:h-11">
          <option value="day">{{ t('Day', 'Día') }}</option>
          <option value="workweek">{{ t('Work week', 'Semana laboral') }}</option>
          <option value="week">{{ t('Week', 'Semana') }}</option>
        </select>
        <UiBtn v-if="can('payments_allocate')" variant="secondary" size="sm" @click="cashShiftOpen = true">{{ t('Cash Shift', 'Turno de Caja') }}</UiBtn>
        <template v-if="!readOnly">
          <span v-if="bookingFor" class="inline-flex h-8 items-center gap-1.5 rounded-pill bg-brand-tint pl-3 pr-1.5 text-[12.5px] font-semibold text-brand-text" data-cy="booking-for">
            {{ t(`Booking for ${bookingFor.name} · pick a time`, `Reservando para ${bookingFor.name} · elige una hora`) }}
            <button
              type="button"
              class="inline-flex h-5 w-5 items-center justify-center rounded-pill hover:bg-surface"
              :aria-label="t('Stop booking for this patient', 'Dejar de reservar para este paciente')"
              data-cy="booking-for-clear"
              @click="stopBookingFor"
            >&times;</button>
          </span>
          <UiBtn variant="secondary" size="sm" @click="openBlockCreateModal()">{{ t('Block time', 'Bloquear horario') }}</UiBtn>
          <UiBtn variant="primary" size="sm" data-cy="new-appointment" @click="openCreateModal()">{{ t('+ New Appointment', '+ Nueva Cita') }}</UiBtn>
        </template>
        <span v-else class="inline-flex h-8 items-center rounded-pill bg-chip-bg px-3 text-[12.5px] font-semibold text-chip-text" data-cy="calendar-read-only">{{ t('Read-only', 'Solo lectura') }}</span>
        <!-- The mini-calendar/display panel is a fixed 238px column at lg+
        (below), but that plus the optional flow-tracker column would eat
        most of a phone's width -- so below lg it's an off-canvas drawer
        instead, reached from here. -->
        <button
          type="button"
          class="flex h-8 touch:h-11 items-center gap-1 rounded-ctlSm border border-line-control px-2.5 text-[12.5px] font-medium text-ink-600 hover:border-line-controlHover hover:bg-surface-subtle lg:hidden [@media(pointer:coarse)]:h-11"
          @click="mobileInfoOpen = true"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="7" cy="7" r="5.3" /><path d="M7 6.3v3.4M7 4.3v.15" stroke-linecap="round" /></svg>
          {{ t('Info', 'Info') }}
        </button>
      </div>
    </header>

    <!-- One tab per practitioner, plus the whole clinic and the visits with
         no practitioner at all. Until the team has loaded, placeholder tabs:
         the "no practitioners" line below used to flash on every visit. -->
    <div v-if="!referenceLoaded && !showAgenda" data-cy="practitioner-tabs-loading" class="flex h-9 shrink-0 items-center gap-1 overflow-hidden border-b border-line bg-surface px-4 lg:px-6 [@media(pointer:coarse)]:h-12" aria-busy="true">
      <UiSkeleton v-for="w in [96, 64, 112, 88, 104]" :key="w" class="mx-1.5 h-3.5 shrink-0 rounded-ctlSm" :style="{ width: `${w}px` }" />
    </div>
    <div v-else-if="clinicTeamMembers.length > 0 && !showAgenda" data-testid="practitioner-tabs" class="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-4 lg:px-6 [@media(pointer:coarse)]:h-12">
      <button
        type="button"
        data-testid="practitioner-tab-all"
        class="h-8 shrink-0 rounded-ctlSm px-3 text-[12.5px] font-medium transition-colors touch:h-11"
        :class="practitionerFilter === ALL_PRACTITIONERS ? 'bg-brand text-white' : 'text-ink-600 hover:bg-surface-subtle'"
        :aria-pressed="practitionerFilter === ALL_PRACTITIONERS"
        @click="practitionerFilter = ALL_PRACTITIONERS"
      >
        {{ t('Whole clinic', 'Toda la clínica') }}
      </button>
      <span class="mx-1 h-4 w-px shrink-0 bg-line" aria-hidden="true" />
      <button
        v-for="m in clinicTeamMembers"
        :key="m.id"
        type="button"
        data-testid="practitioner-tab"
        class="flex h-8 shrink-0 items-center gap-1.5 rounded-ctlSm px-3 text-[12.5px] font-medium transition-colors touch:h-11"
        :class="practitionerFilter === m.id ? 'bg-brand text-white' : 'text-ink-600 hover:bg-surface-subtle'"
        :aria-pressed="practitionerFilter === m.id"
        @click="practitionerFilter = m.id"
      >
        {{ m.full_name }}
      </button>
      <button
        type="button"
        data-testid="practitioner-tab-unassigned"
        class="h-8 shrink-0 rounded-ctlSm px-3 text-[12.5px] font-medium transition-colors touch:h-11"
        :class="practitionerFilter === UNASSIGNED_PRACTITIONER ? 'bg-brand text-white' : 'text-ink-faint hover:bg-surface-subtle'"
        :aria-pressed="practitionerFilter === UNASSIGNED_PRACTITIONER"
        @click="practitionerFilter = UNASSIGNED_PRACTITIONER"
      >
        {{ t('No practitioner', 'Sin profesional') }}
      </button>
    </div>
    <div v-else-if="!showAgenda" class="flex h-9 shrink-0 items-center border-b border-line bg-surface px-6 text-[12.5px] text-ink-faint">
      No practitioners are assigned to this clinic yet.
    </div>

    <div v-if="reschedulingAppointment" class="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-line bg-brand-tint px-6">
      <p class="truncate text-[13px] text-brand-text">
        <span class="font-semibold">{{ t('Rescheduling', 'Reprogramando') }}</span>
        {{ reschedulingAppointment.patientName }}<template v-if="reschedulingAppointment.appointmentTypeName"> · {{ reschedulingAppointment.appointmentTypeName }}</template> —
        {{ t('navigate to any day and click an open slot to move it there.', 'navega a cualquier día y haz clic en un hueco libre para moverla ahí.') }}
      </p>
      <button type="button" class="shrink-0 rounded-ctlSm border border-brand/30 px-2.5 py-1 text-[12.5px] font-medium text-brand-text hover:bg-surface" @click="cancelRescheduleMode">
        {{ t('Cancel', 'Cancelar') }}
      </button>
    </div>

    <!-- The day, counted. Each chip is a filter: it dims every block that
         does not match, so the day keeps its shape while one kind stands out.
         This is what "Today at a glance" used to be, moved to where the eye
         already is and made to do something. -->
    <div v-if="store.currentClinicId && loading && !showAgenda" class="flex shrink-0 items-center gap-2 overflow-hidden border-b border-line bg-surface px-4 py-1.5 lg:px-6" aria-busy="true">
      <UiSkeleton class="mr-1 h-4 w-24 shrink-0 rounded-ctlSm" />
      <UiSkeleton v-for="w in [118, 96, 132]" :key="w" class="h-9 shrink-0 rounded-full [@media(pointer:coarse)]:h-11" :style="{ width: `${w}px` }" />
    </div>
    <div v-else-if="store.currentClinicId && !showAgenda" data-cy="day-counts" class="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-surface px-4 py-1.5 lg:px-6">
      <span class="shrink-0 pr-1 text-[13px] text-ink-muted" data-cy="day-counts-total"><strong class="font-semibold text-ink-900">{{ rangeCounts.total }}</strong> {{ countsNoun }}</span>
      <button
        v-for="c in countChips"
        :key="c.key"
        type="button"
        :data-cy="`day-filter-${c.key}`"
        :aria-pressed="stageFilter === c.key"
        class="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors [@media(pointer:coarse)]:h-11"
        :class="stageFilter === c.key ? 'border-[1.5px] border-brand bg-brand-tint text-brand-text' : 'border border-line-control bg-surface text-ink-700 hover:border-line-controlHover'"
        @click="toggleStageFilter(c.key)"
      >
        <span class="h-2 w-2 shrink-0 rounded-full" :class="FILTER_DOT_CLASS[c.key]" aria-hidden="true" />
        <strong class="font-semibold">{{ c.n }}</strong>{{ c.label }}
      </button>
      <span class="grow" />
      <button
        v-if="stageFilter"
        type="button"
        data-cy="day-filter-clear"
        class="h-9 shrink-0 rounded-full px-3 text-[13px] font-medium text-brand-text hover:bg-brand-tint [@media(pointer:coarse)]:h-11"
        @click="stageFilter = null"
      >
        {{ t('Show all', 'Ver todas') }}
      </button>
    </div>

    <div class="flex flex-1 overflow-hidden">
      <div v-if="mobileInfoOpen" class="fixed inset-0 z-30 bg-black/40 lg:hidden" @click="mobileInfoOpen = false" />

      <!-- Left panel: mini month, display toggles, stage key. Off-canvas
      below lg (see the Info button above); a permanent column at lg+. -->
      <aside
        class="fixed inset-y-0 left-0 z-40 w-[280px] shrink-0 overflow-y-auto border-r border-line bg-surface-sidebar transition-transform duration-200 lg:static lg:z-auto lg:w-[238px] lg:translate-x-0"
        :class="mobileInfoOpen ? 'translate-x-0' : '-translate-x-full'"
      >
        <div class="flex items-center justify-between px-3 pt-3 lg:hidden">
          <span class="text-[12.5px] font-[640] text-ink-900">{{ t('Calendar info', 'Info del calendario') }}</span>
          <button type="button" :aria-label="t('Close', 'Cerrar')" class="flex h-9 touch:h-11 w-9 touch:w-11 items-center justify-center rounded-ctlSm text-ink-muted2 hover:bg-surface-subtle" @click="mobileInfoOpen = false">
            <svg width="13" height="13" viewBox="0 0 14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 2l10 10M12 2L2 12" /></svg>
          </button>
        </div>
        <div class="m-3 rounded-card border border-line bg-surface p-3">
          <div class="flex items-center justify-between">
            <button type="button" :aria-label="t('Previous month', 'Mes anterior')" class="rounded-ctlSm p-1 text-ink-faint hover:bg-surface-subtle hover:text-ink-600" @click="miniBase = addMonths(miniBase, -1)">‹</button>
            <span class="text-[12.5px] font-[640] text-ink-900">{{ miniMonthLabel }}</span>
            <button type="button" :aria-label="t('Next month', 'Mes siguiente')" class="rounded-ctlSm p-1 text-ink-faint hover:bg-surface-subtle hover:text-ink-600" @click="miniBase = addMonths(miniBase, 1)">›</button>
          </div>
          <div class="mt-2 grid grid-cols-7 gap-y-1 text-center">
            <span v-for="d in miniWeekdayAbbrevs" :key="d" class="text-[10px] font-medium uppercase text-ink-faint">{{ d }}</span>
            <template v-for="(cell, i) in miniGrid" :key="i">
              <button
                v-if="cell"
                type="button"
                class="mx-auto flex h-6 w-6 items-center justify-center rounded-full text-[11px]"
                :class="[
                  isSameDate(cell, new Date()) ? 'bg-brand font-semibold text-white' : isSameDate(cell, anchorDate) ? 'font-semibold text-brand-text ring-1 ring-inset ring-brand' : 'text-ink-600 hover:bg-surface-subtle',
                ]"
                @click="selectMiniDate(cell)"
              >
                {{ cell.getDate() }}
              </button>
              <span v-else></span>
            </template>
          </div>
        </div>

        <!-- Who is in the building and the step each needs next. Inside this
             panel rather than as a column of its own: a 220px column took
             that width from the grid, and at 1440px the room columns fell to
             ~197px -- narrow enough that blocks started dropping the
             clinical-note icon. Here it costs the grid nothing, and it comes
             along into the off-canvas drawer below lg. -->
        <div v-if="settings.flowTracker" data-cy="flow-tracker" :aria-label="t('Flow tracker', 'Seguimiento de flujo')" role="region" class="mx-3 mb-3">
          <CalendarFlowTracker :rows="flowRows" :privacy="settings.privacyMode" :loading="!todayLoaded" @advance="advanceFromFlow" @open="openFromFlow" />
        </div>

        <div data-cy="today-glance" class="mx-3 mb-3 rounded-card border border-line bg-surface p-3">
          <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-faint">{{ t('Today at a glance', 'Hoy de un vistazo') }}</p>
          <div class="mt-2 space-y-1.5">
            <div v-for="row in glanceRows" :key="row.key" :data-cy="`glance-${row.key}`" class="flex items-center justify-between text-[12.5px]">
              <span :class="row.key === 'booked' ? 'text-ink-600' : row.tone">{{ row.label }}</span>
              <UiSkeleton v-if="!todayLoaded" class="h-3.5 rounded-ctlSm" :class="row.key === 'booked' ? 'w-6' : 'w-14'" />
              <span v-else class="font-mono text-[12.5px] font-medium" :class="row.tone">{{ row.value }}</span>
            </div>
          </div>
        </div>

        <div class="mx-3 rounded-card border border-line bg-surface p-3">
          <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-faint">{{ t('Display', 'Visualización') }}</p>
          <div class="mt-2 space-y-2.5">
            <div v-for="toggle in displayToggles" :key="toggle.key" class="flex items-center justify-between gap-2">
              <span class="text-[12.5px] text-ink-600">{{ toggle.label }}</span>
              <button
                type="button"
                role="switch"
                :aria-checked="settings[toggle.key]"
                :aria-label="toggle.label"
                :data-cy="`display-${toggle.key}`"
                class="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors"
                :class="settings[toggle.key] ? 'bg-brand' : 'bg-toggle-off'"
                @click="settings[toggle.key] = !settings[toggle.key]"
              >
                <span class="inline-block h-3 w-3 transform rounded-full bg-white transition-transform" :class="settings[toggle.key] ? 'translate-x-[14px]' : 'translate-x-0.5'" />
              </button>
            </div>
          </div>
        </div>

        <div class="m-3 rounded-card border border-line bg-surface p-3">
          <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-faint">{{ t('Stage key', 'Leyenda de estados') }}</p>
          <p class="mt-1 text-[11.5px] leading-snug text-ink-muted">{{ t('Dashed border: not confirmed yet. Red: money owed.', 'Borde discontinuo: sin confirmar. Rojo: dinero pendiente.') }}</p>
          <div class="mt-2 space-y-1.5">
            <div v-for="stage in STAGE_KEY" :key="stage" class="flex items-center gap-2 text-[12.5px] text-ink-600">
              <span
                class="h-3 w-4 shrink-0 rounded-[3px]"
                :class="['pending', 'online'].includes(stage) ? 'border-[1.5px] border-dashed border-ink-faint' : stage === 'resched' ? 'border-[1.5px] border-dashed border-warning-accent bg-warning-bg' : stage === 'completed' ? 'border border-line bg-surface-subtle' : stage === 'noshow' ? 'border border-line-control bg-chip-bg' : 'border border-line-control bg-brand-tint'"
                aria-hidden="true"
              />
              <span class="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold" :class="STAGE_TONE_CLASS[STAGE_TONE[stage]]">
                <CalendarStageIcon :stage="stage" />{{ stageLabel(stage) }}
              </span>
            </div>
          </div>
        </div>
      </aside>

      <!-- Main content -->
      <!-- Each view below is its own scroller, both ways. The room and day
           headers are sticky, and sticky only works against the element that
           actually scrolls: while this div scrolled vertically and the views
           only horizontally, the headers stuck to a box that never moved and
           scrolled away with the grid. -->
      <div ref="scrollAreaRef" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div v-if="!store.currentClinicId" class="p-6 text-[13px] text-ink-faint">
          {{ t('No clinic selected.', 'Ninguna clínica seleccionada.') }}
        </div>

        <div v-else-if="showAgenda && loading" class="space-y-2 overflow-hidden p-3" aria-busy="true">
          <UiSkeleton class="mb-3 h-10 rounded-ctl" />
          <UiSkeleton v-for="row in 6" :key="row" class="rounded-ctl" :class="row % 3 === 1 ? 'h-[72px]' : 'h-14'" />
        </div>

        <!-- Before the rooms are known: the grid's own shape -- the hours,
             the day or week's columns, placeholder visits -- so nothing moves
             when it arrives. After that the real grid stays up and only its
             contents are placeholders while a range loads (below). -->
        <div v-else-if="!showAgenda && !referenceLoaded" class="flex min-h-0 min-w-0 flex-1 overflow-hidden" aria-busy="true" data-cy="calendar-skeleton">
          <div class="w-[58px] shrink-0 border-r border-line">
            <div class="border-b border-line" :style="{ height: `${viewMode === 'day' ? DAY_HEADER_PX : WEEK_HEADER_PX}px` }" />
            <div class="relative" :style="{ height: `${viewMode === 'day' ? dayGridHeight : weekGridHeight}px` }">
              <span v-for="h in hourMarks" :key="h" class="absolute left-0 right-0 px-2 font-mono text-[11px] text-ink-faint" :style="{ top: `${Math.max(0, (h - START_HOUR) * hourPxForView() - 7)}px` }">{{ hourLabel(h) }}</span>
            </div>
          </div>
          <div v-for="(day, i) in skeletonColumns" :key="i" class="flex min-w-0 flex-1 flex-col border-r border-line last:border-r-0">
            <div class="flex shrink-0 flex-col items-center justify-center gap-1.5 border-b border-line" :style="{ height: `${viewMode === 'day' ? DAY_HEADER_PX : WEEK_HEADER_PX}px` }">
              <span v-if="day" class="text-[12.5px] font-medium text-ink-900">{{ formatWeekdayDate(day) }}</span>
              <UiSkeleton class="h-3 w-20 rounded-ctlSm" />
            </div>
            <div class="relative" :style="{ height: `${viewMode === 'day' ? dayGridHeight : weekGridHeight}px` }">
              <div v-for="h in hourMarks" :key="h" class="absolute left-0 right-0 border-t border-line" :style="{ top: `${(h - START_HOUR) * hourPxForView()}px` }" />
              <UiSkeleton v-for="(b, j) in skeletonBlocks(i, hourPxForView())" :key="j" class="absolute left-1 right-1 rounded-ctl" :style="{ top: `${b.top}px`, height: `${b.height}px` }" />
            </div>
          </div>
        </div>

        <CalendarPhoneAgenda
          v-else-if="showAgenda"
          :items="agendaItems"
          :scope="agendaScope"
          :can-scope-mine="!!myPractitionerId"
          :counts="agendaCounts"
          :privacy="settings.privacyMode"
          :now="now"
          :is-today="isSameDate(anchorDate, now)"
          @open="openAgendaItem"
          @scope="setAgendaScope"
          :can-create="!readOnly"
          @create="openCreateModal()"
        />

        <!-- The grid takes keyboard focus as one stop; arrow keys then move a
             cell cursor across rooms, days and slots (onGridKeydown). -->
        <div
          v-else
          ref="gridRef"
          tabindex="0"
          role="group"
          data-cy="calendar-grid"
          :aria-busy="loading || undefined"
          :aria-label="t('Calendar grid. Arrow keys move between slots; Enter books a free slot or opens an appointment.', 'Calendario. Las flechas mueven entre huecos; Intro reserva un hueco libre o abre una cita.')"
          class="flex min-h-0 min-w-0 flex-1 flex-col outline-none"
          @focus="onGridFocus"
          @blur="onGridBlur"
          @keydown="onGridKeydown"
        >
          <span class="sr-only" aria-live="polite">{{ focusAnnouncement }}</span>

          <!-- Day view: room columns -->
          <div v-if="viewMode === 'day'" class="min-h-0 min-w-0 flex-1 overflow-auto" data-cy="grid-scroller">
            <div :style="{ minWidth: `${58 + dayColumns.length * 220}px` }">
              <div class="sticky top-0 z-30 flex bg-surface">
                <div class="sticky left-0 z-10 h-10 w-[58px] shrink-0 border-b border-r border-line bg-surface"></div>
                <div v-for="col in dayColumns" :key="col.id" class="flex h-10 flex-1 flex-col items-center justify-center border-b border-r border-line last:border-r-0">
                  <span class="text-[13px] font-semibold text-ink-900">{{ col.name }}</span>
                  <span v-if="!loading && roomPractitionerLabel(col.id)" class="text-[11.5px] leading-none text-ink-muted2">{{ roomPractitionerLabel(col.id) }}</span>
                </div>
              </div>

              <div class="relative flex" :style="{ height: `${dayGridHeight}px` }">
                <div class="sticky left-0 z-[25] w-[58px] shrink-0 border-r border-line bg-surface">
                  <!-- In the gutter, which stays put when the rooms scroll sideways. -->
                  <span v-if="showNowLine" class="pointer-events-none absolute left-1 z-10 -translate-y-1/2 rounded-full bg-danger-text px-1.5 py-px font-mono text-[10.5px] font-semibold leading-4 text-surface" data-cy="now-label" :style="{ top: `${nowLinePx}px` }">{{ formatTime(now) }}</span>
                  <span
                    v-for="h in hourMarks"
                    :key="h"
                    class="pointer-events-none absolute left-0 right-0 px-2 font-mono text-[11px] text-ink-faint"
                    :style="{ top: `${Math.max(0, (h - START_HOUR) * DAY_HOUR_PX - 7)}px` }"
                  >
                    {{ hourLabel(h) }}
                  </span>
                  <span
                    v-for="m in slotMarks"
                    :key="`slot-label-${m}`"
                    class="pointer-events-none absolute left-0 right-0 px-2 font-mono text-[9.5px] text-ink-faint2"
                    :style="{ top: `${Math.max(0, (m / 60) * DAY_HOUR_PX - 6)}px` }"
                  >
                    {{ slotLabel(m) }}
                  </span>
                </div>

                <div
                  v-for="(col, ci) in dayColumns"
                  :key="col.id"
                  data-cal-col
                  :data-room-id="col.id"
                  :data-day-key="toDateKey(anchorDate)"
                  class="relative flex-1 cursor-pointer border-r border-line last:border-r-0"
                  :class="{ 'pointer-events-none': loading }"
                  @pointerdown="onColumnPointerDown"
                  @pointermove="onColumnPointerMove($event, toDateKey(anchorDate), col.id, DAY_HOUR_PX)"
                  @pointerleave="hoverCell = null"
                  @click="onColumnClick($event, anchorDate, col.id, DAY_HOUR_PX)"
                >
                  <div v-for="rect in closedRectsFor(anchorDate)" :key="rect.top" data-cy="closed-hours" class="cal-hatch pointer-events-none absolute left-0 right-0 flex items-start px-2 pt-1.5 text-[12px] text-ink-muted" :style="{ top: `${rect.top}px`, height: `${rect.height}px` }">
                    <span v-if="rect.height >= 28">{{ t('Nobody working', 'Fuera de horario') }}</span>
                  </div>
                  <div v-for="m in slotMarks" :key="`slot-${m}`" class="pointer-events-none absolute left-0 right-0 border-t border-dashed border-line-divider" :style="{ top: `${(m / 60) * DAY_HOUR_PX}px` }" />
                  <div v-for="h in hourMarks" :key="h" class="pointer-events-none absolute left-0 right-0 border-t border-line" :style="{ top: `${(h - START_HOUR) * DAY_HOUR_PX}px` }" />

                  <!-- A range loading: placeholders where the visits go, and
                       nothing to click until it is known what is free. -->
                  <template v-if="loading">
                    <UiSkeleton v-for="(b, j) in skeletonInColumn(col.id) ? skeletonBlocks(ci, DAY_HOUR_PX, anchorDate) : []" :key="`sk-${j}`" class="absolute left-1 right-1 rounded-ctl" :style="{ top: `${b.top}px`, height: `${b.height}px` }" />
                  </template>
                  <template v-else>

                  <div
                    v-for="block in blocksForRoom(col.id)"
                    :key="block.id"
                    class="cal-blocked absolute left-1 right-1 z-0 flex cursor-pointer items-center justify-center gap-1.5 overflow-hidden rounded-ctl border border-line text-[12px] text-ink-muted"
                    :style="{ top: `${timeToPx(block.starts_at, DAY_HOUR_PX) + 1}px`, height: `${durationToPx(block.starts_at, block.ends_at, DAY_HOUR_PX, DAY_MIN_AVAILABILITY_PX) - 3}px` }"
                    @click.stop="openBlockEditModal(block)"
                  >
                    <strong class="font-semibold text-ink-700">{{ blockLabel(block) }}</strong>
                  </div>

                  <div
                    v-for="o in freedSlotsFor(toDateKey(anchorDate), col.id)"
                    :key="o.id"
                    data-cy="freed-slot"
                    role="note"
                    class="absolute left-1 right-1 z-[5] flex cursor-default items-center gap-1.5 overflow-hidden rounded-ctl border-[1.5px] border-dashed border-success-accent bg-success-bg px-2.5 text-[12px] text-success-text"
                    :style="{ top: `${timeToPx(o.offered_starts_at, DAY_HOUR_PX) + 1}px`, height: `${durationToPx(o.offered_starts_at, o.offered_ends_at ?? o.offered_starts_at, DAY_HOUR_PX, DAY_MIN_BLOCK_PX) - 3}px` }"
                    @click.stop
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0" aria-hidden="true"><path d="M4 12h16M14 6l6 6-6 6" /></svg>
                    <strong class="truncate font-semibold">{{ freedSlotLabel(o) }}</strong>
                    <span class="truncate text-ink-muted">· {{ freedSlotUntil(o) }}</span>
                  </div>

                  <template v-for="(appt, i) in layoutForRoomOnDay(anchorDate, col.id)" :key="isOverflowBlock(appt) ? `overflow-${col.id}-${i}` : appt.id">
                    <div
                      v-if="isOverflowBlock(appt)"
                      class="absolute flex items-center justify-center overflow-hidden rounded-[7px] border border-line bg-surface text-[10.5px] font-medium text-ink-muted2 shadow-card"
                      :title="`${appt.count} ${appt.count === 1 ? t('more appointment', 'cita más') : t('more appointments', 'citas más')} ${t('at this time', 'a esta hora')}`"
                      :style="columnStyle(appt, timeToPx(appt.starts_at, DAY_HOUR_PX), OVERFLOW_CHIP_PX)"
                    >
                      +{{ appt.count }} {{ t('more', 'más') }}
                    </div>
                    <div
                      v-else-if="appt._movedFrom"
                      data-cy="moved-away-marker"
                      :data-appt-id="appt._movedFrom.id"
                      class="absolute cursor-pointer"
                      :style="columnStyle(appt, timeToPx(appt.starts_at, DAY_HOUR_PX) + 1, Math.max(0, durationToPx(appt.starts_at, appt.ends_at, DAY_HOUR_PX, DAY_MIN_BLOCK_PX) - 3))"
                      :title="`${movedMarkerName(appt)} · ${movedMarkerLabel(appt)}`"
                      @click.stop="openEditModal(appt._movedFrom)"
                    >
                      <div class="flex h-full flex-col overflow-hidden rounded-ctl border border-dashed border-line-control bg-surface-page px-2.5 py-1 text-[12px] leading-tight text-ink-muted opacity-60 hover:opacity-90">
                        <span class="truncate font-semibold">{{ movedMarkerName(appt) }}</span>
                        <span class="truncate">{{ movedMarkerLabel(appt) }}</span>
                      </div>
                    </div>
                    <div
                      v-else
                      data-cy="appt-block"
                      :data-appt-id="appt.id"
                      :data-stage="stageOf(appt)"
                      :data-dimmed="isDimmed(appt) || undefined"
                      class="absolute scroll-mt-10"
                      :class="appt.status === 'booked' ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'"
                      :style="columnStyle(appt, timeToPx(appt.starts_at, DAY_HOUR_PX) + 1, Math.max(0, durationToPx(appt.starts_at, appt.ends_at, DAY_HOUR_PX, DAY_MIN_BLOCK_PX) - 3))"
                      @pointerdown="startAppointmentDrag(appt, 'move', $event)"
                      @click.stop="handleAppointmentClick(appt)"
                      @pointerenter="onBlockPointerEnter(appt, $event)"
                      @pointerleave="cancelHoverShow"
                    >
                      <CalendarAppointmentBlock
                        :view="blockView(appt)"
                        density="day"
                        :height="Math.max(0, durationToPx(appt.starts_at, appt.ends_at, DAY_HOUR_PX, DAY_MIN_BLOCK_PX) - 3)"
                        :selected="selectedApptId === appt.id"
                        :dim="isDimmed(appt)"
                        :privacy="settings.privacyMode"
                      />
                      <div
                        v-if="appt.status === 'booked'"
                        class="absolute inset-x-0 bottom-0 h-[6px] cursor-ns-resize"
                        @pointerdown.stop="startAppointmentDrag(appt, 'resize', $event)"
                      ></div>
                    </div>
                  </template>

                  <template v-for="g in [ghostFor(toDateKey(anchorDate), col.id)]" :key="`ghost-${col.id}`">
                    <div
                      v-if="g && g.free"
                      data-cy="slot-ghost"
                      class="pointer-events-none absolute left-1 right-1 z-[15] flex items-center gap-1.5 rounded-ctl border-2 border-brand bg-surface px-2.5 text-[13px] font-semibold text-brand-text"
                      :style="{ top: `${(g.min / 60) * DAY_HOUR_PX + 1}px`, height: `${(SLOT_MIN / 60) * DAY_HOUR_PX - 3}px` }"
                    >
                      + {{ t(`Book ${g.label}`, `Reservar ${g.label}`) }}<span class="font-normal text-ink-muted"> · {{ t('Enter', 'Intro') }}</span>
                    </div>
                  </template>
                  <template v-for="g in [createGhostFor(toDateKey(anchorDate), col.id)]" :key="`new-${col.id}`">
                    <div
                      v-if="g"
                      data-cy="create-ghost"
                      class="pointer-events-none absolute left-1 right-1 z-[15] flex items-center rounded-ctl bg-brand px-2.5 text-[13px] font-semibold text-surface shadow-[0_0_0_3px_rgb(var(--color-brand-tint))]"
                      :style="{ top: `${(g.min / 60) * DAY_HOUR_PX + 1}px`, height: `${(SLOT_MIN / 60) * DAY_HOUR_PX - 3}px` }"
                    >
                      {{ t(`New appointment · ${g.label}`, `Nueva cita · ${g.label}`) }}
                    </div>
                  </template>
                  </template>
                  <template v-for="r in [focusRectFor(toDateKey(anchorDate), col.id, DAY_HOUR_PX)]" :key="`focus-${col.id}`">
                    <div v-if="r" data-grid-focus class="pointer-events-none absolute left-0.5 right-0.5 z-[16] rounded-ctl ring-2 ring-inset ring-brand/60" :style="{ top: `${r.top}px`, height: `${r.height}px` }" />
                  </template>
                </div>

                <div v-if="showNowLine" data-cy="now-line" class="pointer-events-none absolute left-0 right-0 z-20" :style="{ top: `${nowLinePx}px` }">
                  <div class="absolute left-[58px] top-0 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-danger-text"></div>
                  <div class="ml-[58px] h-0.5 -translate-y-1/2 bg-danger-text"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Week view: day columns, each split into room sub-columns like Day view. -->
          <div v-else class="min-h-0 min-w-0 flex-1 overflow-auto" data-cy="grid-scroller">
            <div class="flex" :style="{ minWidth: `${58 + visibleWeekDays.length * dayColumns.length * WEEK_ROOM_COL_PX}px` }">
              <div class="sticky left-0 z-[25] w-[58px] shrink-0 bg-surface">
                <div class="sticky top-0 z-30 border-b border-r border-line bg-surface" :style="{ height: `${WEEK_HEADER_PX}px` }"></div>
                <div class="relative border-r border-line" :style="{ height: `${weekGridHeight}px` }">
                  <span v-if="showWeekNowLabel" class="pointer-events-none absolute left-1 z-20 -translate-y-1/2 rounded-full bg-danger-text px-1.5 py-px font-mono text-[10.5px] font-semibold leading-4 text-surface" data-cy="now-label" :style="{ top: `${nowLineWeekPx}px` }">{{ formatTime(now) }}</span>
                  <span
                    v-for="h in hourMarks"
                    :key="h"
                    class="pointer-events-none absolute left-0 right-0 px-2 font-mono text-[11px] text-ink-faint"
                    :style="{ top: `${Math.max(0, (h - START_HOUR) * WEEK_HOUR_PX - 7)}px` }"
                  >
                    {{ hourLabel(h) }}
                  </span>
                  <span
                    v-for="m in slotMarks"
                    :key="`slot-label-${m}`"
                    class="pointer-events-none absolute left-0 right-0 px-2 font-mono text-[9px] text-ink-faint2"
                    :style="{ top: `${Math.max(0, (m / 60) * WEEK_HOUR_PX - 5)}px` }"
                  >
                    {{ slotLabel(m) }}
                  </span>
                </div>
              </div>

              <div v-for="(day, di) in visibleWeekDays" :key="toDateKey(day)" class="flex flex-1 flex-col border-r border-line last:border-r-0">
                <div class="sticky top-0 z-30 bg-surface">
                  <div
                    class="relative flex h-6 items-center justify-center gap-1"
                    :class="isSameDate(day, new Date()) ? 'bg-brand-tintDeep' : ''"
                  >
                    <span class="text-[11px] font-semibold uppercase tracking-[.04em] text-ink-muted2">{{ formatWeekdayDate(day).split(' ')[0] }}</span>
                    <span class="text-[12.5px] font-medium" :class="isSameDate(day, new Date()) ? 'text-brand-text' : 'text-ink-900'">{{ day.getDate() }}</span>
                    <button v-if="!readOnly" type="button" :aria-label="t('New appointment on this day', 'Nueva cita este día')" class="absolute right-1 top-0.5 text-[11px] text-ink-faint hover:text-brand-text" @click.stop="openCreateModalForDay(day)">+</button>
                  </div>
                  <!-- Per-day counts: the two that need someone to act. -->
                  <div class="flex h-[18px] items-center justify-center gap-2 border-b border-line text-[10.5px] text-ink-muted" data-cy="day-header-counts" :class="isSameDate(day, new Date()) ? 'bg-brand-tintDeep' : ''">
                    <UiSkeleton v-if="loading" class="h-2.5 w-16 rounded-ctlSm" />
                    <template v-else>
                      <template v-for="c in [dayHeaderCounts(day)]" :key="`c-${toDateKey(day)}`">
                        <span v-if="c.unconfirmed > 0" class="inline-flex items-center gap-1 text-warning-text"><span class="h-1.5 w-1.5 rounded-full bg-warning-accent" />{{ t(`${c.unconfirmed} unconfirmed`, `${c.unconfirmed} sin confirmar`) }}</span>
                        <span v-if="c.owe > 0" class="inline-flex items-center gap-1 text-danger-text"><span class="h-1.5 w-1.5 rounded-full bg-danger-text" />{{ t(`${c.owe} owe`, `${c.owe} deben`) }}</span>
                      </template>
                    </template>
                  </div>
                  <div class="flex h-[26px] border-b border-line">
                    <div
                      v-for="col in dayColumns"
                      :key="col.id"
                      class="flex flex-1 items-center justify-center truncate border-r border-line-divider px-1 text-[10.5px] font-medium text-ink-muted2 last:border-r-0"
                      :style="{ minWidth: `${WEEK_ROOM_COL_PX}px` }"
                    >
                      {{ col.name }}
                    </div>
                  </div>
                </div>

                <div class="relative flex" :style="{ height: `${weekGridHeight}px` }">
                  <div v-if="showNowLineOn(day)" data-cy="now-line" class="pointer-events-none absolute inset-x-0 z-20" :style="{ top: `${nowLineWeekPx}px` }">
                    <div class="absolute left-0 top-0 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-danger-text"></div>
                    <div class="h-0.5 -translate-y-1/2 bg-danger-text"></div>
                  </div>
                  <div
                    v-for="(col, ci) in dayColumns"
                    :key="col.id"
                    data-cal-col
                    :data-room-id="col.id"
                    :data-day-key="toDateKey(day)"
                    class="relative flex-1 cursor-pointer border-r border-line-divider last:border-r-0"
                    :class="{ 'pointer-events-none': loading }"
                    :style="{ minWidth: `${WEEK_ROOM_COL_PX}px` }"
                    @pointerdown="onColumnPointerDown"
                    @pointermove="onColumnPointerMove($event, toDateKey(day), col.id, WEEK_HOUR_PX)"
                    @pointerleave="hoverCell = null"
                    @click="onColumnClick($event, day, col.id, WEEK_HOUR_PX)"
                  >
                    <div v-for="rect in closedRectsFor(day)" :key="rect.top" data-cy="closed-hours" class="cal-hatch pointer-events-none absolute left-0 right-0" :style="{ top: `${rect.top}px`, height: `${rect.height}px` }" />
                    <div v-for="m in slotMarks" :key="`slot-${m}`" class="pointer-events-none absolute left-0 right-0 border-t border-dashed border-line-divider" :style="{ top: `${(m / 60) * WEEK_HOUR_PX}px` }" />
                    <div v-for="h in hourMarks" :key="h" class="pointer-events-none absolute left-0 right-0 border-t border-line" :style="{ top: `${(h - START_HOUR) * WEEK_HOUR_PX}px` }" />

                    <template v-if="loading">
                      <UiSkeleton v-for="(b, j) in skeletonInColumn(col.id) ? skeletonBlocks(di + ci, WEEK_HOUR_PX, day) : []" :key="`sk-${j}`" class="absolute left-0.5 right-0.5 rounded-[6px]" :style="{ top: `${b.top}px`, height: `${b.height}px` }" />
                    </template>
                    <template v-else>

                    <!--
                      Clickable, exactly as in Day view above -- this is the only
                      way to reach the block's Remove button, and `workweek` is
                      the default view, so while this was `pointer-events-none`
                      a block could not be removed at all without first switching
                      to Day. Worse than inert: the click fell through to the
                      cell underneath and opened New Appointment on a slot that
                      was deliberately blocked off.
                    -->
                    <div
                      v-for="block in blocksForRoomOnDay(day, col.id)"
                      :key="block.id"
                      class="cal-blocked absolute left-0.5 right-0.5 z-0 flex cursor-pointer items-center justify-center overflow-hidden rounded-[6px] border border-line font-mono text-[10px] text-ink-muted2"
                      :style="{ top: `${timeToPx(block.starts_at, WEEK_HOUR_PX)}px`, height: `${durationToPx(block.starts_at, block.ends_at, WEEK_HOUR_PX, WEEK_MIN_AVAILABILITY_PX)}px` }"
                      :title="blockLabel(block)"
                      @click.stop="openBlockEditModal(block)"
                    >
                      {{ t('Blocked', 'Bloqueado') }}
                    </div>

                    <div
                      v-for="o in freedSlotsFor(toDateKey(day), col.id)"
                      :key="o.id"
                      data-cy="freed-slot"
                      role="note"
                      class="absolute left-0.5 right-0.5 z-[5] flex cursor-default items-center overflow-hidden rounded-[6px] border-[1.5px] border-dashed border-success-accent bg-success-bg px-1 text-[10.5px] font-semibold text-success-text"
                      :title="`${freedSlotLabel(o)} · ${freedSlotUntil(o)}`"
                      :style="{ top: `${timeToPx(o.offered_starts_at, WEEK_HOUR_PX)}px`, height: `${durationToPx(o.offered_starts_at, o.offered_ends_at ?? o.offered_starts_at, WEEK_HOUR_PX, WEEK_MIN_BLOCK_PX) - 2}px` }"
                      @click.stop
                    >
                      <span class="truncate">{{ freedSlotLabel(o) }}</span>
                    </div>

                    <template v-for="(appt, i) in layoutForRoomOnDay(day, col.id)" :key="isOverflowBlock(appt) ? `overflow-${toDateKey(day)}-${col.id}-${i}` : appt.id">
                      <button
                        v-if="isOverflowBlock(appt)"
                        type="button"
                        class="absolute flex items-center justify-center overflow-hidden rounded-[7px] border border-line bg-surface text-[10px] font-medium text-ink-muted2 shadow-card hover:border-line-controlHover"
                        :title="`${appt.count} ${appt.count === 1 ? t('more appointment', 'cita más') : t('more appointments', 'citas más')} ${t('at this time -- click to see them all in Day view', 'a esta hora -- haz clic para verlas todas en la vista Día')}`"
                        :style="columnStyle(appt, timeToPx(appt.starts_at, WEEK_HOUR_PX), OVERFLOW_CHIP_PX)"
                        @click.stop="showOverflowDay(day)"
                      >
                        +{{ appt.count }}
                      </button>
                      <div
                        v-else-if="appt._movedFrom"
                        data-cy="moved-away-marker"
                        :data-appt-id="appt._movedFrom.id"
                        class="absolute cursor-pointer"
                        :style="columnStyle(appt, timeToPx(appt.starts_at, WEEK_HOUR_PX), Math.max(0, durationToPx(appt.starts_at, appt.ends_at, WEEK_HOUR_PX, WEEK_MIN_BLOCK_PX) - 2))"
                        :title="`${movedMarkerName(appt)} · ${movedMarkerLabel(appt)}`"
                        @click.stop="openEditModal(appt._movedFrom)"
                      >
                        <div class="flex h-full flex-col overflow-hidden rounded-[6px] border border-dashed border-line-control bg-surface-page px-1 py-0.5 text-[10.5px] leading-tight text-ink-muted opacity-60 hover:opacity-90">
                          <span class="truncate font-semibold">{{ movedMarkerName(appt) }}</span>
                          <span class="truncate">{{ movedMarkerLabel(appt) }}</span>
                        </div>
                      </div>
                      <div
                        v-else
                        data-cy="appt-block"
                        :data-appt-id="appt.id"
                        :data-stage="stageOf(appt)"
                      :data-dimmed="isDimmed(appt) || undefined"
                        class="absolute"
                        :class="appt.status === 'booked' ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'"
                        :style="columnStyle(appt, timeToPx(appt.starts_at, WEEK_HOUR_PX), Math.max(0, durationToPx(appt.starts_at, appt.ends_at, WEEK_HOUR_PX, WEEK_MIN_BLOCK_PX) - 2))"
                        @pointerdown="startAppointmentDrag(appt, 'move', $event)"
                        @click.stop="handleAppointmentClick(appt)"
                        @pointerenter="onBlockPointerEnter(appt, $event)"
                        @pointerleave="cancelHoverShow"
                      >
                        <CalendarAppointmentBlock
                          :view="blockView(appt)"
                          density="week"
                          :height="Math.max(0, durationToPx(appt.starts_at, appt.ends_at, WEEK_HOUR_PX, WEEK_MIN_BLOCK_PX) - 2)"
                          :selected="selectedApptId === appt.id"
                          :dim="isDimmed(appt)"
                          :privacy="settings.privacyMode"
                        />
                        <div
                          v-if="appt.status === 'booked'"
                          class="absolute inset-x-0 bottom-0 h-[6px] cursor-ns-resize"
                          @pointerdown.stop="startAppointmentDrag(appt, 'resize', $event)"
                        ></div>
                      </div>
                    </template>

                    <template v-for="g in [ghostFor(toDateKey(day), col.id)]" :key="`ghost-${toDateKey(day)}-${col.id}`">
                      <div
                        v-if="g && g.free"
                        data-cy="slot-ghost"
                        class="pointer-events-none absolute left-0.5 right-0.5 z-[15] flex items-center overflow-hidden whitespace-nowrap rounded-[6px] border-2 border-brand bg-surface px-1 text-[11px] font-semibold text-brand-text"
                        :style="{ top: `${(g.min / 60) * WEEK_HOUR_PX}px`, height: `${(SLOT_MIN / 60) * WEEK_HOUR_PX - 2}px` }"
                      >
                        + {{ g.label }}
                      </div>
                    </template>
                    <template v-for="g in [createGhostFor(toDateKey(day), col.id)]" :key="`new-${toDateKey(day)}-${col.id}`">
                      <div
                        v-if="g"
                        data-cy="create-ghost"
                        class="pointer-events-none absolute left-0.5 right-0.5 z-[15] flex items-center overflow-hidden whitespace-nowrap rounded-[6px] bg-brand px-1 text-[11px] font-semibold text-surface"
                        :style="{ top: `${(g.min / 60) * WEEK_HOUR_PX}px`, height: `${(SLOT_MIN / 60) * WEEK_HOUR_PX - 2}px` }"
                      >
                        {{ g.label }}
                      </div>
                    </template>
                    </template>
                    <template v-for="r in [focusRectFor(toDateKey(day), col.id, WEEK_HOUR_PX)]" :key="`focus-${toDateKey(day)}-${col.id}`">
                      <div v-if="r" data-grid-focus class="pointer-events-none absolute left-0 right-0 z-[16] rounded-[6px] ring-2 ring-inset ring-brand/60" :style="{ top: `${r.top}px`, height: `${r.height}px` }" />
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <CalendarNewAppointmentPanel
      v-if="modalOpen && modalMode === 'create'"
      :rooms="rooms"
      :appointment-types="activeAppointmentTypes"
      :team-members="teamMembers"
      :prefill-date="prefill?.date"
      :prefill-time="prefill?.time"
      :prefill-room-id="prefill?.roomId"
      :prefill-practitioner-id="prefillPractitionerId"
      :prefill-patient-id="bookingFor?.id"
      :slot-minutes="SLOT_MIN"
      @close="modalOpen = false"
      @saved="onCreated"
    />

    <CalendarAppointmentPanel
      v-if="openAppointment"
      :key="openAppointment.id"
      :appointment="openAppointment"
      :view="blockView(openAppointment)"
      :payment="paymentFor(openAppointment)"
      :price-cents="priceFor(openAppointment)"
      :rooms="rooms"
      :appointment-types="typesForPanel(openAppointment.appointment_type_id)"
      :team-members="clinicTeamMembers"
      :overrides="overrides"
      :initial-tab="panelInitialTab"
      @close="modalOpen = false"
      @changed="reloadAfterChange()"
      @reschedule="startReschedule(openAppointment!)"
    />

    <CalendarRescheduleConfirmModal
      v-if="pendingReschedule"
      :appointment-id="pendingReschedule.appointmentId"
      :patient-id="pendingReschedule.patientId"
      :patient-name="pendingReschedule.patientName"
      :appointment-type-name="pendingReschedule.appointmentTypeName"
      :orig-starts-at="pendingReschedule.origStartsAt"
      :new-starts-at="pendingReschedule.newStartsAt"
      @close="cancelReschedule"
      @confirm="confirmReschedule"
    />

    <CalendarMoveClashDialog v-if="moveClash" :clashes="moveClash.clashes" @confirm="onMoveClashConfirm" @cancel="onMoveClashCancel" />

    <CalendarAvailabilityBlockModal
      v-if="blockModalOpen"
      :rooms="rooms"
      :team-members="clinicTeamMembers"
      :block="editingBlock ?? undefined"
      :prefill-date="blockPrefill?.date"
      :prefill-time="blockPrefill?.time"
      :prefill-room-id="blockPrefill?.roomId"
      :prefill-practitioner-id="prefillPractitionerId"
      @close="blockModalOpen = false"
      @saved="onBlockSaved"
    />

    <CashShiftModal v-if="cashShiftOpen" @close="cashShiftOpen = false" />

    <CalendarAppointmentHoverCard
      v-if="hoveredAppt && !modalOpen"
      ref="hoverCardEl"
      :appointment="hoveredAppt"
      :view="blockView(hoveredAppt)"
      :room-name="hoveredRoomName"
      :price-cents="priceFor(hoveredAppt)"
      :paid="paymentFor(hoveredAppt).kind !== 'none'"
      class="pointer-events-none fixed z-30"
      :style="{ left: `${hoverPos.x}px`, top: `${hoverPos.y}px` }"
    />
  </div>
</template>

<style scoped>
/* Hours nobody works: diagonal stripes in two surface tokens, so they read
   as "not bookable" in both themes without borrowing a status colour. */
.cal-hatch {
  background: repeating-linear-gradient(135deg, rgb(var(--color-chip-bg)) 0 5px, rgb(var(--color-surface-subtle)) 5px 11px);
}
/* A deliberate block (training, lunch) -- the same stripes, a touch stronger,
   with an outline, so it reads as placed rather than as the day's edge. */
.cal-blocked {
  background: repeating-linear-gradient(135deg, rgb(var(--color-chip-bg)) 0 6px, rgb(var(--color-surface)) 6px 12px);
}
</style>

<script setup lang="ts">
import { formatEur, formatLongWeekdayDate, formatShortDate, formatTime, formatWeekdayDate } from '~/utils/billing'
import type { BusinessHours } from '~/utils/businessHours'
import { dayKeyFor, hasBusinessHoursConfigured, practitionerWindowsForDay, unionWorkingWindows, windowsForDay, withinWindows } from '~/utils/businessHours'
import type { AppointmentTypeOverride } from '~/utils/appointmentOverrides'
import { appointmentStage, matchesFilter, needsNextBookingFlag, STAGE_FILTERS, stageCounts, type AppointmentStage, type StageFilter } from '~/utils/appointmentStage'
import { shortPatientName } from '~/utils/appointmentBlock'
import { bonoForVisit, type VisitPayment } from '~/utils/visitPayment'
import { effectivePriceCents } from '~/utils/appointmentOverrides'
import { FILTER_DOT_CLASS, STAGE_TONE, STAGE_TONE_CLASS } from '~/composables/useAppointmentStage'
import type { BlockView } from '~/components/calendar/AppointmentBlock.vue'

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
interface AppointmentType { id: string; name: string; duration_minutes: number; color: string; default_price_cents: number }
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
}

const supabase = useSupabaseClient()
const { fetchVisitPayments } = useVisitPayments()
const store = useAccountStore()
const { can } = usePermission()
const t = useT()

const SLOT_MIN = computed(() => store.currentClinic?.slot_duration_minutes ?? 30)

// Cash Shift ("Caja") was only reachable from the account-menu dropdown --
// surfacing it directly on the calendar too, where staff actually work
// through the day, matches PracticeHub's placement.
const cashShiftOpen = ref(false)
const mobileInfoOpen = ref(false)

// Defaults to 'workweek', but this is really just the fallback for a
// browser that's never opened the calendar before -- the real value is
// whatever the user last picked, persisted in localStorage below so a
// refresh doesn't silently snap back to a hardcoded default.
const CALENDAR_VIEW_MODE_KEY = 'quiroflow-calendar-view-mode'
const viewMode = ref<'day' | 'workweek' | 'week'>('workweek')
onMounted(() => {
  const stored = localStorage.getItem(CALENDAR_VIEW_MODE_KEY)
  if (stored === 'day' || stored === 'workweek' || stored === 'week') viewMode.value = stored
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
const openAppointment = computed(() => (modalOpen.value && modalMode.value === 'edit' && editingAppointment.value ? (appointments.value.find((a) => a.id === editingAppointment.value!.id) ?? null) : null))
const prefill = ref<{ date: string; time: string; roomId: string } | null>(null)

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
  showAvailability: true,
  showCancelled: false,
  hideRescheduled: false,
  hideDeleted: true,
})
const displayToggles = computed<{ key: keyof typeof settings; label: string }[]>(() => [
  { key: 'privacyMode', label: t('Privacy mode', 'Modo privacidad') },
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
    supabase.from('appointment_types').select('id, name, duration_minutes, color, default_price_cents').order('name'),
    supabase.from('team_members').select('id, full_name, color, business_hours').is('deleted_at', null).eq('is_practitioner', true).order('full_name'),
    supabase.from('appointment_type_overrides').select('appointment_type_id, team_member_id, duration_minutes, price_cents'),
    supabase.from('team_member_clinics').select('team_member_id, clinic_id'),
  ])
  appointmentTypes.value = types ?? []
  // business_hours comes back as Supabase's recursive Json type, which never
  // narrows to BusinessHours on its own -- cast at the read site, same as
  // settings/team.vue and settings/online-booking.vue already do.
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

async function loadRooms() {
  if (!store.currentClinicId) {
    rooms.value = []
    return
  }
  const { data } = await supabase
    .from('calendar_resources')
    .select('id, name')
    .eq('clinic_id', store.currentClinicId)
    .order('name')
  rooms.value = data ?? []
}

// `silent` reloads without the skeleton: after a step in the open panel the
// grid should update in place, not blink.
async function loadAppointments(silent = false) {
  if (!store.currentClinicId) {
    appointments.value = []
    return
  }
  if (!silent) loading.value = true
  const rangeStart = viewMode.value === 'day' ? startOfDay(anchorDate.value) : weekStart.value
  const rangeEnd = viewMode.value === 'day' ? addDays(rangeStart, 1) : addDays(rangeStart, 7)

  const token = ++loadToken
  let query = supabase
    .from('appointments')
    .select(
      'id, patient_id, room_id, practitioner_id, appointment_type_id, starts_at, ends_at, status, checked_in_at, flow_with_practitioner_at, flow_checkout_at, rescheduled, confirmation_status, confirmation_sent_at, reminder_sent_at, same_day_info_sent_at, created_at, deleted_at, note, source, patients(first_name, last_name, sticky_note), appointment_types(name, color, default_price_cents), team_members(full_name, color)',
    )
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
  await Promise.all([loadLiveBalances(patientIds), loadFutureAppointmentIds(patientIds)])
  if (token !== loadToken) return
  loading.value = false
  // Second-rank detail -- the bono count, how often a visit was moved, the
  // waitlist offers standing on freed slots. The grid is usable without them,
  // so they fill in after it renders rather than holding it back for the
  // three sequential rounds fetchVisitPayments needs.
  loadBlockDetails(token, appointmentIds, patientIds, rangeStart, rangeEnd)
}

// Bumped on every load, so a slow response for a range the user has already
// navigated away from cannot land on top of the current one.
let loadToken = 0

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
  const [payments, { data: packages }, { data: reschedules }, { data: offers }] = await Promise.all([
    fetchVisitPayments(appointmentIds),
    patientIds.length
      ? supabase.from('package_purchases').select('patient_id, package_name, sessions_total, sessions_used').in('patient_id', patientIds).order('purchased_at', { ascending: false })
      : Promise.resolve({ data: [] as { patient_id: string; package_name: string; sessions_total: number; sessions_used: number }[] }),
    appointmentIds.length
      ? supabase.from('appointment_reschedules').select('appointment_id').in('appointment_id', appointmentIds)
      : Promise.resolve({ data: [] as { appointment_id: string }[] }),
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
  // will draw from (bonoForVisit).
  const active: typeof activePackageByPatient.value = {}
  for (const p of packages ?? []) {
    if (active[p.patient_id] || p.sessions_used >= p.sessions_total) continue
    active[p.patient_id] = p
  }
  activePackageByPatient.value = active
  const moved: Record<string, number> = {}
  for (const r of reschedules ?? []) moved[r.appointment_id] = (moved[r.appointment_id] ?? 0) + 1
  movedCountById.value = moved
  waitlistOffers.value = ((offers as unknown as WaitlistOffer[]) ?? []).filter((o) => o.offered_starts_at)
}

// patient_live_balances: negative when the patient owes. Only the owing side
// is ever drawn on the calendar -- a credit balance is not the front desk's
// problem at a glance, and it lives in the hover card and the panel.
const balanceByPatient = ref<Record<string, number>>({})
function owesCents(patientId: string) {
  return Math.max(0, -(balanceByPatient.value[patientId] ?? 0))
}
async function loadLiveBalances(patientIds: string[]) {
  if (patientIds.length === 0) {
    balanceByPatient.value = {}
    return
  }
  const { data } = await supabase.from('patient_live_balances').select('patient_id, balance_cents').in('patient_id', patientIds)
  const map: Record<string, number> = {}
  for (const b of data ?? []) map[b.patient_id!] = b.balance_cents ?? 0
  balanceByPatient.value = map
}

// Which of today's/this-view's appointments' patients have some OTHER
// upcoming appointment already on the books -- drives the calendar-with-X
// icon on a block ("no future appointment") so staff can spot who needs a
// follow-up booked without opening each patient.
const futureAppointmentIdsByPatient = ref<Record<string, Set<string>>>({})
async function loadFutureAppointmentIds(patientIds: string[]) {
  if (patientIds.length === 0) {
    futureAppointmentIdsByPatient.value = {}
    return
  }
  const { data } = await supabase
    .from('appointments')
    .select('id, patient_id')
    .in('patient_id', patientIds)
    .neq('status', 'cancelled')
    .gt('starts_at', new Date().toISOString())
  const map: Record<string, Set<string>> = {}
  for (const a of data ?? []) {
    ;(map[a.patient_id] ??= new Set()).add(a.id)
  }
  futureAppointmentIdsByPatient.value = map
}
function hasFutureAppointment(appt: AppointmentRow) {
  const ids = futureAppointmentIdsByPatient.value[appt.patient_id]
  if (!ids) return false
  return [...ids].some((id) => id !== appt.id)
}


async function loadAvailabilityBlocks() {
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

  availabilityBlocks.value = data ?? []
}

onMounted(async () => {
  await loadReferenceData()
  ensureValidPractitionerFilter()
  await loadRooms()
  await loadAppointments()
  await loadAvailabilityBlocks()
})
watch(() => store.currentClinicId, async () => {
  ensureValidPractitionerFilter()
  await loadRooms()
  await loadAppointments()
  await loadAvailabilityBlocks()
})
watch([viewMode, anchorDate, practitionerFilter], async () => {
  await loadAppointments()
  await loadAvailabilityBlocks()
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
  if (appt.rescheduled && settings.hideRescheduled) return false
  if (appt.deleted_at && settings.hideDeleted) return false
  return true
}

function appointmentsForRoom(roomId: string) {
  return appointments.value.filter((a) => (a.room_id ?? '__none') === roomId && isApptVisible(a))
}

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
const businessHoursConfigured = computed(() => workingWindowsFor(anchorDate.value) !== null)

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

// --- Stage, block, counts ---
// One stage per appointment, from utils/appointmentStage -- the block, the
// counts row and the day headers all read it from there.
function stageOf(appt: AppointmentRow): AppointmentStage {
  return appointmentStage(appt)
}

function firstName(full: string | null | undefined) {
  return (full ?? '').trim().split(/\s+/)[0] || null
}

function blockView(appt: AppointmentRow): BlockView {
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
  const keys = new Set((viewMode.value === 'day' ? [anchorDate.value] : visibleWeekDays.value).map(toDateKey))
  return countsFor(appointments.value.filter((a) => keys.has(toDateKey(new Date(a.starts_at)))))
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
function dayHeaderCounts(day: Date) {
  const key = toDateKey(day)
  const c = countsFor(appointments.value.filter((a) => toDateKey(new Date(a.starts_at)) === key)).counts
  return { unconfirmed: c.pending, owe: c.owes }
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

  function flush() {
    if (cluster.length === 0) return
    const colEnds: number[] = []
    for (const appt of cluster) {
      const start = new Date(appt.starts_at).getTime()
      let col = colEnds.findIndex((end) => end <= start)
      if (col === -1) {
        col = colEnds.length
        colEnds.push(0)
      }
      colEnds[col] = effEndMs(appt)
      appt._col = col
    }
    const totalCols = colEnds.length
    if (totalCols <= maxLanes) {
      for (const appt of cluster) appt._totalCols = totalCols
      result.push(...cluster)
    } else {
      const visible = cluster.filter((a) => a._col < maxLanes - 1)
      const hidden = cluster.filter((a) => a._col >= maxLanes - 1)
      for (const a of visible) a._totalCols = maxLanes
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

// Day view splits columns by room, but two appointments can still be
// double-booked (or just overlap) in the same room -- without this, they'd
// all render at full column width and visually stack on top of each other.
function layoutForRoom(roomId: string): LayoutBlock[] {
  const sorted = [...appointmentsForRoom(roomId)].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  return assignOverlapLayout(sorted, DAY_MAX_LANES, DAY_HOUR_PX.value, DAY_MIN_BLOCK_PX)
}

// Week view mirrors Day view's room columns (one sub-column per room, per
// day) instead of cramming every room's appointments into a single day
// column -- that's what was forcing 3-4 way lane splits and truncating
// patient names down to a few characters even when nothing was genuinely
// double-booked.
function appointmentsForRoomOnDay(day: Date, roomId: string) {
  const key = toDateKey(day)
  return appointments.value.filter((a) => toDateKey(new Date(a.starts_at)) === key && (a.room_id ?? '__none') === roomId && isApptVisible(a))
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
function layoutForRoomOnDay(day: Date, roomId: string): LayoutBlock[] {
  const sorted = [...appointmentsForRoomOnDay(day, roomId)].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  return assignOverlapLayout(sorted, WEEK_MAX_LANES, WEEK_HOUR_PX.value, WEEK_MIN_BLOCK_PX)
}
function showOverflowDay(day: Date) {
  anchorDate.value = day
  viewMode.value = 'day'
}
function openEditModal(appointment: AppointmentRow) {
  closeHoverCardNow()
  editingAppointment.value = appointment
  modalMode.value = 'edit'
  modalOpen.value = true
}
async function onSaved() {
  modalOpen.value = false
  await loadAppointments()
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
  if (appt.status !== 'booked') return
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
}
const reschedulingAppointment = ref<ReschedulingAppointment | null>(null)

function startReschedule(appt: {
  id: string
  patient_id: string
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
function pickRescheduleSlot(day: Date, time: string, roomId: string | null) {
  const src = reschedulingAppointment.value
  if (!src) return
  const [h, m] = time.split(':').map(Number)
  const newStartsAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0)
  const durationMs = new Date(src.endsAt).getTime() - new Date(src.startsAt).getTime()
  const newEndsAt = new Date(newStartsAt.getTime() + durationMs)

  if (
    businessHoursConfigured.value &&
    (!isWorkingTime(newStartsAt) || !isWorkingTime(new Date(newEndsAt.getTime() - 1)))
  ) {
    if (!confirm(t('This falls outside working hours. Move it anyway?', 'Esto queda fuera del horario de atención. ¿Moverla de todos modos?'))) return
  }

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
    businessHoursConfigured.value &&
    (!isWorkingTime(new Date(appt.starts_at)) || !isWorkingTime(new Date(new Date(appt.ends_at).getTime() - 1)))
  ) {
    if (!confirm(t('This falls outside working hours. Save it anyway?', 'Esto queda fuera del horario de atención. ¿Guardarlo de todos modos?'))) {
      revert()
      return
    }
  }

  pendingReschedule.value = {
    appointmentId: appt.id,
    patientId: appt.patient_id,
    patientName: appt.patients ? `${appt.patients.first_name} ${appt.patients.last_name ?? ''}`.trim() : '',
    appointmentTypeName: appt.appointment_types?.name ?? null,
    origStartsAt: orig.starts_at,
    newStartsAt: appt.starts_at,
    newEndsAt: appt.ends_at,
    newRoomId: appt.room_id,
    revert,
  }
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
  await loadAppointments()
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
function snapMin(offsetY: number, hourPx: number) {
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
function ghostFor(dayKey: string, roomId: string) {
  const cell = ghostCell.value
  if (!cell || reschedulingAppointment.value) return null
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
  const min = snapMin(e.offsetY, hourPx)
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
  const cell = { col: colIndex(toDateKey(day), roomId), min: snapMin(e.offsetY, hourPx) }
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
function freedSlotUntil(o: WaitlistOffer) {
  return o.offer_expires_at ? t(`replies by ${formatTime(o.offer_expires_at)}`, `responde antes de las ${formatTime(o.offer_expires_at)}`) : ''
}

// Current-time indicator (day view only, per spec).
const now = ref(new Date())
let nowTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  nowTimer = setInterval(() => (now.value = new Date()), 30000)
})
onUnmounted(() => {
  if (nowTimer) clearInterval(nowTimer)
})
const nowWithinHours = computed(() => now.value.getHours() >= START_HOUR && now.value.getHours() < END_HOUR)
const showNowLine = computed(() => viewMode.value === 'day' && isSameDate(now.value, anchorDate.value) && nowWithinHours.value)
const nowLinePx = computed(() => timeToPx(now.value.toISOString(), DAY_HOUR_PX.value))
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex shrink-0 flex-col gap-2.5 border-b border-line bg-surface px-4 py-2.5 lg:h-14 lg:flex-row lg:items-center lg:justify-between lg:px-6 lg:py-0">
      <div class="flex items-center gap-4">
        <h1 class="text-[18px] font-[640] tracking-tightTitle text-ink-900">{{ t('Calendar', 'Calendario') }}</h1>
        <div class="flex items-center gap-1">
          <button type="button" :aria-label="t('Previous', 'Anterior')" class="flex h-[26px] w-[26px] items-center justify-center rounded-ctlSm border border-line-control text-ink-500 hover:border-line-controlHover hover:bg-surface-subtle [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" @click="stepDate(-1)">
            <svg width="7" height="11" viewBox="0 0 7 11" fill="none"><path d="M6 1L1 5.5L6 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <button type="button" class="flex h-[26px] items-center rounded-ctlSm border border-line-control px-2.5 text-[12.5px] font-medium text-ink-600 hover:border-line-controlHover hover:bg-surface-subtle [@media(pointer:coarse)]:h-11" @click="goToday">{{ t('Today', 'Hoy') }}</button>
          <button type="button" :aria-label="t('Next', 'Siguiente')" class="flex h-[26px] w-[26px] items-center justify-center rounded-ctlSm border border-line-control text-ink-500 hover:border-line-controlHover hover:bg-surface-subtle [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" @click="stepDate(1)">
            <svg width="7" height="11" viewBox="0 0 7 11" fill="none"><path d="M1 1L6 5.5L1 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        </div>
        <span class="text-[13.5px] font-[560] text-ink-700">{{ rangeLabel }}</span>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <select v-model="viewMode" :aria-label="t('View', 'Vista')" class="h-[26px] rounded-ctlSm border border-line-control bg-surface px-2 text-[12.5px] font-medium text-ink-600 hover:border-line-controlHover focus:border-brand focus:outline-none [@media(pointer:coarse)]:h-11">
          <option value="day">{{ t('Day', 'Día') }}</option>
          <option value="workweek">{{ t('Work week', 'Semana laboral') }}</option>
          <option value="week">{{ t('Week', 'Semana') }}</option>
        </select>
        <UiBtn v-if="can('payments_allocate')" variant="secondary" size="sm" @click="cashShiftOpen = true">{{ t('Cash Shift', 'Turno de Caja') }}</UiBtn>
        <UiBtn variant="secondary" size="sm" @click="openBlockCreateModal()">{{ t('Block time', 'Bloquear horario') }}</UiBtn>
        <UiBtn variant="primary" size="sm" @click="openCreateModal()">{{ t('+ New Appointment', '+ Nueva Cita') }}</UiBtn>
        <!-- The mini-calendar/display panel is a fixed 238px column at lg+
        (below), but that plus the optional flow-tracker column would eat
        most of a phone's width -- so below lg it's an off-canvas drawer
        instead, reached from here. -->
        <button
          type="button"
          class="flex h-[26px] items-center gap-1 rounded-ctlSm border border-line-control px-2.5 text-[12.5px] font-medium text-ink-600 hover:border-line-controlHover hover:bg-surface-subtle lg:hidden [@media(pointer:coarse)]:h-11"
          @click="mobileInfoOpen = true"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="7" cy="7" r="5.3" /><path d="M7 6.3v3.4M7 4.3v.15" stroke-linecap="round" /></svg>
          {{ t('Info', 'Info') }}
        </button>
      </div>
    </header>

    <!-- One tab per practitioner, plus the whole clinic and the visits with
         no practitioner at all. -->
    <div v-if="clinicTeamMembers.length > 0" data-testid="practitioner-tabs" class="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-4 lg:px-6 [@media(pointer:coarse)]:h-12">
      <button
        type="button"
        data-testid="practitioner-tab-all"
        class="h-[26px] shrink-0 rounded-ctlSm px-3 text-[12.5px] font-medium transition-colors [@media(pointer:coarse)]:h-11"
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
        class="flex h-[26px] shrink-0 items-center gap-1.5 rounded-ctlSm px-3 text-[12.5px] font-medium transition-colors [@media(pointer:coarse)]:h-11"
        :class="practitionerFilter === m.id ? 'bg-brand text-white' : 'text-ink-600 hover:bg-surface-subtle'"
        :aria-pressed="practitionerFilter === m.id"
        @click="practitionerFilter = m.id"
      >
        {{ m.full_name }}
      </button>
      <button
        type="button"
        data-testid="practitioner-tab-unassigned"
        class="h-[26px] shrink-0 rounded-ctlSm px-3 text-[12.5px] font-medium transition-colors [@media(pointer:coarse)]:h-11"
        :class="practitionerFilter === UNASSIGNED_PRACTITIONER ? 'bg-brand text-white' : 'text-ink-faint hover:bg-surface-subtle'"
        :aria-pressed="practitionerFilter === UNASSIGNED_PRACTITIONER"
        @click="practitionerFilter = UNASSIGNED_PRACTITIONER"
      >
        {{ t('No practitioner', 'Sin profesional') }}
      </button>
    </div>
    <div v-else class="flex h-9 shrink-0 items-center border-b border-line bg-surface px-6 text-[12.5px] text-ink-faint">
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
    <div v-if="store.currentClinicId && !loading" data-cy="day-counts" class="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-surface px-4 py-1.5 lg:px-6">
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
          <button type="button" :aria-label="t('Close', 'Cerrar')" class="flex h-11 w-11 items-center justify-center rounded-ctlSm text-ink-muted2 hover:bg-surface-subtle" @click="mobileInfoOpen = false">
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
      <div ref="scrollAreaRef" class="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div v-if="loading" class="flex min-w-0 flex-1 p-3">
          <div v-for="col in 3" :key="col" class="flex-1 border-r border-line px-3 last:border-r-0">
            <UiSkeleton class="mb-4 h-4 w-24 rounded-ctlSm" />
            <div class="space-y-3">
              <UiSkeleton v-for="row in 6" :key="row" class="rounded-ctl" :class="row % 3 === 1 ? 'h-14' : 'h-8'" />
            </div>
          </div>
        </div>

        <div v-else-if="!store.currentClinicId" class="p-6 text-[13px] text-ink-faint">
          {{ t('No clinic selected.', 'Ninguna clínica seleccionada.') }}
        </div>

        <!-- The grid takes keyboard focus as one stop; arrow keys then move a
             cell cursor across rooms, days and slots (onGridKeydown). -->
        <div
          v-else
          ref="gridRef"
          tabindex="0"
          role="group"
          data-cy="calendar-grid"
          :aria-label="t('Calendar grid. Arrow keys move between slots; Enter books a free slot or opens an appointment.', 'Calendario. Las flechas mueven entre huecos; Intro reserva un hueco libre o abre una cita.')"
          class="flex min-w-0 flex-1 flex-col outline-none"
          @focus="onGridFocus"
          @blur="onGridBlur"
          @keydown="onGridKeydown"
        >
          <span class="sr-only" aria-live="polite">{{ focusAnnouncement }}</span>

          <!-- Day view: room columns -->
          <div v-if="viewMode === 'day'" class="min-w-0 flex-1 overflow-x-auto">
            <div :style="{ minWidth: `${58 + dayColumns.length * 220}px` }">
              <div class="sticky top-0 z-30 flex bg-surface">
                <div class="h-10 w-[58px] shrink-0 border-b border-r border-line"></div>
                <div v-for="col in dayColumns" :key="col.id" class="flex h-10 flex-1 flex-col items-center justify-center border-b border-r border-line last:border-r-0">
                  <span class="text-[13px] font-semibold text-ink-900">{{ col.name }}</span>
                  <span v-if="roomPractitionerLabel(col.id)" class="text-[11.5px] leading-none text-ink-muted2">{{ roomPractitionerLabel(col.id) }}</span>
                </div>
              </div>

              <div class="relative flex" :style="{ height: `${dayGridHeight}px` }">
                <div class="relative w-[58px] shrink-0 border-r border-line">
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
                  v-for="col in dayColumns"
                  :key="col.id"
                  data-cal-col
                  :data-room-id="col.id"
                  :data-day-key="toDateKey(anchorDate)"
                  class="relative flex-1 cursor-pointer border-r border-line last:border-r-0"
                  @pointerdown="onColumnPointerDown"
                  @pointermove="onColumnPointerMove($event, toDateKey(anchorDate), col.id, DAY_HOUR_PX)"
                  @pointerleave="hoverCell = null"
                  @click="onColumnClick($event, anchorDate, col.id, DAY_HOUR_PX)"
                >
                  <div v-for="rect in closedSlotRects(anchorDate, DAY_HOUR_PX)" :key="rect.top" data-cy="closed-hours" class="cal-hatch pointer-events-none absolute left-0 right-0 flex items-start px-2 pt-1.5 text-[12px] text-ink-muted" :style="{ top: `${rect.top}px`, height: `${rect.height}px` }">
                    <span v-if="rect.height >= 28">{{ t('Nobody working', 'Fuera de horario') }}</span>
                  </div>
                  <div v-for="m in slotMarks" :key="`slot-${m}`" class="pointer-events-none absolute left-0 right-0 border-t border-dashed border-line-divider" :style="{ top: `${(m / 60) * DAY_HOUR_PX}px` }" />
                  <div v-for="h in hourMarks" :key="h" class="pointer-events-none absolute left-0 right-0 border-t border-line" :style="{ top: `${(h - START_HOUR) * DAY_HOUR_PX}px` }" />

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

                  <template v-for="(appt, i) in layoutForRoom(col.id)" :key="isOverflowBlock(appt) ? `overflow-${col.id}-${i}` : appt.id">
                    <div
                      v-if="isOverflowBlock(appt)"
                      class="absolute flex items-center justify-center overflow-hidden rounded-[7px] border border-line bg-surface text-[10.5px] font-medium text-ink-muted2 shadow-card"
                      :title="`${appt.count} ${appt.count === 1 ? t('more appointment', 'cita más') : t('more appointments', 'citas más')} ${t('at this time', 'a esta hora')}`"
                      :style="columnStyle(appt, timeToPx(appt.starts_at, DAY_HOUR_PX), OVERFLOW_CHIP_PX)"
                    >
                      +{{ appt.count }} {{ t('more', 'más') }}
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
                  <template v-for="r in [focusRectFor(toDateKey(anchorDate), col.id, DAY_HOUR_PX)]" :key="`focus-${col.id}`">
                    <div v-if="r" data-grid-focus class="pointer-events-none absolute left-0.5 right-0.5 z-[16] rounded-ctl ring-2 ring-inset ring-brand/60" :style="{ top: `${r.top}px`, height: `${r.height}px` }" />
                  </template>
                </div>

                <div v-if="showNowLine" class="pointer-events-none absolute left-0 right-0 z-20" :style="{ top: `${nowLinePx}px` }">
                  <div class="absolute left-0 top-0 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand"></div>
                  <div class="h-0.5 w-full bg-brand"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Week view: day columns, each split into room sub-columns like Day view. -->
          <div v-else class="min-w-0 flex-1 overflow-x-auto">
            <div class="flex" :style="{ minWidth: `${58 + visibleWeekDays.length * dayColumns.length * WEEK_ROOM_COL_PX}px` }">
              <div class="sticky left-0 z-20 w-[58px] shrink-0 bg-surface">
                <div class="sticky top-0 z-30 border-b border-r border-line bg-surface" :style="{ height: `${WEEK_HEADER_PX}px` }"></div>
                <div class="relative border-r border-line" :style="{ height: `${weekGridHeight}px` }">
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

              <div v-for="day in visibleWeekDays" :key="toDateKey(day)" class="flex flex-1 flex-col border-r border-line last:border-r-0">
                <div class="sticky top-0 z-30 bg-surface">
                  <div
                    class="relative flex h-6 items-center justify-center gap-1"
                    :class="isSameDate(day, new Date()) ? 'bg-brand-tintDeep' : ''"
                  >
                    <span class="text-[11px] font-semibold uppercase tracking-[.04em] text-ink-muted2">{{ formatWeekdayDate(day).split(' ')[0] }}</span>
                    <span class="text-[12.5px] font-medium" :class="isSameDate(day, new Date()) ? 'text-brand-text' : 'text-ink-900'">{{ day.getDate() }}</span>
                    <button type="button" :aria-label="t('New appointment on this day', 'Nueva cita este día')" class="absolute right-1 top-0.5 text-[11px] text-ink-faint hover:text-brand-text" @click.stop="openCreateModalForDay(day)">+</button>
                  </div>
                  <!-- Per-day counts: the two that need someone to act. -->
                  <div class="flex h-[18px] items-center justify-center gap-2 border-b border-line text-[10.5px] text-ink-muted" data-cy="day-header-counts" :class="isSameDate(day, new Date()) ? 'bg-brand-tintDeep' : ''">
                    <template v-for="c in [dayHeaderCounts(day)]" :key="`c-${toDateKey(day)}`">
                      <span v-if="c.unconfirmed > 0" class="inline-flex items-center gap-1 text-warning-text"><span class="h-1.5 w-1.5 rounded-full bg-warning-accent" />{{ t(`${c.unconfirmed} unconfirmed`, `${c.unconfirmed} sin confirmar`) }}</span>
                      <span v-if="c.owe > 0" class="inline-flex items-center gap-1 text-danger-text"><span class="h-1.5 w-1.5 rounded-full bg-danger-text" />{{ t(`${c.owe} owe`, `${c.owe} deben`) }}</span>
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
                  <div
                    v-for="col in dayColumns"
                    :key="col.id"
                    data-cal-col
                    :data-room-id="col.id"
                    :data-day-key="toDateKey(day)"
                    class="relative flex-1 cursor-pointer border-r border-line-divider last:border-r-0"
                    :style="{ minWidth: `${WEEK_ROOM_COL_PX}px` }"
                    @pointerdown="onColumnPointerDown"
                    @pointermove="onColumnPointerMove($event, toDateKey(day), col.id, WEEK_HOUR_PX)"
                    @pointerleave="hoverCell = null"
                    @click="onColumnClick($event, day, col.id, WEEK_HOUR_PX)"
                  >
                    <div v-for="rect in closedSlotRects(day, WEEK_HOUR_PX)" :key="rect.top" data-cy="closed-hours" class="cal-hatch pointer-events-none absolute left-0 right-0" :style="{ top: `${rect.top}px`, height: `${rect.height}px` }" />
                    <div v-for="m in slotMarks" :key="`slot-${m}`" class="pointer-events-none absolute left-0 right-0 border-t border-dashed border-line-divider" :style="{ top: `${(m / 60) * WEEK_HOUR_PX}px` }" />
                    <div v-for="h in hourMarks" :key="h" class="pointer-events-none absolute left-0 right-0 border-t border-line" :style="{ top: `${(h - START_HOUR) * WEEK_HOUR_PX}px` }" />

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
      :appointment-types="appointmentTypes"
      :team-members="teamMembers"
      :prefill-date="prefill?.date"
      :prefill-time="prefill?.time"
      :prefill-room-id="prefill?.roomId"
      :prefill-practitioner-id="prefillPractitionerId"
      @close="modalOpen = false"
      @saved="onSaved"
    />

    <CalendarAppointmentPanel
      v-if="openAppointment"
      :key="openAppointment.id"
      :appointment="openAppointment"
      :view="blockView(openAppointment)"
      :payment="paymentFor(openAppointment)"
      :price-cents="priceFor(openAppointment)"
      :rooms="rooms"
      :appointment-types="appointmentTypes"
      :team-members="clinicTeamMembers"
      :overrides="overrides"
      @close="modalOpen = false"
      @changed="loadAppointments(true)"
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

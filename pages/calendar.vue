<script setup lang="ts">
import { hasBusinessHoursConfigured, isWithinBusinessHours } from '~/utils/businessHours'
import type { AppointmentTypeOverride } from '~/utils/appointmentOverrides'

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
const WEEK_HEADER_PX = 52 // h-6 day-label row + h-7 room-label row (week view now has room sub-columns per day, like Day view)
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

// The status dot, name, and balance icon are one single line (not stacked
// rows), so a short appointment's floor only needs to fit that one line --
// close to a real 15min slot's natural height at the clinic's own slot
// size, instead of forcing every short appointment to visually occupy ~2
// grid rows just to fit a taller multi-row card. Blocks below this height
// use tighter padding so the single line still fits comfortably.
const DAY_MIN_BLOCK_PX = 22
const WEEK_MIN_BLOCK_PX = 18
const BLOCK_DROP_ROW3_BELOW = 34
// Availability/unavailable bands only need to fit a centered one-line label.
const DAY_MIN_AVAILABILITY_PX = 20
const WEEK_MIN_AVAILABILITY_PX = 16

// Overlapping appointments cascade (PracticeHub-style) instead of splitting
// into N equal-width lanes: each later lane is inset from the left by a
// fixed pixel offset and stacks on top (higher z-index), so every block
// stays near full width and its name stays fully readable instead of being
// squeezed down to initials. Past maxLanes, the remaining appointments in
// that cluster collapse into a single "+N more" chip in the last lane. Day
// view's room columns are wider than week view's, so it tolerates a couple
// more cascade layers before the last one gets too narrow to read.
const DAY_MAX_LANES = 6
const WEEK_MAX_LANES = 4
const DAY_CASCADE_PX = 26
const WEEK_CASCADE_PX = 16
const OVERFLOW_CHIP_PX = 20

interface Room { id: string; name: string }
interface AppointmentType { id: string; name: string; duration_minutes: number; color: string; default_price_cents: number }
interface TeamMember { id: string; full_name: string; color: string }

interface AvailabilityBlock { id: string; room_id: string | null; starts_at: string; ends_at: string; note: string | null }

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
  patients: { first_name: string; last_name: string | null } | null
  appointment_types: { name: string; color: string; default_price_cents: number } | null
  team_members: { full_name: string; color: string } | null
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const { can } = usePermission()
const t = useT()

const SLOT_MIN = computed(() => store.currentClinic?.slot_duration_minutes ?? 30)

// Cash Shift ("Caja") was only reachable from the account-menu dropdown --
// surfacing it directly on the calendar too, where staff actually work
// through the day, matches PracticeHub's placement.
const cashShiftOpen = ref(false)

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
const practitionerFilter = ref('')
const anchorDate = ref(new Date())
const rooms = ref<Room[]>([])
const appointmentTypes = ref<AppointmentType[]>([])
const teamMembers = ref<TeamMember[]>([])
const overrides = ref<AppointmentTypeOverride[]>([])
const appointments = ref<AppointmentRow[]>([])
const availabilityBlocks = ref<AvailabilityBlock[]>([])
const loading = ref(true)

const modalOpen = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const editingAppointment = ref<AppointmentRow | null>(null)
const prefill = ref<{ date: string; time: string; roomId: string } | null>(null)

const blockModalOpen = ref(false)
const editingBlock = ref<AvailabilityBlock | null>(null)
const blockPrefill = ref<{ date: string; time: string; roomId: string } | null>(null)

// "Display" toggles in the left panel, per the redesign spec.
const settings = reactive({
  privacyMode: false,
  flowTracker: true,
  showAvailability: true,
  hideCancelled: true,
  hideRescheduled: false,
  hideDeleted: true,
  compactRows: false,
})
const displayToggles = computed<{ key: keyof typeof settings; label: string }[]>(() => [
  { key: 'privacyMode', label: t('Privacy mode', 'Modo privacidad') },
  { key: 'flowTracker', label: t('Flow tracker', 'Seguimiento de flujo') },
  { key: 'showAvailability', label: t('Show availability', 'Mostrar disponibilidad') },
  { key: 'hideCancelled', label: t('Hide cancelled', 'Ocultar canceladas') },
  { key: 'hideRescheduled', label: t('Hide rescheduled', 'Ocultar reprogramadas') },
  { key: 'hideDeleted', label: t('Hide deleted', 'Ocultar eliminadas') },
  { key: 'compactRows', label: t('Compact rows', 'Filas compactas') },
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
  if (viewMode.value === 'day') {
    return anchorDate.value.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
  }
  const days = visibleWeekDays.value
  const end = days[days.length - 1]
  return `${weekStart.value.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
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
  const [{ data: types }, { data: members }, { data: ovr }] = await Promise.all([
    supabase.from('appointment_types').select('id, name, duration_minutes, color, default_price_cents').order('name'),
    supabase.from('team_members').select('id, full_name, color').order('full_name'),
    supabase.from('appointment_type_overrides').select('appointment_type_id, team_member_id, duration_minutes, price_cents'),
  ])
  appointmentTypes.value = types ?? []
  teamMembers.value = members ?? []
  overrides.value = ovr ?? []
}

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

async function loadAppointments() {
  if (!store.currentClinicId) {
    appointments.value = []
    return
  }
  loading.value = true
  const rangeStart = viewMode.value === 'day' ? startOfDay(anchorDate.value) : weekStart.value
  const rangeEnd = viewMode.value === 'day' ? addDays(rangeStart, 1) : addDays(rangeStart, 7)

  let query = supabase
    .from('appointments')
    .select(
      'id, patient_id, room_id, practitioner_id, appointment_type_id, starts_at, ends_at, status, checked_in_at, flow_with_practitioner_at, flow_checkout_at, rescheduled, confirmation_status, deleted_at, note, source, patients(first_name, last_name), appointment_types(name, color, default_price_cents), team_members(full_name, color)',
    )
    .eq('clinic_id', store.currentClinicId)
    .gte('starts_at', rangeStart.toISOString())
    .lt('starts_at', rangeEnd.toISOString())
    .order('starts_at')
  if (practitionerFilter.value) query = query.eq('practitioner_id', practitionerFilter.value)
  const { data } = await query

  appointments.value = (data as unknown as AppointmentRow[]) ?? []
  const patientIds = [...new Set(appointments.value.map((a) => a.patient_id))]
  await Promise.all([loadLiveBalances(patientIds), loadFutureAppointmentIds(patientIds)])
  loading.value = false
}

const balanceByPatient = ref<Record<string, number>>({})
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
    .select('id, room_id, starts_at, ends_at, note')
    .eq('clinic_id', store.currentClinicId)
    .lt('starts_at', rangeEnd.toISOString())
    .gt('ends_at', rangeStart.toISOString())
    .order('starts_at')

  availabilityBlocks.value = data ?? []
}

// "Today at a glance" always reflects the real calendar day (not whatever
// day/week the grid below happens to be navigated to), so it's loaded
// independently of the main grid's date range. Mirrors PracticeHub's own
// widget: "Booked" is the total universe of appointments that belonged to
// today at some point (including ones since dragged away), and the other
// four are a status breakdown of that same universe, each shown as a
// percentage of Booked -- a reschedule-away is its own bucket rather than
// falling out of the day's numbers entirely once it moves.
const todayGlance = ref({ booked: 0, seen: 0, rescheduled: 0, cancelled: 0, missed: 0 })
async function loadTodayGlance() {
  if (!store.currentClinicId) {
    todayGlance.value = { booked: 0, seen: 0, rescheduled: 0, cancelled: 0, missed: 0 }
    return
  }
  const start = startOfDay(new Date())
  const end = addDays(start, 1)
  const [{ data: currentRows }, { data: rescheduleRows }] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, status')
      .eq('clinic_id', store.currentClinicId)
      .gte('starts_at', start.toISOString())
      .lt('starts_at', end.toISOString()),
    supabase
      .from('appointment_reschedules')
      .select('appointment_id, to_starts_at')
      .eq('account_id', store.accountId!)
      .gte('from_starts_at', start.toISOString())
      .lt('from_starts_at', end.toISOString()),
  ])
  const rows = currentRows ?? []
  const currentIds = new Set(rows.map((r) => r.id))
  const rescheduledAwayIds = new Set(
    (rescheduleRows ?? [])
      .filter((r) => (r.to_starts_at < start.toISOString() || r.to_starts_at >= end.toISOString()) && !currentIds.has(r.appointment_id))
      .map((r) => r.appointment_id),
  )

  const seen = rows.filter((r) => r.status === 'completed').length
  const cancelled = rows.filter((r) => r.status === 'cancelled').length
  const missed = rows.filter((r) => r.status === 'no_show').length
  const rescheduled = rescheduledAwayIds.size
  const booked = rows.length + rescheduled
  todayGlance.value = { booked, seen, rescheduled, cancelled, missed }
}
function glancePct(count: number) {
  return todayGlance.value.booked > 0 ? ((count / todayGlance.value.booked) * 100).toFixed(1) : '0.0'
}

onMounted(async () => {
  await loadReferenceData()
  await loadRooms()
  await loadAppointments()
  await loadAvailabilityBlocks()
  await loadTodayGlance()
})
watch(() => store.currentClinicId, async () => {
  await loadRooms()
  await loadAppointments()
  await loadAvailabilityBlocks()
  await loadTodayGlance()
})
watch([viewMode, anchorDate, practitionerFilter], async () => {
  await loadAppointments()
  await loadAvailabilityBlocks()
})

const dayColumns = computed(() => [...rooms.value, { id: '__none', name: t('Unassigned', 'Sin asignar') }])

function blocksForRoom(roomId: string) {
  if (!settings.showAvailability) return []
  return availabilityBlocks.value.filter((b) => b.room_id === roomId || b.room_id === null)
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
  if (appt.status === 'cancelled' && settings.hideCancelled) return false
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
function pxToTime(px: number, hourPx: number) {
  const totalMin = (px / hourPx) * 60
  const snapped = Math.round(totalMin / SLOT_MIN.value) * SLOT_MIN.value
  const h = START_HOUR + Math.floor(snapped / 60)
  const m = snapped % 60
  return `${pad(h)}:${pad(m)}`
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

const businessHoursConfigured = computed(() => hasBusinessHoursConfigured(store.currentClinic?.business_hours))

// Slots outside the clinic's configured working hours are shaded in the
// grid background; if the clinic never set hours (business_hours all
// empty), nothing is shaded -- opt-in, not "closed every day" by default.
function slotIsOpen(index: number, forDate: Date) {
  if (!businessHoursConfigured.value) return true
  const totalMin = index * SLOT_MIN.value
  const slotDate = new Date(forDate)
  slotDate.setHours(START_HOUR + Math.floor(totalMin / 60), totalMin % 60, 0, 0)
  return isWithinBusinessHours(slotDate, store.currentClinic?.business_hours)
}
// Closed-hours shading is still computed at the clinic's slot granularity
// (so a lunch break that ends at :30 shades correctly) even though the
// visible grid lines are hourly now.
function closedSlotRects(forDate: Date, hourPx: number) {
  const totalSlots = TOTAL_MIN / SLOT_MIN.value
  const slotPx = (SLOT_MIN.value / 60) * hourPx
  const rects: { top: number; height: number }[] = []
  for (let i = 0; i < totalSlots; i++) {
    if (!slotIsOpen(i, forDate)) rects.push({ top: i * slotPx, height: slotPx })
  }
  return rects
}

// The block palette collapses onto four visual states from the spec; a
// pending or reschedule-requested confirmation on an otherwise-booked
// appointment both read as "Unconfirmed" since the app has no separate 4th
// status column to key off of.
type VisualStatus = 'booked' | 'completed' | 'unconfirmed' | 'no_show' | 'cancelled'
function appointmentVisualStatus(appt: AppointmentRow): VisualStatus {
  if (appt.status === 'completed') return 'completed'
  if (appt.status === 'no_show') return 'no_show'
  if (appt.status === 'cancelled') return 'cancelled'
  if (appt.status === 'booked' && (appt.confirmation_status === 'pending' || appt.confirmation_status === 'reschedule_requested')) return 'unconfirmed'
  return 'booked'
}
// Tailwind classes rather than inline hex -- these map 1:1 onto the
// existing brand/success/warning/danger tokens in tailwind.config.ts, which
// already carry the exact hex values from the redesign spec.
const STATUS_STYLES: Record<VisualStatus, { dotClass: string; labelEn: string; labelEs: string; pillTone: 'brand' | 'success' | 'warning' | 'danger' | 'neutral' }> = {
  booked: { dotClass: 'bg-brand', labelEn: 'Booked', labelEs: 'Reservada', pillTone: 'brand' },
  completed: { dotClass: 'bg-success-accent', labelEn: 'Completed', labelEs: 'Completada', pillTone: 'success' },
  unconfirmed: { dotClass: 'bg-warning-accent', labelEn: 'Unconfirmed', labelEs: 'Sin confirmar', pillTone: 'warning' },
  no_show: { dotClass: 'bg-danger-text', labelEn: 'No-show', labelEs: 'No presentado', pillTone: 'danger' },
  cancelled: { dotClass: 'bg-ink-faint3', labelEn: 'Cancelled', labelEs: 'Cancelada', pillTone: 'neutral' },
}
const statusLegend = computed(() =>
  (Object.keys(STATUS_STYLES) as VisualStatus[]).map((key) => ({
    key,
    ...STATUS_STYLES[key],
    label: t(STATUS_STYLES[key].labelEn, STATUS_STYLES[key].labelEs),
  })),
)

function dotClass(appt: AppointmentRow) {
  return STATUS_STYLES[appointmentVisualStatus(appt)].dotClass
}
function nameClass(appt: AppointmentRow) {
  return appointmentVisualStatus(appt) === 'no_show' ? 'text-danger-text' : 'text-ink-900'
}
function formatCredit(cents: number) {
  return `€${(cents / 100).toFixed(2)}`
}

function hexToRgba(hex: string, alpha: number) {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// Block color comes from the appointment type's own color (so editing a
// type's color actually shows up on the calendar, and a Massage and an
// Adjustment don't look identical just because both are "booked") -- status
// is conveyed through the small dot + text style instead of the block color.
const { resolved: resolvedTheme } = useTheme()
function appointmentColorStyle(appt: AppointmentRow) {
  const color = appt.appointment_types?.color || '#4C6FEB'
  // Full-saturation hex borders read as neon/oversaturated against a dark
  // page background even though they look fine on a light one -- dimmed a
  // touch in dark mode only, same color hue, just less harsh.
  const borderAlpha = resolvedTheme.value === 'dark' ? 0.7 : 1
  return {
    borderColor: hexToRgba(color, borderAlpha),
    borderLeftColor: hexToRgba(color, borderAlpha),
    backgroundColor: hexToRgba(color, appt.status === 'cancelled' ? 0.12 : 0.32),
  }
}

// Cascade positioning for an overlapping block: each lane insets from the
// left by a fixed pixel amount and sits above the previous lane, rather
// than every lane getting an equal fraction of the column's width.
function cascadeStyle(block: LayoutBlock, cascadePx: number) {
  return {
    left: `calc(${block._col * cascadePx}px + 2px)`,
    width: `calc(100% - ${block._col * cascadePx}px - 4px)`,
    zIndex: String(10 + block._col),
  }
}

function openCreateModal(roomId?: string, clickY?: number) {
  const time = clickY !== undefined ? pxToTime(clickY, DAY_HOUR_PX.value) : '09:00'
  prefill.value = { date: toDateKey(anchorDate.value), time, roomId: roomId ?? '' }
  modalMode.value = 'create'
  editingAppointment.value = null
  modalOpen.value = true
}
function openCreateModalForDay(day: Date) {
  prefill.value = { date: toDateKey(day), time: '09:00', roomId: '' }
  modalMode.value = 'create'
  editingAppointment.value = null
  modalOpen.value = true
}
function openCreateModalForDayAtY(day: Date, clickY: number) {
  prefill.value = { date: toDateKey(day), time: pxToTime(clickY, WEEK_HOUR_PX.value), roomId: '' }
  modalMode.value = 'create'
  editingAppointment.value = null
  modalOpen.value = true
}
function openCreateModalForRoomOnDayAtY(day: Date, roomId: string, clickY: number) {
  prefill.value = { date: toDateKey(day), time: pxToTime(clickY, WEEK_HOUR_PX.value), roomId: roomId === '__none' ? '' : roomId }
  modalMode.value = 'create'
  editingAppointment.value = null
  modalOpen.value = true
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
// appointments). The lane index (_col) drives a cascading offset in the
// template rather than an equal-width split, so overlapping appointments
// stay near full width and readable instead of shrinking to initials. Past
// maxLanes, the remaining appointments in that cluster collapse into a
// single "+N more" marker in the last lane.
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
    (b) => (b.room_id === roomId || b.room_id === null) && new Date(b.starts_at).getTime() < dayEnd && new Date(b.ends_at).getTime() > dayStart,
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
  editingAppointment.value = appointment
  modalMode.value = 'edit'
  modalOpen.value = true
}
async function onSaved() {
  modalOpen.value = false
  await loadAppointments()
  await loadTodayGlance()
}

// --- Drag-to-move / drag-to-resize ---
// Mutates the real appointment object in `appointments.value` live during
// the drag rather than tracking a separate shadow position -- the existing
// per-column layout functions (blocksForRoom/layoutForRoom/
// layoutForRoomOnDay, timeToPx/durationToPx/cascadeStyle) already key off
// an appointment's own starts_at/ends_at/room_id, so this gets a fully
// WYSIWYG live preview (including realistic overlap-cascade behavior) for
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
// drag math instead of an absolute "HH:MM" -- pxToTime always measures from
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

  const hours = store.currentClinic?.business_hours
  if (
    hasBusinessHoursConfigured(hours) &&
    (!isWithinBusinessHours(new Date(appt.starts_at), hours) || !isWithinBusinessHours(new Date(new Date(appt.ends_at).getTime() - 1), hours))
  ) {
    if (!confirm(t("This falls outside the clinic's working hours. Save it anyway?", 'Esto queda fuera del horario de atención de la clínica. ¿Guardarlo de todos modos?'))) {
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
    const { count } = await supabase.from('invoices').select('id', { count: 'exact', head: true })
    const invoiceNumber = `INV-${String((count ?? 0) + 1).padStart(4, '0')}`
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

  if (payload.resendConfirmation) {
    fire('appointment.rescheduled', { patientId: pending.patientId, appointmentId: pending.appointmentId })
  }

  pendingReschedule.value = null
}

// Wraps openEditModal so the click the browser synthesizes right after a
// real drag doesn't reopen the modal the drag was meant to replace.
function handleAppointmentClick(appt: AppointmentRow) {
  if (dragMoved.value) {
    dragMoved.value = false
    return
  }
  openEditModal(appt)
}

const { fire } = useAutomations()

async function toggleCheckedIn(appt: AppointmentRow | null) {
  if (!appt) return
  const next = appt.checked_in_at ? null : new Date().toISOString()
  appt.checked_in_at = next
  await supabase.from('appointments').update({ checked_in_at: next }).eq('id', appt.id)
  if (next) fire('appointment.checked_in', { patientId: appt.patient_id, appointmentId: appt.id })
}

// Flow Tracker: Arrived (checked_in_at, already tracked elsewhere) -> With
// Practitioner -> Awaiting Checkout -> Complete (marks the appointment
// completed). Scoped to whatever's currently loaded (today, for the
// default Day view), same as the rest of the calendar.
async function advanceFlow(appt: AppointmentRow, field: 'flow_with_practitioner_at' | 'flow_checkout_at') {
  const now = new Date().toISOString()
  appt[field] = now
  await supabase.from('appointments').update({ [field]: now }).eq('id', appt.id)
}
async function completeFlow(appt: AppointmentRow) {
  appt.status = 'completed'
  await supabase.from('appointments').update({ status: 'completed' }).eq('id', appt.id)
  await loadTodayGlance()
}

// Hovering an appointment block shows patient/billing/changelog context
// without opening the full edit modal. A short show delay avoids flicker
// when the mouse just passes over a block; a short hide delay lets the
// mouse travel from the block onto the popover itself without it
// disappearing first.
const hoveredAppt = ref<AppointmentRow | null>(null)
const hoverPos = ref({ x: 0, y: 0 })
let hoverShowTimer: ReturnType<typeof setTimeout> | null = null
let hoverHideTimer: ReturnType<typeof setTimeout> | null = null

// Hovercard is a fixed 300px wide (AppointmentHoverCard.vue) -- shown on
// whichever side of the block actually has room, so on a block near the
// right edge of the screen it opens to the left instead of clamping back
// over the block itself and blocking clicks on it.
const HOVERCARD_WIDTH = 300
const HOVERCARD_GAP = 10

function scheduleHoverCard(appt: AppointmentRow, event: MouseEvent) {
  if (hoverHideTimer) {
    clearTimeout(hoverHideTimer)
    hoverHideTimer = null
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  hoverShowTimer = setTimeout(() => {
    hoveredAppt.value = appt
    const spaceRight = window.innerWidth - rect.right
    const spaceLeft = rect.left
    const showRight = spaceRight >= HOVERCARD_WIDTH + HOVERCARD_GAP || spaceRight >= spaceLeft
    const x = showRight
      ? Math.min(rect.right + HOVERCARD_GAP, window.innerWidth - HOVERCARD_WIDTH - HOVERCARD_GAP)
      : Math.max(HOVERCARD_GAP, rect.left - HOVERCARD_WIDTH - HOVERCARD_GAP)
    hoverPos.value = {
      x,
      y: Math.max(8, Math.min(rect.top, window.innerHeight - 380)),
    }
  }, 500)
}
function cancelHoverShow() {
  if (hoverShowTimer) {
    clearTimeout(hoverShowTimer)
    hoverShowTimer = null
  }
  hoverHideTimer = setTimeout(() => (hoveredAppt.value = null), 200)
}
function keepHoverCard() {
  if (hoverHideTimer) {
    clearTimeout(hoverHideTimer)
    hoverHideTimer = null
  }
}
function hideHoverCard() {
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

// The credit/no-future-appointment icons live inside each appointment
// block's own `overflow-hidden` (needed to clip content to its rounded
// corners) -- a plain CSS group-hover tooltip positioned via bottom-full
// never actually became visible, since it was clipped away the instant it
// tried to escape the block's bounds. Same fixed-position-computed-from-
// the-hovered-element approach as the appointment hover card above sidesteps
// that entirely.
const iconTooltip = ref<{ text: string; x: number; y: number } | null>(null)
let iconTooltipTimer: ReturnType<typeof setTimeout> | null = null
function scheduleIconTooltip(event: MouseEvent, text: string) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  iconTooltipTimer = setTimeout(() => {
    // Centered on the icon via -translate-x-1/2, but clamped so it doesn't
    // run off either edge of the viewport near the calendar's own edges.
    const x = Math.min(Math.max(rect.left + rect.width / 2, 100), window.innerWidth - 100)
    iconTooltip.value = { text, x, y: rect.top }
  }, 2000)
}
function cancelIconTooltip() {
  if (iconTooltipTimer) {
    clearTimeout(iconTooltipTimer)
    iconTooltipTimer = null
  }
  iconTooltip.value = null
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
    <header class="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-6">
      <div class="flex items-center gap-4">
        <h1 class="text-[18px] font-[640] tracking-tightTitle text-ink-900">{{ t('Calendar', 'Calendario') }}</h1>
        <div class="flex items-center gap-1">
          <button type="button" class="flex h-[26px] w-[26px] items-center justify-center rounded-ctlSm border border-line-control text-ink-500 hover:border-line-controlHover hover:bg-surface-subtle" @click="stepDate(-1)">
            <svg width="7" height="11" viewBox="0 0 7 11" fill="none"><path d="M6 1L1 5.5L6 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <button type="button" class="flex h-[26px] items-center rounded-ctlSm border border-line-control px-2.5 text-[12.5px] font-medium text-ink-600 hover:border-line-controlHover hover:bg-surface-subtle" @click="goToday">{{ t('Today', 'Hoy') }}</button>
          <button type="button" class="flex h-[26px] w-[26px] items-center justify-center rounded-ctlSm border border-line-control text-ink-500 hover:border-line-controlHover hover:bg-surface-subtle" @click="stepDate(1)">
            <svg width="7" height="11" viewBox="0 0 7 11" fill="none"><path d="M1 1L6 5.5L1 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        </div>
        <span class="text-[13.5px] font-[560] text-ink-700">{{ rangeLabel }}</span>
      </div>
      <div class="flex items-center gap-2">
        <select v-model="practitionerFilter" class="h-[26px] rounded-ctlSm border border-line-control bg-surface px-2 text-[12.5px] font-medium text-ink-600 hover:border-line-controlHover focus:border-brand focus:outline-none">
          <option value="">{{ t('All Practitioners', 'Todos los Profesionales') }}</option>
          <option v-for="m in teamMembers" :key="m.id" :value="m.id">{{ m.full_name }}</option>
        </select>
        <select v-model="viewMode" class="h-[26px] rounded-ctlSm border border-line-control bg-surface px-2 text-[12.5px] font-medium text-ink-600 hover:border-line-controlHover focus:border-brand focus:outline-none">
          <option value="day">{{ t('Day', 'Día') }}</option>
          <option value="workweek">{{ t('Work week', 'Semana laboral') }}</option>
          <option value="week">{{ t('Week', 'Semana') }}</option>
        </select>
        <UiBtn v-if="can('payments_allocate')" variant="secondary" size="sm" @click="cashShiftOpen = true">{{ t('Cash Shift', 'Turno de Caja') }}</UiBtn>
        <UiBtn variant="secondary" size="sm" @click="openBlockCreateModal()">{{ t('Block time', 'Bloquear horario') }}</UiBtn>
        <UiBtn variant="primary" size="sm" @click="openCreateModal()">{{ t('+ New Appointment', '+ Nueva Cita') }}</UiBtn>
      </div>
    </header>

    <div class="flex flex-1 overflow-hidden">
      <!-- Left panel: mini month, glance stats, display toggles, status key -->
      <aside class="w-[238px] shrink-0 overflow-y-auto border-r border-line bg-surface-sidebar">
        <div class="m-3 rounded-card border border-line bg-surface p-3">
          <div class="flex items-center justify-between">
            <button type="button" class="rounded-ctlSm p-1 text-ink-faint hover:bg-surface-subtle hover:text-ink-600" @click="miniBase = addMonths(miniBase, -1)">‹</button>
            <span class="text-[12.5px] font-[640] text-ink-900">{{ miniMonthLabel }}</span>
            <button type="button" class="rounded-ctlSm p-1 text-ink-faint hover:bg-surface-subtle hover:text-ink-600" @click="miniBase = addMonths(miniBase, 1)">›</button>
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
          <div class="space-y-1.5">
            <div class="flex items-center justify-between text-[12.5px]">
              <span class="text-ink-600">{{ t('Booked', 'Reservadas') }}</span>
              <span class="font-mono text-[12.5px] font-medium text-ink-900">{{ todayGlance.booked }}</span>
            </div>
            <div class="flex items-center justify-between text-[12.5px]">
              <span class="text-success-text">{{ t('Seen', 'Atendidas') }}</span>
              <span class="font-mono text-[12.5px] font-medium text-success-text">{{ todayGlance.seen }} ({{ glancePct(todayGlance.seen) }}%)</span>
            </div>
            <div class="flex items-center justify-between text-[12.5px]">
              <span class="text-warning-text">{{ t('Rescheduled', 'Reprogramadas') }}</span>
              <span class="font-mono text-[12.5px] font-medium text-warning-text">{{ todayGlance.rescheduled }} ({{ glancePct(todayGlance.rescheduled) }}%)</span>
            </div>
            <div class="flex items-center justify-between text-[12.5px]">
              <span class="text-danger-text">{{ t('Cancelled', 'Canceladas') }}</span>
              <span class="font-mono text-[12.5px] font-medium text-danger-text">{{ todayGlance.cancelled }} ({{ glancePct(todayGlance.cancelled) }}%)</span>
            </div>
            <div class="flex items-center justify-between text-[12.5px]">
              <span class="text-ink-muted2">{{ t('Missed', 'Perdidas') }}</span>
              <span class="font-mono text-[12.5px] font-medium text-ink-muted2">{{ todayGlance.missed }} ({{ glancePct(todayGlance.missed) }}%)</span>
            </div>
          </div>
        </div>

        <div class="mx-3 mt-3 rounded-card border border-line bg-surface p-3">
          <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-faint">{{ t('Display', 'Visualización') }}</p>
          <div class="mt-2 space-y-2.5">
            <div v-for="toggle in displayToggles" :key="toggle.key" class="flex items-center justify-between gap-2">
              <span class="text-[12.5px] text-ink-600">{{ toggle.label }}</span>
              <button
                type="button"
                role="switch"
                :aria-checked="settings[toggle.key]"
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
          <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-faint">{{ t('Status key', 'Leyenda de estados') }}</p>
          <div class="mt-2 space-y-1.5">
            <div v-for="item in statusLegend" :key="item.key" class="flex items-center gap-2 text-[12.5px] text-ink-600">
              <span class="h-[7px] w-[7px] shrink-0 rounded-full" :class="item.dotClass" />
              {{ item.label }}
            </div>
          </div>
        </div>
      </aside>

      <aside v-if="settings.flowTracker" class="w-[220px] shrink-0 overflow-y-auto border-r border-line bg-surface-sidebar p-3">
        <CalendarFlowTracker :appointments="appointments" :privacy-mode="settings.privacyMode" @advance="advanceFlow" @complete="completeFlow" />
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

        <!-- Day view: room columns -->
        <div v-else-if="viewMode === 'day'" class="min-w-0 flex-1 overflow-x-auto">
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
                @click="openCreateModal(col.id === '__none' ? undefined : col.id, $event.offsetY)"
              >
                <div v-for="m in slotMarks" :key="`slot-${m}`" class="pointer-events-none absolute left-0 right-0 border-t border-line" :style="{ top: `${(m / 60) * DAY_HOUR_PX}px` }" />
                <div v-for="h in hourMarks" :key="h" class="pointer-events-none absolute left-0 right-0 border-t border-line-control" :style="{ top: `${(h - START_HOUR) * DAY_HOUR_PX}px` }" />
                <div v-for="rect in closedSlotRects(anchorDate, DAY_HOUR_PX)" :key="rect.top" class="pointer-events-none absolute left-0 right-0 bg-line-row2" :style="{ top: `${rect.top}px`, height: `${rect.height}px` }" />

                <div
                  v-for="block in blocksForRoom(col.id)"
                  :key="block.id"
                  class="absolute left-0 right-0 z-0 flex items-center justify-center overflow-hidden bg-[repeating-linear-gradient(135deg,#F4F5F8,#F4F5F8_6px,#EBECF1_6px,#EBECF1_12px)] font-mono text-[10.5px] text-ink-muted2"
                  :style="{ top: `${timeToPx(block.starts_at, DAY_HOUR_PX)}px`, height: `${durationToPx(block.starts_at, block.ends_at, DAY_HOUR_PX, DAY_MIN_AVAILABILITY_PX)}px` }"
                  @click.stop="openBlockEditModal(block)"
                >
                  {{ block.note || (block.room_id === null ? t('Blocked (whole clinic)', 'Bloqueado (toda la clínica)') : t('Blocked', 'Bloqueado')) }}
                </div>

                <template v-for="(appt, i) in layoutForRoom(col.id)" :key="isOverflowBlock(appt) ? `overflow-${col.id}-${i}` : appt.id">
                  <div
                    v-if="isOverflowBlock(appt)"
                    class="absolute flex items-center justify-center overflow-hidden rounded-[7px] border border-line bg-surface text-[10.5px] font-medium text-ink-muted2 shadow-card"
                    :title="`${appt.count} ${appt.count === 1 ? t('more appointment', 'cita más') : t('more appointments', 'citas más')} ${t('at this time', 'a esta hora')}`"
                    :style="{
                      ...cascadeStyle(appt, DAY_CASCADE_PX),
                      top: `${timeToPx(appt.starts_at, DAY_HOUR_PX)}px`,
                      height: `${OVERFLOW_CHIP_PX}px`,
                    }"
                  >
                    +{{ appt.count }} {{ t('more', 'más') }}
                  </div>
                  <div
                    v-else
                    class="absolute scroll-mt-10 overflow-hidden rounded-[7px] border border-l-[3px] shadow-card"
                    :class="appt.status === 'booked' ? 'cursor-grab active:cursor-grabbing' : ''"
                    :style="{
                      ...appointmentColorStyle(appt),
                      ...cascadeStyle(appt, DAY_CASCADE_PX),
                      top: `${timeToPx(appt.starts_at, DAY_HOUR_PX)}px`,
                      height: `${Math.max(0, durationToPx(appt.starts_at, appt.ends_at, DAY_HOUR_PX, DAY_MIN_BLOCK_PX) - 3)}px`,
                    }"
                    @pointerdown="startAppointmentDrag(appt, 'move', $event)"
                    @click.stop="handleAppointmentClick(appt)"
                    @mouseenter="scheduleHoverCard(appt, $event)"
                    @mouseleave="cancelHoverShow"
                  >
                    <div
                      class="flex h-full flex-col justify-start gap-0.5 px-2"
                      :class="durationToPx(appt.starts_at, appt.ends_at, DAY_HOUR_PX, DAY_MIN_BLOCK_PX) < BLOCK_DROP_ROW3_BELOW || settings.compactRows ? 'py-[2px]' : 'py-1'"
                    >
                      <div class="flex items-center gap-1.5">
                        <span class="flex h-[10px] w-[10px] shrink-0 items-center justify-center rounded-full bg-ink-faint3/50">
                          <span class="h-[6px] w-[6px] shrink-0 rounded-full" :class="dotClass(appt)" />
                        </span>
                        <p class="min-w-0 flex-1 truncate text-[12.5px] font-semibold" :class="[nameClass(appt), { 'blur-sm select-none': settings.privacyMode, 'line-through opacity-70': appt.status === 'cancelled' || appt.status === 'completed' }]">
                          {{ appt.patients?.first_name }} {{ appt.patients?.last_name }}
                        </p>
                        <span
                          v-if="(balanceByPatient[appt.patient_id] ?? 0) > 0"
                          class="relative flex h-[15px] w-[15px] shrink-0 items-center justify-center"
                          @mouseenter="scheduleIconTooltip($event, `${t('Patient in credit', 'Paciente con saldo a favor')} (${formatCredit(balanceByPatient[appt.patient_id] ?? 0)})`)"
                          @mouseleave="cancelIconTooltip"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" class="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]">
                            <path d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                          </svg>
                        </span>
                        <span
                          v-if="!hasFutureAppointment(appt)"
                          class="relative flex h-[15px] w-[15px] shrink-0 items-center justify-center"
                          @mouseenter="scheduleIconTooltip($event, t('No future appointment', 'Sin cita futura'))"
                          @mouseleave="cancelIconTooltip"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" class="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]">
                            <path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5A2.25 2.25 0 015.25 5.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0V11.25A2.25 2.25 0 015.25 9h13.5a2.25 2.25 0 012.25 2.25v7.5M9.75 13.5l4.5 4.5m0-4.5l-4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                          </svg>
                        </span>
                      </div>
                    </div>
                    <div
                      v-if="appt.status === 'booked'"
                      class="absolute inset-x-0 bottom-0 h-[6px] cursor-ns-resize"
                      @pointerdown.stop="startAppointmentDrag(appt, 'resize', $event)"
                    ></div>
                  </div>
                </template>
              </div>

              <div v-if="showNowLine" class="pointer-events-none absolute left-0 right-0 z-20" :style="{ top: `${nowLinePx}px` }">
                <div class="absolute left-0 top-0 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-danger-text"></div>
                <div class="h-px w-full bg-danger-text"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Week view: day columns, each split into room sub-columns like Day view,
             rather than one shared column per day (which forced every room's
             appointments into the same lane-splitting and truncated names down
             to a few characters even when nothing was genuinely double-booked). -->
        <div v-else class="min-w-0 flex-1 overflow-x-auto">
          <div class="flex" :style="{ minWidth: `${58 + visibleWeekDays.length * dayColumns.length * WEEK_ROOM_COL_PX}px` }">
            <div class="sticky left-0 z-20 w-[58px] shrink-0 bg-surface">
              <div class="sticky top-0 z-30 h-[52px] border-b border-r border-line bg-surface"></div>
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
                  class="relative flex h-6 items-center justify-center gap-1 border-b border-line"
                  :class="isSameDate(day, new Date()) ? 'bg-[#F7F7FE]' : ''"
                >
                  <span class="text-[11px] font-semibold uppercase tracking-[.04em] text-ink-muted2">{{ day.toLocaleDateString(undefined, { weekday: 'short' }) }}</span>
                  <span class="text-[12.5px] font-medium" :class="isSameDate(day, new Date()) ? 'text-brand-text' : 'text-ink-900'">{{ day.getDate() }}</span>
                  <button type="button" class="absolute right-1 top-0.5 text-[11px] text-ink-faint hover:text-brand-text" @click.stop="openCreateModalForDay(day)">+</button>
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
                  @click="openCreateModalForRoomOnDayAtY(day, col.id, $event.offsetY)"
                >
                  <div v-for="m in slotMarks" :key="`slot-${m}`" class="pointer-events-none absolute left-0 right-0 border-t border-line" :style="{ top: `${(m / 60) * WEEK_HOUR_PX}px` }" />
                  <div v-for="h in hourMarks" :key="h" class="pointer-events-none absolute left-0 right-0 border-t border-line-control" :style="{ top: `${(h - START_HOUR) * WEEK_HOUR_PX}px` }" />
                  <div v-for="rect in closedSlotRects(day, WEEK_HOUR_PX)" :key="rect.top" class="pointer-events-none absolute left-0 right-0 bg-line-row2" :style="{ top: `${rect.top}px`, height: `${rect.height}px` }" />

                  <div
                    v-for="block in blocksForRoomOnDay(day, col.id)"
                    :key="block.id"
                    class="pointer-events-none absolute left-0 right-0 z-0 flex items-center justify-center overflow-hidden bg-[repeating-linear-gradient(135deg,#F4F5F8,#F4F5F8_6px,#EBECF1_6px,#EBECF1_12px)] font-mono text-[10px] text-ink-muted2"
                    :style="{ top: `${timeToPx(block.starts_at, WEEK_HOUR_PX)}px`, height: `${durationToPx(block.starts_at, block.ends_at, WEEK_HOUR_PX, WEEK_MIN_AVAILABILITY_PX)}px` }"
                  >
                    {{ t('Blocked', 'Bloqueado') }}
                  </div>

                  <template v-for="(appt, i) in layoutForRoomOnDay(day, col.id)" :key="isOverflowBlock(appt) ? `overflow-${toDateKey(day)}-${col.id}-${i}` : appt.id">
                    <button
                      v-if="isOverflowBlock(appt)"
                      type="button"
                      class="absolute flex items-center justify-center overflow-hidden rounded-[7px] border border-line bg-surface text-[10px] font-medium text-ink-muted2 shadow-card hover:border-line-controlHover"
                      :title="`${appt.count} ${appt.count === 1 ? t('more appointment', 'cita más') : t('more appointments', 'citas más')} ${t('at this time -- click to see them all in Day view', 'a esta hora -- haz clic para verlas todas en la vista Día')}`"
                      :style="{
                        ...cascadeStyle(appt, WEEK_CASCADE_PX),
                        top: `${timeToPx(appt.starts_at, WEEK_HOUR_PX)}px`,
                        height: `${OVERFLOW_CHIP_PX}px`,
                      }"
                      @click.stop="showOverflowDay(day)"
                    >
                      +{{ appt.count }}
                    </button>
                    <div
                      v-else
                      class="absolute flex flex-col justify-start overflow-hidden rounded-[7px] border border-l-[3px] px-1.5 py-0.5 shadow-card"
                      :class="appt.status === 'booked' ? 'cursor-grab active:cursor-grabbing' : ''"
                      :style="{
                        ...appointmentColorStyle(appt),
                        ...cascadeStyle(appt, WEEK_CASCADE_PX),
                        top: `${timeToPx(appt.starts_at, WEEK_HOUR_PX)}px`,
                        height: `${Math.max(0, durationToPx(appt.starts_at, appt.ends_at, WEEK_HOUR_PX, WEEK_MIN_BLOCK_PX) - 2)}px`,
                      }"
                      @pointerdown="startAppointmentDrag(appt, 'move', $event)"
                      @click.stop="handleAppointmentClick(appt)"
                      @mouseenter="scheduleHoverCard(appt, $event)"
                      @mouseleave="cancelHoverShow"
                    >
                      <div class="flex items-center gap-1">
                        <span class="flex h-[9px] w-[9px] shrink-0 items-center justify-center rounded-full bg-ink-faint3/50">
                          <span class="h-[5px] w-[5px] shrink-0 rounded-full" :class="dotClass(appt)" />
                        </span>
                        <p class="min-w-0 flex-1 truncate text-[11px] font-semibold" :class="[nameClass(appt), { 'blur-sm select-none': settings.privacyMode, 'line-through opacity-70': appt.status === 'cancelled' || appt.status === 'completed' }]">
                          {{ appt.patients?.first_name }} {{ appt.patients?.last_name }}
                        </p>
                        <span
                          v-if="(balanceByPatient[appt.patient_id] ?? 0) > 0"
                          class="relative flex h-[14px] w-[14px] shrink-0 items-center justify-center"
                          @mouseenter="scheduleIconTooltip($event, `${t('Patient in credit', 'Paciente con saldo a favor')} (${formatCredit(balanceByPatient[appt.patient_id] ?? 0)})`)"
                          @mouseleave="cancelIconTooltip"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" class="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]">
                            <path d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                          </svg>
                        </span>
                        <span
                          v-if="!hasFutureAppointment(appt)"
                          class="relative flex h-[14px] w-[14px] shrink-0 items-center justify-center"
                          @mouseenter="scheduleIconTooltip($event, t('No future appointment', 'Sin cita futura'))"
                          @mouseleave="cancelIconTooltip"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" class="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]">
                            <path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5A2.25 2.25 0 015.25 5.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0V11.25A2.25 2.25 0 015.25 9h13.5a2.25 2.25 0 012.25 2.25v7.5M9.75 13.5l4.5 4.5m0-4.5l-4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                          </svg>
                        </span>
                      </div>
                      <div
                        v-if="appt.status === 'booked'"
                        class="absolute inset-x-0 bottom-0 h-[6px] cursor-ns-resize"
                        @pointerdown.stop="startAppointmentDrag(appt, 'resize', $event)"
                      ></div>
                    </div>
                  </template>
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
      @close="modalOpen = false"
      @saved="onSaved"
    />

    <CalendarAppointmentModal
      v-if="modalOpen && modalMode === 'edit'"
      mode="edit"
      :rooms="rooms"
      :appointment-types="appointmentTypes"
      :team-members="teamMembers"
      :appointment="editingAppointment ?? undefined"
      :prefill-date="prefill?.date"
      :prefill-time="prefill?.time"
      :prefill-room-id="prefill?.roomId"
      @close="modalOpen = false"
      @saved="onSaved"
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
      :block="editingBlock ?? undefined"
      :prefill-date="blockPrefill?.date"
      :prefill-time="blockPrefill?.time"
      :prefill-room-id="blockPrefill?.roomId"
      @close="blockModalOpen = false"
      @saved="onBlockSaved"
    />

    <CashShiftModal v-if="cashShiftOpen" @close="cashShiftOpen = false" />

    <CalendarAppointmentHoverCard
      v-if="hoveredAppt"
      :appointment="hoveredAppt"
      :room-name="hoveredRoomName"
      :overrides="overrides"
      class="fixed z-30"
      :style="{ left: `${hoverPos.x}px`, top: `${hoverPos.y}px` }"
      @mouseenter="keepHoverCard"
      @mouseleave="hideHoverCard"
      @note-saved="loadAppointments"
      @check-in="toggleCheckedIn(hoveredAppt)"
    />

    <div
      v-if="iconTooltip"
      class="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[calc(100%+6px)] whitespace-nowrap rounded-ctlSm bg-ink-900 px-2 py-1 text-[11px] font-medium text-white shadow-popover"
      :style="{ left: `${iconTooltip.x}px`, top: `${iconTooltip.y}px` }"
    >
      {{ iconTooltip.text }}
    </div>
  </div>
</template>

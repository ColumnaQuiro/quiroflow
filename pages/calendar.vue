<script setup lang="ts">
import { hasBusinessHoursConfigured, isWithinBusinessHours } from '~/utils/businessHours'

const START_HOUR = 8
const END_HOUR = 20
const TOTAL_MIN = (END_HOUR - START_HOUR) * 60

// Row scale per the redesign spec: day view gets a taller 76px/hour so a
// two-line block (time + name) always has room; week view stays compact at
// 44px/hour. These replace the old single SLOT_PX-per-clinic-slot constant.
const DAY_HOUR_PX = 76
const WEEK_HOUR_PX = 44

// Historical bug: appointment blocks used to clip the patient name on short
// (e.g. 30min) appointments because the block's minimum pixel height was too
// small. These floors are sized for the new row scale so a 2-line block
// (time range + name) always fits, even for a 15min appointment at the
// smallest clinic slot size -- content that doesn't fit drops the 3rd
// (appointment type) row instead of clipping the name (see BLOCK_DROP_ROW3_BELOW).
const DAY_MIN_BLOCK_PX = 36
const WEEK_MIN_BLOCK_PX = 32
const BLOCK_DROP_ROW3_BELOW = 46
// Availability/unavailable bands only need to fit a centered one-line label.
const DAY_MIN_AVAILABILITY_PX = 20
const WEEK_MIN_AVAILABILITY_PX = 16

interface Room { id: string; name: string }
interface AppointmentType { id: string; name: string; duration_minutes: number; color: string; default_price_cents: number }
interface TeamMember { id: string; full_name: string; color: string }
interface PatientOption { id: string; first_name: string; last_name: string | null }

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
  note: string | null
  patients: { first_name: string; last_name: string | null } | null
  appointment_types: { name: string; color: string } | null
  team_members: { full_name: string; color: string } | null
}

const supabase = useSupabaseClient()
const store = useAccountStore()

const SLOT_MIN = computed(() => store.currentClinic?.slot_duration_minutes ?? 30)

const viewMode = ref<'day' | 'week'>('day')
const anchorDate = ref(new Date())
const rooms = ref<Room[]>([])
const appointmentTypes = ref<AppointmentType[]>([])
const teamMembers = ref<TeamMember[]>([])
const patients = ref<PatientOption[]>([])
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
  flowTracker: false,
  showAvailability: true,
  hideCancelled: true,
  compactRows: false,
})
const displayToggles: { key: keyof typeof settings; label: string }[] = [
  { key: 'privacyMode', label: 'Privacy mode' },
  { key: 'flowTracker', label: 'Flow tracker' },
  { key: 'showAvailability', label: 'Show availability' },
  { key: 'hideCancelled', label: 'Hide cancelled' },
  { key: 'compactRows', label: 'Compact rows' },
]

function pad(n: number) {
  return String(n).padStart(2, '0')
}
function hm(iso: string) {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
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

const rangeLabel = computed(() => {
  if (viewMode.value === 'day') {
    return anchorDate.value.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
  }
  const end = addDays(weekStart.value, 6)
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

async function loadReferenceData() {
  const [{ data: types }, { data: members }, { data: pts }] = await Promise.all([
    supabase.from('appointment_types').select('id, name, duration_minutes, color, default_price_cents').order('name'),
    supabase.from('team_members').select('id, full_name, color').order('full_name'),
    supabase.from('patients').select('id, first_name, last_name').order('first_name'),
  ])
  appointmentTypes.value = types ?? []
  teamMembers.value = members ?? []
  patients.value = pts ?? []
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

  const { data } = await supabase
    .from('appointments')
    .select(
      'id, patient_id, room_id, practitioner_id, appointment_type_id, starts_at, ends_at, status, checked_in_at, flow_with_practitioner_at, flow_checkout_at, rescheduled, confirmation_status, note, patients(first_name, last_name), appointment_types(name, color), team_members(full_name, color)',
    )
    .eq('clinic_id', store.currentClinicId)
    .gte('starts_at', rangeStart.toISOString())
    .lt('starts_at', rangeEnd.toISOString())
    .order('starts_at')

  appointments.value = (data as unknown as AppointmentRow[]) ?? []
  loading.value = false
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
// independently of the main grid's date range.
const todayGlance = ref({ booked: 0, completed: 0, unconfirmed: 0, freeSlots: 0 })
async function loadTodayGlance() {
  if (!store.currentClinicId) {
    todayGlance.value = { booked: 0, completed: 0, unconfirmed: 0, freeSlots: 0 }
    return
  }
  const start = startOfDay(new Date())
  const end = addDays(start, 1)
  const { data } = await supabase
    .from('appointments')
    .select('status, confirmation_status')
    .eq('clinic_id', store.currentClinicId)
    .gte('starts_at', start.toISOString())
    .lt('starts_at', end.toISOString())
    .neq('status', 'cancelled')
  const rows = data ?? []
  const booked = rows.filter((r) => r.status === 'booked').length
  const completed = rows.filter((r) => r.status === 'completed').length
  const unconfirmed = rows.filter((r) => r.status === 'booked' && (r.confirmation_status === 'pending' || r.confirmation_status === 'reschedule_requested')).length
  const capacity = Math.max(rooms.value.length, 1) * (TOTAL_MIN / SLOT_MIN.value)
  const freeSlots = Math.max(0, capacity - rows.length)
  todayGlance.value = { booked, completed, unconfirmed, freeSlots }
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
watch([viewMode, anchorDate], async () => {
  await loadAppointments()
  await loadAvailabilityBlocks()
})

const dayColumns = computed(() => [...rooms.value, { id: '__none', name: 'Unassigned' }])

function blocksForRoom(roomId: string) {
  if (!settings.showAvailability) return []
  return availabilityBlocks.value.filter((b) => b.room_id === roomId || b.room_id === null)
}
function blocksForDay(day: Date) {
  if (!settings.showAvailability) return []
  const dayStart = startOfDay(day).getTime()
  const dayEnd = addDays(startOfDay(day), 1).getTime()
  return availabilityBlocks.value.filter(
    (b) => new Date(b.starts_at).getTime() < dayEnd && new Date(b.ends_at).getTime() > dayStart,
  )
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
  return true
}

function appointmentsForRoom(roomId: string) {
  return appointments.value.filter((a) => (a.room_id ?? '__none') === roomId && isApptVisible(a))
}
function appointmentsForDay(day: Date) {
  const key = toDateKey(day)
  return appointments.value
    .filter((a) => toDateKey(new Date(a.starts_at)) === key && isApptVisible(a))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
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

const dayGridHeight = computed(() => (END_HOUR - START_HOUR) * DAY_HOUR_PX)
const weekGridHeight = computed(() => (END_HOUR - START_HOUR) * WEEK_HOUR_PX)
const hourMarks = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)
function hourLabel(h: number) {
  return `${pad(h)}:00`
}

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
const STATUS_STYLES: Record<VisualStatus, { blockClass: string; dotClass: string; label: string; pillTone: 'brand' | 'success' | 'warning' | 'danger' | 'neutral' }> = {
  booked: { blockClass: 'border-brand-tintDeepBorder border-l-brand bg-brand-tintDeep', dotClass: 'bg-brand', label: 'Booked', pillTone: 'brand' },
  completed: { blockClass: 'border-success-border2 border-l-success-accent bg-success-bg2', dotClass: 'bg-success-accent', label: 'Completed', pillTone: 'success' },
  unconfirmed: { blockClass: 'border-warning-border border-l-warning-accent bg-warning-bg2', dotClass: 'bg-warning-accent', label: 'Unconfirmed', pillTone: 'warning' },
  no_show: { blockClass: 'border-danger-border border-l-danger-text bg-danger-bg2', dotClass: 'bg-danger-text', label: 'No-show', pillTone: 'danger' },
  cancelled: { blockClass: 'border-chip-border border-l-ink-faint3 bg-chip-bg2', dotClass: 'bg-ink-faint3', label: 'Cancelled', pillTone: 'neutral' },
}
const statusLegend = (Object.keys(STATUS_STYLES) as VisualStatus[]).map((key) => ({ key, ...STATUS_STYLES[key] }))

function blockClass(appt: AppointmentRow) {
  return STATUS_STYLES[appointmentVisualStatus(appt)].blockClass
}
function dotClass(appt: AppointmentRow) {
  return STATUS_STYLES[appointmentVisualStatus(appt)].dotClass
}
function timeRangeLabel(appt: AppointmentRow) {
  return `${hm(appt.starts_at)}–${hm(appt.ends_at)}`
}

function openCreateModal(roomId?: string, clickY?: number) {
  const time = clickY !== undefined ? pxToTime(clickY, DAY_HOUR_PX) : '09:00'
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
  prefill.value = { date: toDateKey(day), time: pxToTime(clickY, WEEK_HOUR_PX), roomId: '' }
  modalMode.value = 'create'
  editingAppointment.value = null
  modalOpen.value = true
}

interface LaidOutAppointment extends AppointmentRow {
  _col: number
  _totalCols: number
}

// Week view doesn't split columns by room, so appointments in different
// rooms at the same time can overlap within a single day column -- assign
// each a lane via a greedy sweep (grouped into clusters of transitively
// overlapping appointments) so overlapping ones sit side by side instead of
// stacking on top of each other.
function layoutForDay(day: Date): LaidOutAppointment[] {
  const sorted = appointmentsForDay(day) as LaidOutAppointment[]
  const result: LaidOutAppointment[] = []
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
      colEnds[col] = new Date(appt.ends_at).getTime()
      appt._col = col
    }
    for (const appt of cluster) appt._totalCols = colEnds.length
    result.push(...cluster)
    cluster = []
    clusterEnd = -Infinity
  }

  for (const appt of sorted) {
    const start = new Date(appt.starts_at).getTime()
    const end = new Date(appt.ends_at).getTime()
    if (cluster.length > 0 && start >= clusterEnd) flush()
    cluster.push(appt)
    clusterEnd = Math.max(clusterEnd, end)
  }
  flush()
  return result
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

function scheduleHoverCard(appt: AppointmentRow, event: MouseEvent) {
  if (hoverHideTimer) {
    clearTimeout(hoverHideTimer)
    hoverHideTimer = null
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  hoverShowTimer = setTimeout(() => {
    hoveredAppt.value = appt
    hoverPos.value = {
      x: Math.min(rect.right + 10, window.innerWidth - 316),
      y: Math.max(8, Math.min(rect.top, window.innerHeight - 380)),
    }
  }, 350)
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
const hoveredRoomName = computed(() => rooms.value.find((r) => r.id === hoveredAppt.value?.room_id)?.name ?? null)

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
const nowLinePx = computed(() => timeToPx(now.value.toISOString(), DAY_HOUR_PX))
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-6">
      <div class="flex items-center gap-4">
        <h1 class="text-[18px] font-[640] tracking-tightTitle text-ink-900">Calendar</h1>
        <div class="flex items-center gap-1">
          <button type="button" class="flex h-[26px] w-[26px] items-center justify-center rounded-ctlSm border border-line-control text-ink-500 hover:border-line-controlHover hover:bg-surface-subtle" @click="stepDate(-1)">
            <svg width="7" height="11" viewBox="0 0 7 11" fill="none"><path d="M6 1L1 5.5L6 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <button type="button" class="flex h-[26px] items-center rounded-ctlSm border border-line-control px-2.5 text-[12.5px] font-medium text-ink-600 hover:border-line-controlHover hover:bg-surface-subtle" @click="goToday">Today</button>
          <button type="button" class="flex h-[26px] w-[26px] items-center justify-center rounded-ctlSm border border-line-control text-ink-500 hover:border-line-controlHover hover:bg-surface-subtle" @click="stepDate(1)">
            <svg width="7" height="11" viewBox="0 0 7 11" fill="none"><path d="M1 1L6 5.5L1 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        </div>
        <span class="text-[13.5px] font-[560] text-ink-700">{{ rangeLabel }}</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="flex items-center rounded-ctlSm border border-line-control p-0.5 text-[12.5px]">
          <button type="button" class="rounded-[5px] px-2.5 py-1 font-medium" :class="viewMode === 'day' ? 'bg-brand text-white' : 'text-ink-500 hover:bg-surface-subtle'" @click="viewMode = 'day'">Day</button>
          <button type="button" class="rounded-[5px] px-2.5 py-1 font-medium" :class="viewMode === 'week' ? 'bg-brand text-white' : 'text-ink-500 hover:bg-surface-subtle'" @click="viewMode = 'week'">Week</button>
        </div>
        <UiBtn variant="secondary" size="sm" @click="openBlockCreateModal()">Block time</UiBtn>
        <UiBtn variant="primary" size="sm" @click="openCreateModal()">+ New Appointment</UiBtn>
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
            <span v-for="d in ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']" :key="d" class="text-[10px] font-medium uppercase text-ink-faint">{{ d }}</span>
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
          <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-faint">Today at a glance</p>
          <div class="mt-2 space-y-1.5">
            <div class="flex items-center justify-between text-[12.5px]">
              <span class="text-ink-600">Booked</span>
              <span class="font-mono text-[12.5px] font-medium text-ink-900">{{ todayGlance.booked }}</span>
            </div>
            <div class="flex items-center justify-between text-[12.5px]">
              <span class="text-success-text">Completed</span>
              <span class="font-mono text-[12.5px] font-medium text-success-text">{{ todayGlance.completed }}</span>
            </div>
            <div class="flex items-center justify-between text-[12.5px]">
              <span class="text-warning-text">Unconfirmed</span>
              <span class="font-mono text-[12.5px] font-medium text-warning-text">{{ todayGlance.unconfirmed }}</span>
            </div>
            <div class="flex items-center justify-between text-[12.5px]">
              <span class="text-ink-muted2">Free slots</span>
              <span class="font-mono text-[12.5px] font-medium text-ink-muted2">{{ todayGlance.freeSlots }}</span>
            </div>
          </div>
        </div>

        <div class="mx-3 mt-3 rounded-card border border-line bg-surface p-3">
          <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-faint">Display</p>
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
          <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-faint">Status key</p>
          <div class="mt-2 space-y-1.5">
            <div v-for="item in statusLegend" :key="item.key" class="flex items-center gap-2 text-[12.5px] text-ink-600">
              <span class="h-[7px] w-[7px] shrink-0 rounded-full" :class="item.dotClass" />
              {{ item.label }}
            </div>
          </div>
        </div>
      </aside>

      <!-- Main content -->
      <div class="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <CalendarFlowTracker
          v-if="settings.flowTracker"
          class="m-4"
          :appointments="appointments"
          :privacy-mode="settings.privacyMode"
          @advance="advanceFlow"
          @complete="completeFlow"
        />

        <div v-if="loading" class="p-6 text-[13px] text-ink-faint">Loading…</div>

        <div v-else-if="!store.currentClinicId" class="p-6 text-[13px] text-ink-faint">
          No clinic selected.
        </div>

        <!-- Day view: room columns -->
        <div v-else-if="viewMode === 'day'" class="min-w-0 flex-1 overflow-x-auto">
          <div :style="{ minWidth: `${58 + dayColumns.length * 220}px` }">
            <div class="sticky top-0 z-10 flex bg-surface">
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
                  :style="{ top: `${(h - START_HOUR) * DAY_HOUR_PX - 7}px` }"
                >
                  {{ hourLabel(h) }}
                </span>
              </div>

              <div v-for="col in dayColumns" :key="col.id" class="relative flex-1 cursor-pointer border-r border-line last:border-r-0" @click="openCreateModal(col.id === '__none' ? undefined : col.id, $event.offsetY)">
                <div v-for="h in hourMarks" :key="h" class="pointer-events-none absolute left-0 right-0 border-t border-line-faint" :style="{ top: `${(h - START_HOUR) * DAY_HOUR_PX}px` }" />
                <div v-for="rect in closedSlotRects(anchorDate, DAY_HOUR_PX)" :key="rect.top" class="pointer-events-none absolute left-0 right-0 bg-line-row2" :style="{ top: `${rect.top}px`, height: `${rect.height}px` }" />

                <div
                  v-for="block in blocksForRoom(col.id)"
                  :key="block.id"
                  class="absolute left-0 right-0 z-0 flex items-center justify-center overflow-hidden bg-[repeating-linear-gradient(135deg,#F4F5F8,#F4F5F8_6px,#EBECF1_6px,#EBECF1_12px)] font-mono text-[10.5px] text-ink-muted2"
                  :style="{ top: `${timeToPx(block.starts_at, DAY_HOUR_PX)}px`, height: `${durationToPx(block.starts_at, block.ends_at, DAY_HOUR_PX, DAY_MIN_AVAILABILITY_PX)}px` }"
                  @click.stop="openBlockEditModal(block)"
                >
                  {{ block.note || (block.room_id === null ? 'Blocked (whole clinic)' : 'Blocked') }}
                </div>

                <div
                  v-for="appt in appointmentsForRoom(col.id)"
                  :key="appt.id"
                  class="absolute left-1 right-1 z-[1] overflow-hidden rounded-[7px] border border-l-[3px]"
                  :class="blockClass(appt)"
                  :style="{ top: `${timeToPx(appt.starts_at, DAY_HOUR_PX)}px`, height: `${durationToPx(appt.starts_at, appt.ends_at, DAY_HOUR_PX, DAY_MIN_BLOCK_PX)}px` }"
                  @click.stop="openEditModal(appt)"
                  @mouseenter="scheduleHoverCard(appt, $event)"
                  @mouseleave="cancelHoverShow"
                >
                  <div
                    class="flex h-full flex-col justify-center gap-0.5 px-2"
                    :class="durationToPx(appt.starts_at, appt.ends_at, DAY_HOUR_PX, DAY_MIN_BLOCK_PX) < BLOCK_DROP_ROW3_BELOW || settings.compactRows ? 'py-[3px]' : 'py-1.5'"
                  >
                    <div class="flex items-center justify-between gap-1">
                      <span class="font-mono text-[10.5px] text-ink-muted2">{{ timeRangeLabel(appt) }}</span>
                      <span class="h-[6px] w-[6px] shrink-0 rounded-full" :class="dotClass(appt)" />
                    </div>
                    <p class="truncate text-[12.5px] font-semibold text-ink-900" :class="{ 'blur-sm select-none': settings.privacyMode, 'line-through opacity-70': appt.status === 'cancelled' }">
                      {{ appt.patients?.first_name }} {{ appt.patients?.last_name }}
                    </p>
                    <p v-if="!(durationToPx(appt.starts_at, appt.ends_at, DAY_HOUR_PX, DAY_MIN_BLOCK_PX) < BLOCK_DROP_ROW3_BELOW || settings.compactRows)" class="truncate text-[11.5px] text-ink-muted2">
                      {{ appt.appointment_types?.name ?? '—' }}
                    </p>
                  </div>
                </div>
              </div>

              <div v-if="showNowLine" class="pointer-events-none absolute left-0 right-0 z-20" :style="{ top: `${nowLinePx}px` }">
                <div class="absolute left-0 top-0 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-danger-text"></div>
                <div class="h-px w-full bg-danger-text"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Week view: time grid, one column per day -->
        <div v-else class="min-w-0 flex-1 overflow-x-auto">
          <div :style="{ minWidth: `${58 + weekDays.length * 170}px` }">
            <div class="sticky top-0 z-10 flex bg-surface">
              <div class="h-11 w-[58px] shrink-0 border-b border-r border-line"></div>
              <div
                v-for="day in weekDays"
                :key="toDateKey(day)"
                class="relative flex h-11 flex-1 flex-col items-center justify-center gap-0.5 border-b border-r border-line last:border-r-0"
                :class="isSameDate(day, new Date()) ? 'bg-[#F7F7FE]' : ''"
              >
                <span class="text-[11px] font-semibold uppercase tracking-[.04em] text-ink-muted2">{{ day.toLocaleDateString(undefined, { weekday: 'short' }) }}</span>
                <span class="text-[13px] font-medium" :class="isSameDate(day, new Date()) ? 'text-brand-text' : 'text-ink-900'">{{ day.getDate() }}</span>
                <button type="button" class="absolute right-1.5 top-1.5 text-[12px] text-ink-faint hover:text-brand-text" @click.stop="openCreateModalForDay(day)">+</button>
              </div>
            </div>

            <div class="relative flex" :style="{ height: `${weekGridHeight}px` }">
              <div class="relative w-[58px] shrink-0 border-r border-line">
                <span
                  v-for="h in hourMarks"
                  :key="h"
                  class="pointer-events-none absolute left-0 right-0 px-2 font-mono text-[11px] text-ink-faint"
                  :style="{ top: `${(h - START_HOUR) * WEEK_HOUR_PX - 7}px` }"
                >
                  {{ hourLabel(h) }}
                </span>
              </div>

              <div
                v-for="day in weekDays"
                :key="toDateKey(day)"
                class="relative flex-1 cursor-pointer border-r border-line last:border-r-0"
                @click="openCreateModalForDayAtY(day, $event.offsetY)"
              >
                <div v-for="h in hourMarks" :key="h" class="pointer-events-none absolute left-0 right-0 border-t border-line-faint" :style="{ top: `${(h - START_HOUR) * WEEK_HOUR_PX}px` }" />
                <div v-for="rect in closedSlotRects(day, WEEK_HOUR_PX)" :key="rect.top" class="pointer-events-none absolute left-0 right-0 bg-line-row2" :style="{ top: `${rect.top}px`, height: `${rect.height}px` }" />

                <div
                  v-for="block in blocksForDay(day)"
                  :key="block.id"
                  class="pointer-events-none absolute left-0 right-0 z-0 flex items-center justify-center overflow-hidden bg-[repeating-linear-gradient(135deg,#F4F5F8,#F4F5F8_6px,#EBECF1_6px,#EBECF1_12px)] font-mono text-[10.5px] text-ink-muted2"
                  :style="{ top: `${timeToPx(block.starts_at, WEEK_HOUR_PX)}px`, height: `${durationToPx(block.starts_at, block.ends_at, WEEK_HOUR_PX, WEEK_MIN_AVAILABILITY_PX)}px` }"
                >
                  Blocked
                </div>

                <div
                  v-for="appt in layoutForDay(day)"
                  :key="appt.id"
                  class="absolute z-[1] overflow-hidden rounded-[7px] border border-l-[3px] px-1.5 py-1"
                  :class="blockClass(appt)"
                  :style="{
                    top: `${timeToPx(appt.starts_at, WEEK_HOUR_PX)}px`,
                    height: `${durationToPx(appt.starts_at, appt.ends_at, WEEK_HOUR_PX, WEEK_MIN_BLOCK_PX)}px`,
                    left: `calc(${(appt._col / appt._totalCols) * 100}% + 2px)`,
                    width: `calc(${100 / appt._totalCols}% - 4px)`,
                  }"
                  @click.stop="openEditModal(appt)"
                  @mouseenter="scheduleHoverCard(appt, $event)"
                  @mouseleave="cancelHoverShow"
                >
                  <p class="truncate text-[11px] font-semibold text-ink-900" :class="{ 'blur-sm select-none': settings.privacyMode, 'line-through opacity-70': appt.status === 'cancelled' }">
                    {{ appt.patients?.first_name }}
                  </p>
                  <p class="truncate font-mono text-[10px] text-ink-muted2">{{ hm(appt.starts_at) }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <CalendarAppointmentModal
      v-if="modalOpen"
      :mode="modalMode"
      :rooms="rooms"
      :appointment-types="appointmentTypes"
      :team-members="teamMembers"
      :patients="patients"
      :appointment="editingAppointment ?? undefined"
      :prefill-date="prefill?.date"
      :prefill-time="prefill?.time"
      :prefill-room-id="prefill?.roomId"
      @close="modalOpen = false"
      @saved="onSaved"
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

    <CalendarAppointmentHoverCard
      v-if="hoveredAppt"
      :appointment="hoveredAppt"
      :room-name="hoveredRoomName"
      class="fixed z-30"
      :style="{ left: `${hoverPos.x}px`, top: `${hoverPos.y}px` }"
      @mouseenter="keepHoverCard"
      @mouseleave="hideHoverCard"
      @note-saved="loadAppointments"
      @check-in="toggleCheckedIn(hoveredAppt)"
    />
  </div>
</template>

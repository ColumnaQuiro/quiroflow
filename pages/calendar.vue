<script setup lang="ts">
import { hasBusinessHoursConfigured, isWithinBusinessHours } from '~/utils/businessHours'

const START_HOUR = 8
const END_HOUR = 20
const SLOT_PX = 40
const TOTAL_MIN = (END_HOUR - START_HOUR) * 60

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
  patients: { first_name: string; last_name: string | null } | null
  appointment_types: { name: string; color: string } | null
  team_members: { full_name: string; color: string } | null
}

const supabase = useSupabaseClient()
const store = useAccountStore()

const SLOT_MIN = computed(() => store.currentClinic?.slot_duration_minutes ?? 30)
const GRID_HEIGHT = computed(() => (TOTAL_MIN / SLOT_MIN.value) * SLOT_PX)

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

// Mirrors PracticeHub's Calendar Settings sidebar: Privacy Mode blurs
// patient names, Flow Tracker surfaces the Arrived/With Practitioner/
// Awaiting Checkout board, Availability Auto Display hides empty room
// columns in day view, No Future Appts filters to patients with nothing
// booked ahead.
const settingsOpen = ref(true)
const settings = reactive({
  privacyMode: false,
  flowTracker: false,
  availabilityAutoDisplay: true,
  noFutureAppts: false,
})
const settingsToggles: { key: keyof typeof settings; label: string; tooltip?: string }[] = [
  { key: 'privacyMode', label: 'Privacy Mode' },
  { key: 'flowTracker', label: 'Flow Tracker' },
  { key: 'availabilityAutoDisplay', label: 'Availability Auto Display', tooltip: "Automatically show/hide rooms based on today's activity. Only available for day view." },
  { key: 'noFutureAppts', label: 'No Future Appts', tooltip: 'Only display patients that have no future appointment (as of today).' },
]

// Filter by Appointment Status, matching PracticeHub's checkbox list.
// "Rescheduled" reads the lightweight `rescheduled` flag set when an
// appointment's date/time is edited in place (not full reschedule history).
const statusFilters = reactive({
  completed: true,
  booked: true,
  rescheduled: false,
  cancelled: false,
  no_show: true,
})
const statusFilterLabels: { key: keyof typeof statusFilters; label: string }[] = [
  { key: 'completed', label: 'Completed' },
  { key: 'booked', label: 'Unprocessed' },
  { key: 'rescheduled', label: 'Rescheduled' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'no_show', label: 'Missed' },
]
const showNonAppts = ref(true)

const showAllStatuses = computed({
  get: () => Object.values(statusFilters).every(Boolean) && showNonAppts.value,
  set: (value: boolean) => {
    for (const key of Object.keys(statusFilters) as (keyof typeof statusFilters)[]) statusFilters[key] = value
    showNonAppts.value = value
  },
})

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

const rangeLabel = computed(() => {
  if (viewMode.value === 'day') {
    return anchorDate.value.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
  }
  const end = addDays(weekStart.value, 6)
  return `${weekStart.value.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
})

// Mini two-month date picker in the sidebar, matching PracticeHub's
// navigator: prev/next steps the first month, the second always trails it
// by one, and clicking a day jumps the main calendar there.
const miniBase = ref(startOfMonth(anchorDate.value))
const miniMonths = computed(() => [miniBase.value, addMonths(miniBase.value, 1)])
function miniCalendarGrid(monthStart: Date): (Date | null)[] {
  const year = monthStart.getFullYear()
  const month = monthStart.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstWeekday = (monthStart.getDay() + 6) % 7
  const cells: (Date | null)[] = Array(firstWeekday).fill(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  return cells
}
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
      'id, patient_id, room_id, practitioner_id, appointment_type_id, starts_at, ends_at, status, checked_in_at, flow_with_practitioner_at, flow_checkout_at, rescheduled, confirmation_status, patients(first_name, last_name), appointment_types(name, color), team_members(full_name, color)',
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

// "No Future Appts": which of the currently-loaded patients have no other
// booked appointment after now, anywhere (not just in the visible range).
const noFutureApptPatientIds = ref<Set<string>>(new Set())
async function refreshNoFutureAppts() {
  if (!settings.noFutureAppts) return
  const patientIds = Array.from(new Set(appointments.value.map((a) => a.patient_id)))
  if (patientIds.length === 0) {
    noFutureApptPatientIds.value = new Set()
    return
  }
  const { data } = await supabase
    .from('appointments')
    .select('patient_id')
    .eq('status', 'booked')
    .gt('starts_at', new Date().toISOString())
    .in('patient_id', patientIds)
  const withFuture = new Set((data ?? []).map((r) => r.patient_id))
  noFutureApptPatientIds.value = new Set(patientIds.filter((id) => !withFuture.has(id)))
}
watch([appointments, () => settings.noFutureAppts], refreshNoFutureAppts)

onMounted(async () => {
  await loadReferenceData()
  await loadRooms()
  await loadAppointments()
  await loadAvailabilityBlocks()
})
watch(() => store.currentClinicId, async () => {
  await loadRooms()
  await loadAppointments()
  await loadAvailabilityBlocks()
})
watch([viewMode, anchorDate], async () => {
  await loadAppointments()
  await loadAvailabilityBlocks()
})

const dayColumns = computed(() => [...rooms.value, { id: '__none', name: 'Unassigned' }])

// Day view only: auto-hide room columns with nothing happening today, so a
// half-empty room list doesn't clutter a quiet day.
const visibleDayColumns = computed(() => {
  if (!settings.availabilityAutoDisplay || viewMode.value !== 'day') return dayColumns.value
  const active = dayColumns.value.filter((col) => appointmentsForRoom(col.id).length > 0 || blocksForRoom(col.id).length > 0)
  return active.length > 0 ? active : dayColumns.value
})

function blocksForRoom(roomId: string) {
  if (!showNonAppts.value) return []
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
  if (!statusFilters[appt.status as 'booked' | 'completed' | 'cancelled' | 'no_show']) return false
  if (appt.rescheduled && !statusFilters.rescheduled) return false
  if (settings.noFutureAppts && !noFutureApptPatientIds.value.has(appt.patient_id)) return false
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

function timeToPx(iso: string) {
  const d = new Date(iso)
  const mins = d.getHours() * 60 + d.getMinutes() - START_HOUR * 60
  return Math.max(0, (mins / SLOT_MIN.value) * SLOT_PX)
}
function durationToPx(startIso: string, endIso: string) {
  const mins = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000
  return Math.max(20, (mins / SLOT_MIN.value) * SLOT_PX)
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

// One label per slot boundary (e.g. 09:00, 09:15, 09:30…), not just per
// hour -- matches the clinic's configured "Calendar slot" granularity.
const slotLabels = computed(() => {
  const totalSlots = TOTAL_MIN / SLOT_MIN.value
  return Array.from({ length: totalSlots }, (_, i) => {
    const fromStart = i * SLOT_MIN.value
    const h = START_HOUR + Math.floor(fromStart / 60)
    const m = fromStart % 60
    return `${pad(h)}:${pad(m)}`
  })
})

function statusTextClass(status: string) {
  if (status === 'cancelled') return 'text-gray-500 line-through opacity-70'
  if (status === 'no_show') return 'text-red-900'
  return 'text-gray-900'
}

// Reflects the patient's WhatsApp reply to a confirmation request (tracked
// server-side already via server/api/whatsapp/webhook.post.ts) directly on
// the calendar block, so staff don't need to open Scheduled Reminders to
// see who confirmed or wants to reschedule.
const CONFIRMATION_BADGES: Record<string, { label: string; class: string }> = {
  pending: { label: 'Awaiting reply', class: 'bg-gray-100 text-gray-600' },
  confirmed: { label: '✓ Confirmed', class: 'bg-green-100 text-green-700' },
  reschedule_requested: { label: '↻ Wants to reschedule', class: 'bg-amber-100 text-amber-700' },
}
function confirmationBadge(status: string | null) {
  return status ? CONFIRMATION_BADGES[status] : null
}

function hexToRgba(hex: string, alpha: number) {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// Appointment type color drives the block's look; status is conveyed via
// statusTextClass (strikethrough/red text) rather than a separate palette,
// so a type-color change is always visible on the calendar.
function appointmentColorStyle(appt: AppointmentRow) {
  const color = appt.appointment_types?.color || '#6366F1'
  return {
    borderLeftColor: color,
    backgroundColor: hexToRgba(color, appt.status === 'cancelled' ? 0.06 : 0.16),
  }
}

function openCreateModal(roomId?: string, clickY?: number) {
  let time = '09:00'
  if (clickY !== undefined) {
    const totalMin = Math.round((clickY / SLOT_PX) * SLOT_MIN.value)
    const snapped = Math.round(totalMin / SLOT_MIN.value) * SLOT_MIN.value
    const h = START_HOUR + Math.floor(snapped / 60)
    const m = snapped % 60
    time = `${pad(h)}:${pad(m)}`
  }
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
  const totalMin = Math.round((clickY / SLOT_PX) * SLOT_MIN.value)
  const snapped = Math.round(totalMin / SLOT_MIN.value) * SLOT_MIN.value
  const h = START_HOUR + Math.floor(snapped / 60)
  const m = snapped % 60
  prefill.value = { date: toDateKey(day), time: `${pad(h)}:${pad(m)}`, roomId: '' }
  modalMode.value = 'create'
  editingAppointment.value = null
  modalOpen.value = true
}

function blocksForDay(day: Date) {
  if (!showNonAppts.value) return []
  const dayStart = startOfDay(day).getTime()
  const dayEnd = addDays(startOfDay(day), 1).getTime()
  return availabilityBlocks.value.filter(
    (b) => new Date(b.starts_at).getTime() < dayEnd && new Date(b.ends_at).getTime() > dayStart,
  )
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
}

const { fire } = useAutomations()

async function toggleCheckedIn(appt: AppointmentRow) {
  const next = appt.checked_in_at ? null : new Date().toISOString()
  appt.checked_in_at = next
  await supabase.from('appointments').update({ checked_in_at: next }).eq('id', appt.id)
  if (next) fire('appointment.checked_in', { patientId: appt.patient_id, appointmentId: appt.id })
}

// Flow Tracker: Arrived (checked_in_at, already tracked elsewhere) -> With
// Practitioner -> Awaiting Checkout -> Complete (marks the appointment
// completed). Scoped to whatever's currently loaded (today, for the
// default Day view), same as the rest of the calendar.
const flowArrived = computed(() =>
  appointments.value.filter((a) => a.checked_in_at && !a.flow_with_practitioner_at && !a.flow_checkout_at && a.status === 'booked'),
)
const flowWithPractitioner = computed(() =>
  appointments.value.filter((a) => a.flow_with_practitioner_at && !a.flow_checkout_at && a.status === 'booked'),
)
const flowAwaitingCheckout = computed(() =>
  appointments.value.filter((a) => a.flow_checkout_at && a.status === 'booked'),
)

async function advanceFlow(appt: AppointmentRow, field: 'flow_with_practitioner_at' | 'flow_checkout_at') {
  const now = new Date().toISOString()
  appt[field] = now
  await supabase.from('appointments').update({ [field]: now }).eq('id', appt.id)
}
async function completeFlow(appt: AppointmentRow) {
  appt.status = 'completed'
  await supabase.from('appointments').update({ status: 'completed' }).eq('id', appt.id)
}
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-semibold text-gray-900">Calendar</h1>
      <button
        type="button"
        class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        @click="openCreateModal()"
      >
        + New Appointment
      </button>
    </div>

    <div class="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start">
      <!-- Sidebar: mini date picker + Calendar Settings -->
      <aside class="w-full shrink-0 space-y-3 lg:w-64">
        <div class="rounded-lg border border-gray-200 bg-white p-3">
          <div class="flex items-center justify-between">
            <button type="button" class="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" @click="miniBase = addMonths(miniBase, -1)">‹</button>
            <span class="text-sm font-semibold text-gray-900">{{ miniMonths[0].toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }}</span>
            <button type="button" class="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" @click="miniBase = addMonths(miniBase, 1)">›</button>
          </div>
          <div class="mt-2 grid grid-cols-7 gap-y-1 text-center">
            <span v-for="d in ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']" :key="d" class="text-[11px] font-medium text-gray-400">{{ d }}</span>
            <template v-for="(cell, i) in miniCalendarGrid(miniMonths[0])" :key="i">
              <button
                v-if="cell"
                type="button"
                class="mx-auto flex h-6 w-6 items-center justify-center rounded-full text-xs hover:bg-gray-100"
                :class="isSameDate(cell, anchorDate) ? 'bg-indigo-600 text-white hover:bg-indigo-600' : 'text-gray-700'"
                @click="selectMiniDate(cell)"
              >
                {{ cell.getDate() }}
              </button>
              <span v-else></span>
            </template>
          </div>
        </div>

        <div class="rounded-lg border border-gray-200 bg-white p-3">
          <div class="text-center text-sm font-semibold text-gray-900">{{ miniMonths[1].toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }}</div>
          <div class="mt-2 grid grid-cols-7 gap-y-1 text-center">
            <span v-for="d in ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']" :key="d" class="text-[11px] font-medium text-gray-400">{{ d }}</span>
            <template v-for="(cell, i) in miniCalendarGrid(miniMonths[1])" :key="i">
              <button
                v-if="cell"
                type="button"
                class="mx-auto flex h-6 w-6 items-center justify-center rounded-full text-xs hover:bg-gray-100"
                :class="isSameDate(cell, anchorDate) ? 'bg-indigo-600 text-white hover:bg-indigo-600' : 'text-gray-700'"
                @click="selectMiniDate(cell)"
              >
                {{ cell.getDate() }}
              </button>
              <span v-else></span>
            </template>
          </div>
        </div>

        <div class="rounded-lg border border-gray-200 bg-white p-3">
          <button type="button" class="flex w-full items-center justify-between text-sm font-semibold text-gray-900" @click="settingsOpen = !settingsOpen">
            Calendar Settings
            <span class="text-gray-400">{{ settingsOpen ? '▲' : '▼' }}</span>
          </button>

          <div v-if="settingsOpen" class="mt-3 space-y-3">
            <div v-for="toggle in settingsToggles" :key="toggle.key" class="flex items-center justify-between gap-2">
              <span class="flex items-center gap-1 text-sm text-gray-700">
                {{ toggle.label }}
                <span v-if="toggle.tooltip" class="cursor-help text-gray-300" :title="toggle.tooltip">ⓘ</span>
              </span>
              <button
                type="button"
                role="switch"
                :aria-checked="settings[toggle.key]"
                class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                :class="settings[toggle.key] ? 'bg-indigo-600' : 'bg-gray-200'"
                @click="settings[toggle.key] = !settings[toggle.key]"
              >
                <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform" :class="settings[toggle.key] ? 'translate-x-4' : 'translate-x-1'" />
              </button>
            </div>

            <div class="border-t border-gray-100 pt-3">
              <p class="text-sm font-semibold text-gray-900">Filter by Appointment Status</p>

              <div class="mt-2 space-y-2">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm text-gray-700">Show All</span>
                  <button
                    type="button"
                    role="switch"
                    :aria-checked="showAllStatuses"
                    class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                    :class="showAllStatuses ? 'bg-indigo-600' : 'bg-gray-200'"
                    @click="showAllStatuses = !showAllStatuses"
                  >
                    <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform" :class="showAllStatuses ? 'translate-x-4' : 'translate-x-1'" />
                  </button>
                </div>
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm text-gray-700">Non Appts</span>
                  <button
                    type="button"
                    role="switch"
                    :aria-checked="showNonAppts"
                    class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                    :class="showNonAppts ? 'bg-indigo-600' : 'bg-gray-200'"
                    @click="showNonAppts = !showNonAppts"
                  >
                    <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform" :class="showNonAppts ? 'translate-x-4' : 'translate-x-1'" />
                  </button>
                </div>
              </div>

              <div class="mt-2 space-y-1.5 border-t border-gray-100 pt-2">
                <label v-for="filter in statusFilterLabels" :key="filter.key" class="flex items-center gap-2 text-sm text-gray-700">
                  <input v-model="statusFilters[filter.key]" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                  {{ filter.label }}
                </label>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <button type="button" class="rounded-md border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50" @click="anchorDate = addDays(anchorDate, viewMode === 'day' ? -1 : -7)">‹</button>
            <button type="button" class="rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50" @click="anchorDate = new Date()">Today</button>
            <button type="button" class="rounded-md border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50" @click="anchorDate = addDays(anchorDate, viewMode === 'day' ? 1 : 7)">›</button>
            <span class="ml-2 text-sm font-medium text-gray-700">{{ rangeLabel }}</span>
          </div>
          <div class="flex items-center gap-3">
            <button type="button" class="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-50" @click="openBlockCreateModal()">
              + Block time
            </button>
            <div class="flex rounded-md border border-gray-300 text-sm">
              <button type="button" class="px-3 py-1" :class="viewMode === 'day' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'" @click="viewMode = 'day'">Day</button>
              <button type="button" class="border-l border-gray-300 px-3 py-1" :class="viewMode === 'week' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'" @click="viewMode = 'week'">Week</button>
            </div>
          </div>
        </div>

        <!-- Flow Tracker: Arrived / With Practitioner / Awaiting Checkout -->
        <div v-if="settings.flowTracker" class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="rounded-lg border border-gray-200 bg-white p-3">
            <h3 class="text-sm font-semibold text-gray-700">Arrived</h3>
            <div class="mt-2 space-y-2">
              <div v-for="a in flowArrived" :key="a.id" class="flex items-center justify-between gap-2 rounded border border-gray-200 px-2 py-1.5 text-sm">
                <span class="truncate" :class="{ 'blur-sm select-none': settings.privacyMode }">{{ a.patients?.first_name }} {{ a.patients?.last_name }}</span>
                <button type="button" class="shrink-0 text-xs text-indigo-600 hover:text-indigo-500" title="Move to With Practitioner" @click="advanceFlow(a, 'flow_with_practitioner_at')">→</button>
              </div>
              <p v-if="flowArrived.length === 0" class="text-xs text-gray-300">—</p>
            </div>
          </div>
          <div class="rounded-lg border border-gray-200 bg-white p-3">
            <h3 class="text-sm font-semibold text-gray-700">With Practitioner</h3>
            <div class="mt-2 space-y-2">
              <div v-for="a in flowWithPractitioner" :key="a.id" class="flex items-center justify-between gap-2 rounded border border-gray-200 px-2 py-1.5 text-sm">
                <span class="truncate" :class="{ 'blur-sm select-none': settings.privacyMode }">{{ a.patients?.first_name }} {{ a.patients?.last_name }}</span>
                <button type="button" class="shrink-0 text-xs text-indigo-600 hover:text-indigo-500" title="Move to Awaiting Checkout" @click="advanceFlow(a, 'flow_checkout_at')">→</button>
              </div>
              <p v-if="flowWithPractitioner.length === 0" class="text-xs text-gray-300">—</p>
            </div>
          </div>
          <div class="rounded-lg border border-gray-200 bg-white p-3">
            <h3 class="text-sm font-semibold text-gray-700">Awaiting Checkout</h3>
            <div class="mt-2 space-y-2">
              <div v-for="a in flowAwaitingCheckout" :key="a.id" class="flex items-center justify-between gap-2 rounded border border-gray-200 px-2 py-1.5 text-sm">
                <span class="truncate" :class="{ 'blur-sm select-none': settings.privacyMode }">{{ a.patients?.first_name }} {{ a.patients?.last_name }}</span>
                <button type="button" class="shrink-0 text-xs font-medium text-green-600 hover:text-green-500" title="Complete visit" @click="completeFlow(a)">Complete</button>
              </div>
              <p v-if="flowAwaitingCheckout.length === 0" class="text-xs text-gray-300">—</p>
            </div>
          </div>
        </div>

        <div v-if="loading" class="mt-6 text-sm text-gray-400">Loading…</div>

        <div v-else-if="!store.currentClinicId" class="mt-6 text-sm text-gray-400">
          No clinic selected.
        </div>

        <!-- Day view: room columns -->
        <div v-else-if="viewMode === 'day'" class="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <div class="flex" :style="{ minWidth: `${80 + visibleDayColumns.length * 220}px` }">
            <div class="w-20 shrink-0 border-r border-gray-200">
              <div class="h-10 border-b border-gray-200"></div>
              <div
                v-for="(label, i) in slotLabels"
                :key="label"
                :style="{ height: `${SLOT_PX}px` }"
                class="border-b border-gray-100 px-2 pt-1 text-xs"
                :class="[label.endsWith(':00') ? 'text-gray-500' : 'text-gray-300', { 'bg-gray-50': !slotIsOpen(i, anchorDate) }]"
              >
                {{ label }}
              </div>
            </div>
            <div v-for="col in visibleDayColumns" :key="col.id" class="flex-1 border-r border-gray-100 last:border-r-0">
              <div class="flex h-10 items-center justify-center border-b border-gray-200 text-sm font-medium text-gray-700">
                {{ col.name }}
              </div>
              <div
                class="relative cursor-pointer"
                :style="{ height: `${GRID_HEIGHT}px` }"
                @click="openCreateModal(col.id === '__none' ? undefined : col.id, $event.offsetY)"
              >
                <div
                  v-for="(label, i) in slotLabels"
                  :key="i"
                  class="pointer-events-none absolute left-0 right-0 border-b border-gray-100"
                  :class="{ 'bg-gray-50': !slotIsOpen(i, anchorDate) }"
                  :style="{ top: `${i * SLOT_PX}px`, height: `${SLOT_PX}px` }"
                ></div>
                <div
                  v-for="block in blocksForRoom(col.id)"
                  :key="block.id"
                  class="absolute left-1 right-1 overflow-hidden rounded border-l-4 border-gray-400 bg-[repeating-linear-gradient(135deg,#f3f4f6,#f3f4f6_6px,#e5e7eb_6px,#e5e7eb_12px)] px-2 py-1 text-xs text-gray-600 shadow-sm"
                  :style="{ top: `${timeToPx(block.starts_at)}px`, height: `${durationToPx(block.starts_at, block.ends_at)}px` }"
                  @click.stop="openBlockEditModal(block)"
                >
                  <p class="truncate font-medium">Blocked{{ block.room_id === null ? ' (whole clinic)' : '' }}</p>
                  <p v-if="block.note" class="truncate">{{ block.note }}</p>
                </div>
                <div
                  v-for="appt in appointmentsForRoom(col.id)"
                  :key="appt.id"
                  class="absolute left-1 right-1 overflow-hidden rounded border-l-4 px-2 py-1 text-xs shadow-sm"
                  :class="statusTextClass(appt.status)"
                  :style="{ top: `${timeToPx(appt.starts_at)}px`, height: `${durationToPx(appt.starts_at, appt.ends_at)}px`, ...appointmentColorStyle(appt) }"
                  @click.stop="openEditModal(appt)"
                >
                  <button
                    type="button"
                    class="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] leading-none"
                    :class="appt.checked_in_at ? 'bg-green-600 text-white' : 'bg-white/70 text-gray-400 hover:text-gray-600'"
                    :title="appt.checked_in_at ? `Arrived ${new Date(appt.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Mark as arrived'"
                    @click.stop="toggleCheckedIn(appt)"
                  >
                    ✓
                  </button>
                  <p class="truncate pr-4 font-medium" :class="{ 'blur-sm select-none': settings.privacyMode }">{{ appt.patients?.first_name }} {{ appt.patients?.last_name }}</p>
                  <p class="truncate">{{ appt.appointment_types?.name ?? new Date(appt.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</p>
                  <p v-if="confirmationBadge(appt.confirmation_status)" class="mt-0.5 inline-block truncate rounded px-1 text-[10px] font-medium" :class="confirmationBadge(appt.confirmation_status)!.class">
                    {{ confirmationBadge(appt.confirmation_status)!.label }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Week view: time grid, one column per day -->
        <div v-else class="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <div class="flex" :style="{ minWidth: `${80 + weekDays.length * 170}px` }">
            <div class="w-20 shrink-0 border-r border-gray-200">
              <div class="h-10 border-b border-gray-200"></div>
              <div
                v-for="label in slotLabels"
                :key="label"
                :style="{ height: `${SLOT_PX}px` }"
                class="border-b border-gray-100 px-2 pt-1 text-xs"
                :class="label.endsWith(':00') ? 'text-gray-500' : 'text-gray-300'"
              >
                {{ label }}
              </div>
            </div>
            <div v-for="day in weekDays" :key="toDateKey(day)" class="flex-1 border-r border-gray-100 last:border-r-0">
              <div class="flex h-10 items-center justify-between gap-1 border-b border-gray-200 px-2 text-sm font-medium text-gray-700">
                <span>{{ day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) }}</span>
                <button type="button" class="text-xs text-indigo-600 hover:text-indigo-500" @click.stop="openCreateModalForDay(day)">+</button>
              </div>
              <div
                class="relative cursor-pointer"
                :style="{ height: `${GRID_HEIGHT}px` }"
                @click="openCreateModalForDayAtY(day, $event.offsetY)"
              >
                <div
                  v-for="(label, i) in slotLabels"
                  :key="i"
                  class="pointer-events-none absolute left-0 right-0 border-b border-gray-100"
                  :class="{ 'bg-gray-50': !slotIsOpen(i, day) }"
                  :style="{ top: `${i * SLOT_PX}px`, height: `${SLOT_PX}px` }"
                ></div>
                <div
                  v-for="block in blocksForDay(day)"
                  :key="block.id"
                  class="pointer-events-none absolute left-1 right-1 overflow-hidden rounded border-l-4 border-gray-400 bg-[repeating-linear-gradient(135deg,#f3f4f6,#f3f4f6_6px,#e5e7eb_6px,#e5e7eb_12px)] px-2 py-1 text-xs text-gray-600 shadow-sm"
                  :style="{ top: `${timeToPx(block.starts_at)}px`, height: `${durationToPx(block.starts_at, block.ends_at)}px` }"
                >
                  <p class="truncate font-medium">Blocked</p>
                </div>
                <div
                  v-for="appt in layoutForDay(day)"
                  :key="appt.id"
                  class="absolute overflow-hidden rounded border-l-4 px-1.5 py-1 text-xs shadow-sm"
                  :class="statusTextClass(appt.status)"
                  :style="{
                    top: `${timeToPx(appt.starts_at)}px`,
                    height: `${durationToPx(appt.starts_at, appt.ends_at)}px`,
                    left: `calc(${(appt._col / appt._totalCols) * 100}% + 2px)`,
                    width: `calc(${100 / appt._totalCols}% - 4px)`,
                    ...appointmentColorStyle(appt),
                  }"
                  @click.stop="openEditModal(appt)"
                >
                  <p class="truncate font-medium" :class="{ 'blur-sm select-none': settings.privacyMode }">{{ appt.patients?.first_name }}</p>
                  <p class="truncate">{{ new Date(appt.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</p>
                  <span
                    v-if="confirmationBadge(appt.confirmation_status)"
                    class="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full"
                    :class="appt.confirmation_status === 'confirmed' ? 'bg-green-500' : appt.confirmation_status === 'reschedule_requested' ? 'bg-amber-500' : 'bg-gray-400'"
                    :title="confirmationBadge(appt.confirmation_status)!.label"
                  ></span>
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
  </div>
</template>

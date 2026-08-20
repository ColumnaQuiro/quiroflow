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

const weekStart = computed(() => startOfWeek(anchorDate.value))
const weekDays = computed(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart.value, i)))

const rangeLabel = computed(() => {
  if (viewMode.value === 'day') {
    return anchorDate.value.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
  }
  const end = addDays(weekStart.value, 6)
  return `${weekStart.value.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
})

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
      'id, patient_id, room_id, practitioner_id, appointment_type_id, starts_at, ends_at, status, patients(first_name, last_name), appointment_types(name, color), team_members(full_name, color)',
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

function blocksForRoom(roomId: string) {
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

function appointmentsForRoom(roomId: string) {
  return appointments.value.filter((a) => (a.room_id ?? '__none') === roomId)
}
function appointmentsForDay(day: Date) {
  const key = toDateKey(day)
  return appointments.value
    .filter((a) => toDateKey(new Date(a.starts_at)) === key)
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
function openEditModal(appointment: AppointmentRow) {
  editingAppointment.value = appointment
  modalMode.value = 'edit'
  modalOpen.value = true
}
async function onSaved() {
  modalOpen.value = false
  await loadAppointments()
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

    <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
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

    <div v-if="loading" class="mt-6 text-sm text-gray-400">Loading…</div>

    <div v-else-if="!store.currentClinicId" class="mt-6 text-sm text-gray-400">
      No clinic selected.
    </div>

    <!-- Day view: room columns -->
    <div v-else-if="viewMode === 'day'" class="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <div class="flex" :style="{ minWidth: `${80 + dayColumns.length * 220}px` }">
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
        <div v-for="col in dayColumns" :key="col.id" class="flex-1 border-r border-gray-100 last:border-r-0">
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
              <p class="truncate font-medium">{{ appt.patients?.first_name }} {{ appt.patients?.last_name }}</p>
              <p class="truncate">{{ appt.appointment_types?.name ?? new Date(appt.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Week view: agenda per day -->
    <div v-else class="mt-4 grid grid-cols-7 gap-3">
      <div v-for="day in weekDays" :key="toDateKey(day)" class="rounded-lg border border-gray-200 bg-white">
        <div class="flex items-center justify-between border-b border-gray-200 px-2 py-1.5">
          <span class="text-xs font-medium text-gray-700">{{ day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) }}</span>
          <button type="button" class="text-xs text-indigo-600 hover:text-indigo-500" @click="openCreateModalForDay(day)">+</button>
        </div>
        <div class="min-h-[120px] space-y-1 p-1.5">
          <button
            v-for="appt in appointmentsForDay(day)"
            :key="appt.id"
            type="button"
            class="block w-full rounded border-l-4 px-1.5 py-1 text-left text-xs"
            :class="statusTextClass(appt.status)"
            :style="appointmentColorStyle(appt)"
            @click="openEditModal(appt)"
          >
            <p class="truncate font-medium">{{ new Date(appt.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }} {{ appt.patients?.first_name }}</p>
          </button>
          <p v-if="appointmentsForDay(day).length === 0" class="px-1 py-2 text-center text-xs text-gray-300">—</p>
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

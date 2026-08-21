<script setup lang="ts">
// PracticeHub's "Practitioner Dashboard" is a chronological worklist of a
// practitioner's own day, click a patient to jump straight into charting.
// Not built: PH's grid mode (patients currently "with practitioner") --
// day/week + check-in + privacy mode covers the rest of what PH offers.
interface Room { id: string; name: string }
interface AppointmentType { id: string; name: string; duration_minutes: number; color: string; default_price_cents: number }
interface TeamMember { id: string; full_name: string; color: string }
interface PatientOption { id: string; first_name: string; last_name: string | null }

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
  patients: { first_name: string; last_name: string | null } | null
  appointment_types: { name: string; color: string } | null
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const { scope } = usePermission()

const canSeeAll = computed(() => scope('calendar_scope') === 'all')

const viewMode = ref<'day' | 'week'>('day')
const anchorDate = ref(new Date())
const practitionerId = ref(store.teamMember?.id ?? '')
const privacyMode = ref(false)
const flowTracker = ref(false)
const selectedAppointment = ref<AppointmentRow | null>(null)
const rooms = ref<Room[]>([])
const appointmentTypes = ref<AppointmentType[]>([])
const teamMembers = ref<TeamMember[]>([])
const patients = ref<PatientOption[]>([])
const appointments = ref<AppointmentRow[]>([])
const chartedAppointmentIds = ref<Set<string>>(new Set())
const loading = ref(true)

const modalOpen = ref(false)
const editingAppointment = ref<AppointmentRow | null>(null)

function toDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

const weekDays = computed(() => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchorDate.value), i)))

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
  const { data } = await supabase.from('calendar_resources').select('id, name').eq('clinic_id', store.currentClinicId).order('name')
  rooms.value = data ?? []
}

async function loadDay() {
  if (!store.currentClinicId || !practitionerId.value) {
    appointments.value = []
    chartedAppointmentIds.value = new Set()
    return
  }
  loading.value = true
  const rangeStart = viewMode.value === 'day' ? startOfDay(anchorDate.value) : startOfWeek(anchorDate.value)
  const rangeEnd = viewMode.value === 'day' ? addDays(rangeStart, 1) : addDays(rangeStart, 7)

  const { data } = await supabase
    .from('appointments')
    .select(
      'id, patient_id, room_id, practitioner_id, appointment_type_id, starts_at, ends_at, status, checked_in_at, flow_with_practitioner_at, flow_checkout_at, patients(first_name, last_name), appointment_types(name, color)',
    )
    .eq('clinic_id', store.currentClinicId)
    .eq('practitioner_id', practitionerId.value)
    .neq('status', 'cancelled')
    .gte('starts_at', rangeStart.toISOString())
    .lt('starts_at', rangeEnd.toISOString())
    .order('starts_at')

  appointments.value = (data as unknown as AppointmentRow[]) ?? []

  const ids = appointments.value.map((a) => a.id)
  if (ids.length > 0) {
    const { data: notes } = await supabase.from('visit_notes').select('appointment_id').in('appointment_id', ids)
    chartedAppointmentIds.value = new Set((notes ?? []).map((n) => n.appointment_id))
  } else {
    chartedAppointmentIds.value = new Set()
  }
  loading.value = false
}

function appointmentsForDay(day: Date) {
  const key = toDateKey(day)
  return appointments.value.filter((a) => toDateKey(new Date(a.starts_at)) === key)
}

onMounted(async () => {
  await loadReferenceData()
  await loadRooms()
  await loadDay()
})
watch(() => store.currentClinicId, async () => {
  await loadRooms()
  await loadDay()
})
watch([viewMode, anchorDate, practitionerId], loadDay)

function selectAppointment(appointment: AppointmentRow) {
  selectedAppointment.value = appointment
}
function openEditModal(appointment: AppointmentRow) {
  editingAppointment.value = appointment
  modalOpen.value = true
}
async function onSaved() {
  modalOpen.value = false
  await loadDay()
}

const { fire } = useAutomations()

async function toggleCheckedIn(appt: AppointmentRow) {
  const next = appt.checked_in_at ? null : new Date().toISOString()
  appt.checked_in_at = next
  await supabase.from('appointments').update({ checked_in_at: next }).eq('id', appt.id)
  if (next) fire('appointment.checked_in', { patientId: appt.patient_id, appointmentId: appt.id })
}

async function advanceFlow(appt: AppointmentRow, field: 'flow_with_practitioner_at' | 'flow_checkout_at') {
  const now = new Date().toISOString()
  appt[field] = now
  await supabase.from('appointments').update({ [field]: now }).eq('id', appt.id)
}
async function completeFlow(appt: AppointmentRow) {
  appt.status = 'completed'
  await supabase.from('appointments').update({ status: 'completed' }).eq('id', appt.id)
}

const statusClass: Record<string, string> = {
  booked: 'bg-indigo-50 text-indigo-700',
  completed: 'bg-green-50 text-green-700',
  no_show: 'bg-red-50 text-red-700',
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-900">My Day</h1>
        <p class="mt-1 text-sm text-gray-500">Your appointments, chronologically -- click a patient to chart.</p>
      </div>
      <div class="flex gap-2">
        <button
          type="button"
          class="rounded-md border px-3 py-1.5 text-sm font-medium"
          :class="flowTracker ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'"
          @click="flowTracker = !flowTracker"
        >
          Flow Tracker
        </button>
        <button
          type="button"
          class="rounded-md border px-3 py-1.5 text-sm font-medium"
          :class="privacyMode ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'"
          @click="privacyMode = !privacyMode"
        >
          {{ privacyMode ? 'Privacy Mode: On' : 'Privacy Mode' }}
        </button>
      </div>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" class="rounded-md border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50" @click="anchorDate = addDays(anchorDate, viewMode === 'day' ? -1 : -7)">‹</button>
      <button type="button" class="rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50" @click="anchorDate = new Date()">Today</button>
      <button type="button" class="rounded-md border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50" @click="anchorDate = addDays(anchorDate, viewMode === 'day' ? 1 : 7)">›</button>
      <span class="text-sm font-medium text-gray-700">{{ anchorDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) }}</span>

      <div class="flex rounded-md border border-gray-300 text-sm">
        <button type="button" class="px-3 py-1" :class="viewMode === 'day' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'" @click="viewMode = 'day'">Day</button>
        <button type="button" class="border-l border-gray-300 px-3 py-1" :class="viewMode === 'week' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'" @click="viewMode = 'week'">Week</button>
      </div>

      <select v-if="canSeeAll" v-model="practitionerId" class="ml-auto rounded-md border border-gray-300 px-2 py-1.5 text-sm">
        <option v-for="m in teamMembers" :key="m.id" :value="m.id">{{ m.full_name }}</option>
      </select>
    </div>

    <CalendarFlowTracker
      v-if="flowTracker"
      class="mt-4"
      :appointments="appointments"
      :privacy-mode="privacyMode"
      @advance="advanceFlow"
      @complete="completeFlow"
    />

    <div v-if="loading" class="mt-4 rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">Loading…</div>

    <div v-else class="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start">
      <!-- Day view -->
      <div v-if="viewMode === 'day'" class="w-full shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white lg:w-96">
        <div v-if="appointments.length === 0" class="p-8 text-center text-sm text-gray-400">No appointments for this day.</div>
        <ul v-else class="divide-y divide-gray-100">
          <li v-for="a in appointments" :key="a.id">
            <div class="flex w-full items-center gap-3 px-4 py-3 hover:bg-gray-50" :class="{ 'bg-indigo-50': selectedAppointment?.id === a.id }">
              <button
                type="button"
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs"
                :class="a.checked_in_at ? 'bg-green-600 text-white' : 'border border-gray-300 text-gray-300 hover:border-gray-400 hover:text-gray-400'"
                :title="a.checked_in_at ? `Arrived ${new Date(a.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Mark as arrived'"
                @click="toggleCheckedIn(a)"
              >
                ✓
              </button>
              <button type="button" class="flex min-w-0 flex-1 items-center gap-3 text-left" @click="selectAppointment(a)">
                <span class="w-14 shrink-0 text-sm text-gray-500">
                  {{ new Date(a.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
                </span>
                <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ backgroundColor: a.appointment_types?.color ?? '#9CA3AF' }"></span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium text-gray-900" :class="{ 'blur-sm select-none': privacyMode }">{{ a.patients?.first_name }} {{ a.patients?.last_name }}</span>
                  <span class="block truncate text-xs text-gray-500">
                    {{ a.appointment_types?.name ?? 'No type' }}
                    <span v-if="a.checked_in_at" class="text-green-600">&middot; Arrived</span>
                  </span>
                </span>
                <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium" :class="statusClass[a.status] ?? 'bg-gray-100 text-gray-600'">
                  {{ a.status }}
                </span>
                <span class="w-16 shrink-0 text-right text-xs font-medium" :class="chartedAppointmentIds.has(a.id) ? 'text-green-600' : 'text-amber-600'">
                  {{ chartedAppointmentIds.has(a.id) ? 'Charted' : 'Add note' }}
                </span>
              </button>
              <button type="button" class="shrink-0 text-xs text-gray-400 hover:text-gray-600" title="Edit appointment" @click="openEditModal(a)">✏️</button>
            </div>
          </li>
        </ul>
      </div>

      <!-- Week view -->
      <div v-else class="grid w-full grid-cols-7 gap-3">
        <div v-for="day in weekDays" :key="toDateKey(day)" class="rounded-lg border border-gray-200 bg-white">
          <div class="border-b border-gray-200 px-2 py-1.5">
            <span class="text-xs font-medium text-gray-700">{{ day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) }}</span>
          </div>
          <div class="min-h-[120px] space-y-1 p-1.5">
            <button
              v-for="a in appointmentsForDay(day)"
              :key="a.id"
              type="button"
              class="block w-full rounded border-l-4 px-1.5 py-1 text-left text-xs"
              :class="chartedAppointmentIds.has(a.id) ? 'border-green-500 bg-green-50' : 'border-amber-400 bg-amber-50'"
              @click="selectAppointment(a)"
            >
              <p class="truncate font-medium" :class="{ 'blur-sm select-none': privacyMode }">
                {{ new Date(a.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }} {{ a.patients?.first_name }}
              </p>
              <p v-if="a.checked_in_at" class="truncate text-green-600">Arrived</p>
            </button>
            <p v-if="appointmentsForDay(day).length === 0" class="px-1 py-2 text-center text-xs text-gray-300">—</p>
          </div>
        </div>
      </div>

      <!-- My Day patient view -->
      <div v-if="selectedAppointment" class="min-w-0 flex-1 space-y-4">
        <PractitionerMyDayPatientView :appointment="selectedAppointment" @charted="loadDay" />
      </div>
      <div v-else class="hidden flex-1 items-center justify-center rounded-lg border border-dashed border-gray-300 p-10 text-sm text-gray-400 lg:flex">
        Select a patient to chart their visit.
      </div>
    </div>

    <CalendarAppointmentModal
      v-if="modalOpen"
      mode="edit"
      :rooms="rooms"
      :appointment-types="appointmentTypes"
      :team-members="teamMembers"
      :patients="patients"
      :appointment="editingAppointment ?? undefined"
      initial-tab="notes"
      @close="modalOpen = false"
      @saved="onSaved"
    />
  </div>
</template>

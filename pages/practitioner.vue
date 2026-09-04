<script setup lang="ts">
// PracticeHub's "Practitioner Dashboard" is a chronological worklist of a
// practitioner's own day, click a patient to jump straight into charting.
// Not built: PH's grid mode (patients currently "with practitioner") --
// day/week + check-in + privacy mode covers the rest of what PH offers.
//
// Redesign note: the old standalone "Flow Tracker" toggle + 3-column kanban
// (CalendarFlowTracker, still used by pages/calendar.vue) is superseded here
// by the always-on 5-stage summary strip at the top of the worklist panel,
// per the design handoff. It's driven by the same real fields the kanban
// used (checked_in_at, flow_with_practitioner_at, visit_notes existence,
// status) plus one new mapping: "In room" is set the moment a checked-in
// patient is opened for charting (there's no separate "in room" timestamp
// in the schema), and "Invoiced" is approximated by status === 'completed'
// (that's the same transition AppointmentBillingTab performs on payment).
// flow_checkout_at ("awaiting checkout") has no slot in the 5-stage model
// and isn't driven from this screen anymore -- it's still fully live via
// the calendar page's kanban.
interface Room { id: string; name: string }
interface AppointmentType { id: string; name: string; duration_minutes: number; color: string; default_price_cents: number }
interface TeamMember { id: string; full_name: string; color: string }

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
  source: string
  patients: { first_name: string; last_name: string | null } | null
  appointment_types: { name: string; color: string } | null
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const { scope } = usePermission()
const t = useT()

const canSeeAll = computed(() => scope('calendar_scope') === 'all')

const viewMode = ref<'day' | 'week'>('day')
const anchorDate = ref(new Date())
const practitionerId = ref(store.teamMember?.id ?? '')
const privacyMode = ref(false)
const selectedAppointment = ref<AppointmentRow | null>(null)
const rooms = ref<Room[]>([])
const appointmentTypes = ref<AppointmentType[]>([])
const teamMembers = ref<TeamMember[]>([])
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
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const weekDays = computed(() => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchorDate.value), i)))

async function loadReferenceData() {
  const [{ data: types }, { data: members }] = await Promise.all([
    supabase.from('appointment_types').select('id, name, duration_minutes, color, default_price_cents').order('name'),
    supabase.from('team_members').select('id, full_name, color').order('full_name'),
  ])
  appointmentTypes.value = types ?? []
  teamMembers.value = members ?? []
}

async function loadRooms() {
  if (!store.currentClinicId) {
    rooms.value = []
    return
  }
  const { data } = await supabase.from('calendar_resources').select('id, name').eq('clinic_id', store.currentClinicId).order('name')
  rooms.value = data ?? []
}

// "Sign & complete" can trigger two overlapping calls to loadDay() -- one
// from ExamAutofill's first-save @saved emit, another explicit one once the
// status update lands -- and a plain `await` chain doesn't guarantee the
// later call's response also arrives later. This token guards against a
// slow, stale response clobbering a newer one: only the most recently
// *started* call is allowed to commit its results.
let loadDayToken = 0
async function loadDay() {
  const token = ++loadDayToken
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
      'id, patient_id, room_id, practitioner_id, appointment_type_id, starts_at, ends_at, status, checked_in_at, flow_with_practitioner_at, flow_checkout_at, source, patients(first_name, last_name), appointment_types(name, color)',
    )
    .eq('clinic_id', store.currentClinicId)
    .eq('practitioner_id', practitionerId.value)
    .neq('status', 'cancelled')
    .is('deleted_at', null)
    .gte('starts_at', rangeStart.toISOString())
    .lt('starts_at', rangeEnd.toISOString())
    .order('starts_at')

  if (token !== loadDayToken) return

  appointments.value = (data as unknown as AppointmentRow[]) ?? []

  // Keep the selection pointed at the fresh row (not the stale pre-reload
  // object) so the charting pane's header/status reflect what just changed.
  if (selectedAppointment.value) {
    selectedAppointment.value = appointments.value.find((a) => a.id === selectedAppointment.value!.id) ?? null
  }

  const ids = appointments.value.map((a) => a.id)
  if (ids.length > 0) {
    const { data: notes } = await supabase.from('visit_notes').select('appointment_id').in('appointment_id', ids)
    if (token !== loadDayToken) return
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

async function selectAppointment(appointment: AppointmentRow) {
  selectedAppointment.value = appointment
  // Opening the chart is, in practice, the moment the practitioner is now
  // "in room" with the patient -- there's no separate UI for that transition
  // on this screen, so it's inferred here rather than left permanently unset.
  if (appointment.checked_in_at && !appointment.flow_with_practitioner_at && appointment.status === 'booked') {
    const now = new Date().toISOString()
    appointment.flow_with_practitioner_at = now
    await supabase.from('appointments').update({ flow_with_practitioner_at: now }).eq('id', appointment.id)
  }
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

const STATUS_TONE: Record<string, 'brand' | 'success' | 'danger' | 'neutral'> = {
  booked: 'brand',
  completed: 'success',
  no_show: 'danger',
}
function statusTone(status: string) {
  return STATUS_TONE[status] ?? 'neutral'
}
function statusLabel(status: string) {
  if (status === 'no_show') return t('No-show', 'No presentado')
  if (status === 'booked') return t('Booked', 'Reservada')
  if (status === 'completed') return t('Completed', 'Completada')
  return status.charAt(0).toUpperCase() + status.slice(1)
}

const STAGE_NAME_DEFS: [string, string][] = [
  ['Booked', 'Reservada'],
  ['Arrived', 'Llegada'],
  ['In room', 'En consulta'],
  ['Charted', 'Registrada'],
  ['Invoiced', 'Facturada'],
]
function stageIndex(a: AppointmentRow) {
  if (a.status === 'completed') return 4
  if (chartedAppointmentIds.value.has(a.id)) return 3
  if (a.flow_with_practitioner_at) return 2
  if (a.checked_in_at) return 1
  return 0
}
function stageName(a: AppointmentRow) {
  const [en, es] = STAGE_NAME_DEFS[stageIndex(a)]
  return t(en, es)
}

const FLOW_STAGE_DEFS = [
  { key: 'booked', en: 'Booked', es: 'Reservada' },
  { key: 'arrived', en: 'Arrived', es: 'Llegada' },
  { key: 'in_room', en: 'In room', es: 'En consulta' },
  { key: 'charted', en: 'Charted', es: 'Registrada' },
  { key: 'invoiced', en: 'Invoiced', es: 'Facturada' },
] as const

const flowStages = computed(() => {
  const total = appointments.value.length
  const counts: Record<string, number> = {
    booked: total,
    arrived: appointments.value.filter((a) => !!a.checked_in_at).length,
    in_room: appointments.value.filter((a) => !!a.flow_with_practitioner_at).length,
    charted: appointments.value.filter((a) => chartedAppointmentIds.value.has(a.id)).length,
    invoiced: appointments.value.filter((a) => a.status === 'completed').length,
  }
  return FLOW_STAGE_DEFS.map((def) => {
    const count = counts[def.key]
    const barClass = total === 0 || count === 0 ? 'bg-toggle-off' : count === total ? 'bg-success-accent' : 'bg-brand'
    return { key: def.key, label: t(def.en, def.es), count, barClass }
  })
})

const dayLabel = computed(() => anchorDate.value.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }))
const headerMeta = computed(() => {
  if (viewMode.value !== 'day') return dayLabel.value
  const total = appointments.value.length
  const charted = chartedAppointmentIds.value.size
  const visitWord = total === 1 ? t('visit', 'visita') : t('visits', 'visitas')
  return `${dayLabel.value} · ${total} ${visitWord} · ${charted} ${t('charted', 'registradas')}`
})
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-6">
      <div class="flex items-baseline gap-2.5">
        <h1 class="text-[18px] font-[640] tracking-tightTitle text-ink-900">{{ t('My Day', 'Mi Día') }}</h1>
        <p class="text-[12.5px] text-ink-muted2">{{ headerMeta }}</p>
      </div>
      <div class="flex items-center gap-2">
        <div v-if="canSeeAll" class="relative">
          <select
            v-model="practitionerId"
            class="h-8 appearance-none rounded-ctl border border-line-control bg-surface px-2.5 pr-6 text-[13px] text-ink-500 hover:border-line-controlHover focus:border-brand focus:outline-none"
          >
            <option v-for="m in teamMembers" :key="m.id" :value="m.id">{{ m.full_name }}</option>
          </select>
          <svg width="8" height="8" viewBox="0 0 10 10" class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint">
            <path d="M2 4l3 3 3-3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" />
          </svg>
        </div>
        <button
          type="button"
          class="flex h-8 items-center gap-1.5 rounded-ctl border px-2.5 text-[13px] font-medium"
          :class="privacyMode ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-500 hover:border-line-controlHover'"
          @click="privacyMode = !privacyMode"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
            <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
            <circle cx="8" cy="8" r="2" />
          </svg>
          {{ t('Privacy mode', 'Modo privacidad') }}{{ privacyMode ? t(': On', ': activado') : '' }}
        </button>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto bg-surface-page">
      <div class="flex items-center gap-3 border-b border-line bg-surface px-6 py-2.5">
        <button type="button" class="flex h-7 w-7 items-center justify-center rounded-ctlSm border border-line-control text-[13px] text-ink-500 hover:border-line-controlHover" @click="anchorDate = addDays(anchorDate, viewMode === 'day' ? -1 : -7)">‹</button>
        <button type="button" class="flex h-7 items-center rounded-ctlSm border border-line-control px-2.5 text-[12.5px] font-medium text-ink-500 hover:border-line-controlHover" @click="anchorDate = new Date()">{{ t('Today', 'Hoy') }}</button>
        <button type="button" class="flex h-7 w-7 items-center justify-center rounded-ctlSm border border-line-control text-[13px] text-ink-500 hover:border-line-controlHover" @click="anchorDate = addDays(anchorDate, viewMode === 'day' ? 1 : 7)">›</button>
        <span class="text-[13px] font-medium text-ink-700">{{ dayLabel }}</span>

        <div class="ml-auto flex h-8 overflow-hidden rounded-ctl border border-line-control text-[12.5px]">
          <button type="button" class="px-3" :class="viewMode === 'day' ? 'bg-brand font-semibold text-white' : 'text-ink-500 hover:bg-surface-subtle'" @click="viewMode = 'day'">{{ t('Day', 'Día') }}</button>
          <button type="button" class="border-l border-line-control px-3" :class="viewMode === 'week' ? 'bg-brand font-semibold text-white' : 'text-ink-500 hover:bg-surface-subtle'" @click="viewMode = 'week'">{{ t('Week', 'Semana') }}</button>
        </div>
      </div>

      <div v-if="loading" class="flex flex-col gap-4 p-6">
        <UiSkeleton class="h-16 w-full rounded-card" />
        <div class="space-y-2">
          <UiSkeleton v-for="i in 5" :key="i" class="h-12 w-full rounded-ctl" />
        </div>
      </div>

      <div v-else class="flex flex-col gap-4 p-6">
        <!-- Flow tracker: shared summary strip for both Day and Week views -->
        <div class="w-full overflow-hidden rounded-card border border-line bg-surface-sidebar shadow-card">
          <div class="grid grid-cols-5 px-3 py-3">
            <div v-for="stage in flowStages" :key="stage.key" class="flex flex-col items-start gap-1.5 px-1">
              <div class="h-1 w-full rounded-full" :class="stage.barClass" />
              <span class="truncate text-[10.5px] text-ink-muted2">{{ stage.label }}</span>
              <span class="font-mono text-[13px] font-medium text-ink-700">{{ stage.count }}</span>
            </div>
          </div>
        </div>

        <div class="flex items-start gap-4">
        <!-- Day view worklist -->
        <div v-if="viewMode === 'day'" class="w-[404px] shrink-0 overflow-hidden rounded-card border border-line bg-surface-sidebar shadow-card">
          <div v-if="appointments.length === 0" class="p-8 text-center text-[13px] text-ink-faint">{{ t('No appointments for this day.', 'No hay citas para este día.') }}</div>
          <ul v-else class="flex flex-col gap-1 p-2">
            <li v-for="a in appointments" :key="a.id" class="group relative">
              <div
                class="flex cursor-pointer flex-col gap-2 rounded-ctl border px-3 py-2.5"
                :class="selectedAppointment?.id === a.id ? 'border-brand bg-brand-tint shadow-selected' : 'border-transparent hover:bg-[#FAFAFC]'"
                @click="selectAppointment(a)"
              >
                <div class="flex items-center gap-2.5">
                  <button
                    type="button"
                    class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                    :class="a.checked_in_at ? 'bg-success-accent text-white' : 'border border-line-control text-ink-faint3 hover:border-line-controlHover hover:text-ink-muted2'"
                    :title="a.checked_in_at ? `${t('Arrived', 'Llegada')} ${formatTime(a.checked_in_at)}` : t('Mark as arrived', 'Marcar como llegado')"
                    @click.stop="toggleCheckedIn(a)"
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2.5 6.2l2.4 2.4 4.6-5.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
                  </button>
                  <span class="w-[42px] shrink-0 font-mono text-[12px] text-ink-muted2">{{ formatTime(a.starts_at) }}</span>
                  <span
                    class="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-brand-tint text-[10.5px] font-[650] text-brand"
                    :class="{ 'blur-sm select-none': privacyMode }"
                  >
                    {{ ((a.patients?.first_name?.[0] ?? '') + (a.patients?.last_name?.[0] ?? '')).toUpperCase() || '?' }}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-[13.5px] font-[560] text-ink-900" :class="{ 'blur-sm select-none': privacyMode }">{{ a.patients?.first_name }} {{ a.patients?.last_name }}</span>
                    <span class="flex items-center gap-1.5 truncate text-[11.5px] text-ink-muted2">
                      <span class="h-[6px] w-[6px] shrink-0 rounded-full" :style="{ backgroundColor: a.appointment_types?.color ?? '#9CA3AF' }" />
                      {{ a.appointment_types?.name ?? t('No type', 'Sin tipo') }}
                    </span>
                  </span>
                  <UiPill :tone="statusTone(a.status)" dot>{{ statusLabel(a.status) }}</UiPill>
                </div>
                <div class="flex items-center gap-2">
                  <div class="flex flex-1 gap-1">
                    <span v-for="i in 5" :key="i" class="h-[5px] flex-1 rounded-full" :class="i <= stageIndex(a) + 1 ? 'bg-brand' : 'bg-toggle-off'" />
                  </div>
                  <span class="shrink-0 text-[11px] font-medium text-ink-muted2">{{ stageName(a) }}</span>
                </div>
              </div>
              <button
                type="button"
                class="pointer-events-none absolute right-2.5 top-2.5 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100"
                :title="t('Edit appointment', 'Editar cita')"
                @click.stop="openEditModal(a)"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" class="text-ink-faint hover:text-ink-600">
                  <path d="M11 2.5l2.5 2.5-8 8-3 .5.5-3 8-8z" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </li>
          </ul>
        </div>

        <!-- Week view -->
        <div v-else class="grid min-w-0 flex-1 grid-cols-7 gap-3">
          <div v-for="day in weekDays" :key="toDateKey(day)" class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <div class="border-b border-line-row bg-surface-subtle2 px-2 py-1.5">
              <span class="text-[12px] font-medium text-ink-700">{{ day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) }}</span>
            </div>
            <div class="min-h-[120px] space-y-1 p-1.5">
              <button
                v-for="a in appointmentsForDay(day)"
                :key="a.id"
                type="button"
                class="block w-full rounded-ctlSm border-l-[3px] px-1.5 py-1 text-left text-[11.5px]"
                :class="a.status === 'completed' ? 'border-success-accent bg-success-bg2' : 'border-warning-accent bg-warning-bg2'"
                @click="selectAppointment(a)"
              >
                <p class="truncate font-medium text-ink-700" :class="{ 'blur-sm select-none': privacyMode }">
                  {{ formatTime(a.starts_at) }} {{ a.patients?.first_name }}
                </p>
                <p v-if="a.checked_in_at" class="truncate text-success-text">{{ t('Arrived', 'Llegada') }}</p>
              </button>
              <p v-if="appointmentsForDay(day).length === 0" class="px-1 py-2 text-center text-[11.5px] text-ink-faint">—</p>
            </div>
          </div>
        </div>

        <!-- My Day patient view -->
        <div v-if="selectedAppointment" class="min-w-0 flex-1">
          <PractitionerMyDayPatientView :appointment="selectedAppointment" :rooms="rooms" @charted="loadDay" />
        </div>
        <div v-else class="flex min-w-0 flex-1 items-center justify-center rounded-card border border-dashed border-line-control p-10 text-[13px] text-ink-faint">
          {{ t('Select a patient to chart their visit.', 'Selecciona un paciente para registrar su visita.') }}
        </div>
        </div>
      </div>
    </div>

    <CalendarAppointmentModal
      v-if="modalOpen"
      mode="edit"
      :rooms="rooms"
      :appointment-types="appointmentTypes"
      :team-members="teamMembers"
      :appointment="editingAppointment ?? undefined"
      initial-tab="notes"
      @close="modalOpen = false"
      @saved="onSaved"
    />
  </div>
</template>

<script setup lang="ts">
// Kept alive between tabs: back from the Inbox, the agenda is on the same
// day and view, scrolled where it was (useKeptAlive). Named, because the
// keep-alive matches pages by name and every index.vue is called "index".
defineOptions({ name: 'StaffCalendarPage' })
definePageMeta({ layout: 'practitioner', keepalive: true })

// The agenda: the day as a timeline, read in the CLINIC's time zone.
//
// - iPhone: "Mis citas" / "Toda la clínica", one column; visits that overlap
//   sit side by side.
// - "Semana": on iPad a column per day (the scope's visits, overlaps side by
//   side, hold and drag as in the day); on iPhone, seven columns do not fit,
//   so the week is a list grouped by day. Tapping the date opens a picker to
//   jump to any day.
// - iPad: a column per practitioner (the canvas's AppIpadAgenda), and at
//   landscape width the selected visit on the right with Mover / Cancelar.
// - Hold a free slot, or "+", to book (NewVisitSheet -> BookVisitSheet: the
//   same free times and clash check as "Book the next visit"). On iPad, hold a
//   visit and drag it to move it; letting go opens the move sheet at the new
//   time, which re-checks clashes and logs the reschedule as the web does.
// - A read-only calendar (calendar_read_only) sees all of it and changes
//   nothing; someone who sees only their own diary gets only their column.
//
// calendar/index.vue, not calendar.vue: as calendar.vue this was the PARENT
// of calendar/[id].vue, and with no <NuxtPage /> in it the child never
// rendered.
import type { BusinessHours } from '../../../utils/businessHours'

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

interface Appointment {
  id: string
  patient_id: string
  clinic_id: string | null
  starts_at: string
  ends_at: string
  status: string
  checked_in_at: string | null
  practitioner_id: string | null
  room_id: string | null
  appointment_type_id: string | null
  patients: { first_name: string; last_name: string | null } | null
  appointment_types: { name: string; color: string | null } | null
}
interface Block { id: string; starts_at: string; ends_at: string; practitioner_id: string | null; room_id: string | null; note: string | null }
interface Practitioner { id: string; full_name: string; business_hours: BusinessHours | null }

const supabase = useSupabaseClient()
const route = useRoute()
const t = useT()
const locale = computed(() => t('en-GB', 'es-ES'))
const { context, loading: contextLoading, restricted, ownDiaryOnly } = usePractitionerContext()
const tz = computed(() => context.value?.timeZone ?? DEFAULT_CLINIC_TIMEZONE)
const readOnly = computed(() => restricted('calendar_read_only'))

const today = () => clinicDateOf(new Date(), tz.value)
const day = ref(typeof route.query.day === 'string' ? route.query.day : '')
watch(tz, () => { if (!day.value) day.value = today() }, { immediate: true })
// Read against the ticking clock below, so an agenda left open past midnight
// stops calling yesterday "today" (no Today button, the now-line on it).
const todayDate = computed(() => clinicDateOf(now.value, tz.value))
const isToday = computed(() => day.value === todayDate.value)

// -- Day or week ----------------------------------------------------------------
// Remembered on the device: someone who plans by the week keeps seeing it.
const VIEW_KEY = 'quiroflow_agenda_view'
const view = ref<'day' | 'week'>('day')
onMounted(() => {
  try {
    if (localStorage.getItem(VIEW_KEY) === 'week') view.value = 'week'
  } catch {}
})
watch(view, (v) => {
  selectedId.value = null
  try {
    localStorage.setItem(VIEW_KEY, v)
  } catch {}
})
const isWeek = computed(() => view.value === 'week')
// Monday to Sunday around the day being looked at.
const weekStart = computed(() => {
  const dow = new Date(`${day.value}T00:00:00Z`).getUTCDay()
  return addDaysToDate(day.value, -((dow + 6) % 7))
})
const weekDates = computed(() => Array.from({ length: 7 }, (_, i) => addDaysToDate(weekStart.value, i)))
const shownToday = computed(() => (isWeek.value ? weekDates.value.includes(todayDate.value) : isToday.value))

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const fmt = (date: string, o: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00Z`).toLocaleDateString(locale.value, { ...o, timeZone: 'UTC' })
const title = computed(() => {
  if (!isWeek.value) return capital(shortDayLabel(new Date(`${day.value}T12:00:00Z`), locale.value, 'UTC'))
  const first = weekDates.value[0]
  const last = weekDates.value[6]
  const sameMonth = first.slice(0, 7) === last.slice(0, 7)
  return `${sameMonth ? fmt(first, { day: 'numeric' }) : fmt(first, { day: 'numeric', month: 'short' })} – ${fmt(last, { day: 'numeric', month: 'short' })}`
})
const dayHead = (date: string) => capital(fmt(date, { weekday: 'short', day: 'numeric' }))

// Tapping the date opens the device's own date picker.
const datePicker = ref<HTMLInputElement | null>(null)
function openPicker() {
  try {
    datePicker.value?.showPicker()
  } catch {}
}
function jumpTo(e: Event) {
  const v = (e.target as HTMLInputElement).value
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    day.value = v
    selectedId.value = null
  }
}
function openDay(date: string) {
  day.value = date
  view.value = 'day'
}

// -- Width: columns from iPad portrait, the side panel from landscape --------
const wide = ref(false)
const panelWide = ref(false)
onMounted(() => {
  const md = window.matchMedia('(min-width: 768px)')
  const lg = window.matchMedia('(min-width: 1024px)')
  const sync = () => {
    wide.value = md.matches
    panelWide.value = lg.matches
  }
  sync()
  md.addEventListener('change', sync)
  lg.addEventListener('change', sync)
  onBeforeUnmount(() => {
    md.removeEventListener('change', sync)
    lg.removeEventListener('change', sync)
  })
})

// -- Data ---------------------------------------------------------------------
const appointments = ref<Appointment[]>([])
const blocks = ref<Block[]>([])
const practitioners = ref<Practitioner[]>([])
const clinicHours = ref<BusinessHours | null>(null)
const loading = ref(true)
const loadError = ref('')

const amPractitioner = computed(() => !!context.value && practitioners.value.some((p) => p.id === context.value!.teamMemberId))
const scope = ref<'mine' | 'all'>('mine')
const canScopeMine = computed(() => amPractitioner.value && !ownDiaryOnly.value)
watch(amPractitioner, (yes) => { if (!yes && !ownDiaryOnly.value) scope.value = 'all' })
const effectiveScope = computed(() => (ownDiaryOnly.value || (scope.value === 'mine' && amPractitioner.value) ? 'mine' : 'all'))

let loadRun = 0
// The team, their clinic links and the clinic's hours are read once per
// clinic; the minute-by-minute refresh only asks for the day's visits and
// blocks, which are what change.
let staticFor: string | null = null
async function load(quiet = false) {
  if (!context.value?.clinicId || !day.value) {
    loading.value = !!contextLoading.value
    return
  }
  const run = ++loadRun
  if (!quiet) loading.value = true
  loadError.value = ''
  const first = isWeek.value ? weekStart.value : day.value
  const from = startOfLocalDate(first, tz.value).toISOString()
  const to = startOfLocalDate(isWeek.value ? addDaysToDate(first, 7) : nextDate(first), tz.value).toISOString()
  const clinicId = context.value.clinicId
  const needStatic = !quiet || staticFor !== clinicId
  const none = Promise.resolve({ data: null, error: null })
  const [ap, bl, pr, links, cl] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, patient_id, clinic_id, starts_at, ends_at, status, checked_in_at, practitioner_id, room_id, appointment_type_id, patients(first_name, last_name), appointment_types(name, color)')
      .eq('clinic_id', clinicId)
      .neq('status', 'cancelled')
      // Deleted on the web calendar: status stays 'booked', only deleted_at is set.
      .is('deleted_at', null)
      .lt('starts_at', to)
      .gt('ends_at', from)
      .order('starts_at'),
    supabase.from('availability_blocks').select('id, starts_at, ends_at, practitioner_id, room_id, note').eq('clinic_id', clinicId).lt('starts_at', to).gt('ends_at', from),
    needStatic ? supabase.from('team_members').select('id, full_name, business_hours').is('deleted_at', null).eq('is_practitioner', true).order('full_name') : none,
    needStatic ? supabase.from('team_member_clinics').select('team_member_id, clinic_id').eq('clinic_id', clinicId) : none,
    needStatic ? supabase.from('clinics').select('business_hours').eq('id', clinicId).maybeSingle() : none,
  ])
  if (run !== loadRun) return
  const failed = [ap, bl, pr, links, cl].find((r) => r.error)
  if (failed) {
    // A failed read keeps what is on screen; a quiet refresh says nothing.
    if (!quiet) loadError.value = failed.error!.message
    loading.value = false
    return
  }
  appointments.value = (ap.data as unknown as Appointment[] | null) ?? []
  blocks.value = (bl.data as Block[] | null) ?? []
  if (needStatic) {
    const linked = new Set(((links.data as { team_member_id: string }[] | null) ?? []).map((l) => l.team_member_id))
    const everyone = (pr.data as Practitioner[] | null) ?? []
    practitioners.value = linked.size ? everyone.filter((p) => linked.has(p.id)) : everyone
    clinicHours.value = ((cl.data as { business_hours: BusinessHours | null } | null)?.business_hours ?? null)
    staticFor = clinicId
  }
  loading.value = false
}
// A day inside the week already shown needs no new read.
watch([() => context.value?.clinicId, () => (isWeek.value ? `w${weekStart.value}` : day.value)], () => load(), { immediate: true })

// Kept current while it is open: a booking at the desk or online shows up
// without leaving the tab.
let poll: ReturnType<typeof setInterval> | undefined
function onVisible() {
  if (document.visibilityState === 'visible' && active.value) load(true)
}
onMounted(() => {
  poll = setInterval(() => {
    if (active.value) load(true)
  }, 60000)
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
  clearInterval(poll)
  document.removeEventListener('visibilitychange', onVisible)
})

function shiftDay(n: number) {
  day.value = addDaysToDate(day.value, isWeek.value ? n * 7 : n)
  selectedId.value = null
}

// -- Geometry -----------------------------------------------------------------
const HOUR = computed(() => (wide.value ? 72 : 64))
// Minutes from midnight on `date` (the day shown, or a week column's day).
const minuteOfDay = (iso: string | number, date = day.value) => {
  const at = new Date(iso)
  const d = clinicDateOf(at, tz.value)
  if (d < date) return 0
  if (d > date) return 24 * 60
  const { hour, minute } = wallClock(at, tz.value)
  return hour * 60 + minute
}
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
const dateOfIso = (iso: string) => clinicDateOf(new Date(iso), tz.value)
const windowsOn = (date: string) => {
  const key = weekdayKeyOf(date) as keyof BusinessHours
  return [...(clinicHours.value?.[key] ?? []), ...practitioners.value.flatMap((p) => p.business_hours?.[key] ?? [])] as [string, string][]
}
// From the earliest anyone opens to the latest anyone closes that day -- or
// any day of the week shown (8 to 20 when no hours are set), stretched to
// whatever is actually booked.
const range = computed(() => {
  const windows = (isWeek.value ? weekDates.value : [day.value]).flatMap(windowsOn)
  let start = windows.length ? Math.min(...windows.map((w) => toMinutes(w[0]))) : 8 * 60
  let end = windows.length ? Math.max(...windows.map((w) => toMinutes(w[1]))) : 20 * 60
  for (const a of appointments.value) {
    const d = dateOfIso(a.starts_at)
    start = Math.min(start, minuteOfDay(a.starts_at, d))
    end = Math.max(end, minuteOfDay(a.ends_at, d))
  }
  return { start: Math.floor(start / 60) * 60, end: Math.min(24 * 60, Math.ceil(end / 60) * 60) }
})
const hours = computed(() => {
  const out: number[] = []
  for (let m = range.value.start; m < range.value.end; m += 60) out.push(m / 60)
  return out
})
const totalHeight = computed(() => ((range.value.end - range.value.start) / 60) * HOUR.value)
const yOf = (minute: number) => ((minute - range.value.start) / 60) * HOUR.value

// -- Columns ------------------------------------------------------------------
// A column is a practitioner's day, everyone's day, or (week) one day of the
// scope's diary.
interface Column { key: string; practitionerId: string | null; name: string; date: string }
const scopePractitioner = computed(() => (effectiveScope.value === 'mine' ? (context.value?.teamMemberId ?? null) : null))
// The week's days: the ones anyone works or anything is booked on, so a
// clinic closed at weekends gets five wider columns, not seven.
const weekColumnsDates = computed(() => {
  const busy = new Set(appointments.value.map((a) => dateOfIso(a.starts_at)))
  const open = weekDates.value.filter((d) => windowsOn(d).length || busy.has(d))
  return open.length ? open : weekDates.value.slice(0, 5)
})
const columns = computed<Column[]>(() => {
  if (isWeek.value) return weekColumnsDates.value.map((date) => ({ key: date, practitionerId: scopePractitioner.value, name: dayHead(date), date }))
  const me = context.value?.teamMemberId ?? null
  if (effectiveScope.value === 'mine') return [{ key: 'mine', practitionerId: me, name: context.value?.fullName ?? '', date: day.value }]
  if (!wide.value || practitioners.value.length === 0) return [{ key: 'all', practitionerId: null, name: '', date: day.value }]
  return practitioners.value.map((p) => ({ key: p.id, practitionerId: p.id, name: p.full_name, date: day.value }))
})
const showColumnHeads = computed(() => columns.value.length > 1 || isWeek.value)

const MIN_TILE = 22
interface Placed { a: Appointment; top: number; height: number; lane: number; lanes: number }
function layout(list: Appointment[], date: string): Placed[] {
  const sorted = [...list].sort((x, y) => Date.parse(x.starts_at) - Date.parse(y.starts_at))
  const out: Placed[] = []
  let cluster: Placed[] = []
  let clusterEnd = -1
  let laneEnds: number[] = []
  const flush = () => {
    const lanes = laneEnds.length || 1
    for (const p of cluster) p.lanes = lanes
    cluster = []
    laneEnds = []
  }
  // Lanes go by how tall a tile is DRAWN, not by the visit's minutes: a tile is
  // never shorter than MIN_TILE px, which on a phone is ~20 minutes, so three
  // back-to-back 15-minute visits shared a lane and each covered the next.
  const drawnMinutes = (MIN_TILE * 60) / HOUR.value
  for (const a of sorted) {
    const s = minuteOfDay(a.starts_at, date)
    const e = Math.max(s + 10, minuteOfDay(a.ends_at, date))
    const drawnEnd = Math.max(e, s + drawnMinutes)
    if (s >= clusterEnd) flush()
    let lane = laneEnds.findIndex((end) => end <= s)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(drawnEnd)
    } else laneEnds[lane] = drawnEnd
    clusterEnd = Math.max(clusterEnd, drawnEnd)
    const p: Placed = { a, top: yOf(s), height: Math.max(MIN_TILE, yOf(e) - yOf(s)), lane, lanes: 1 }
    cluster.push(p)
    out.push(p)
  }
  flush()
  return out
}
const placedByColumn = computed(() => {
  const map: Record<string, Placed[]> = {}
  for (const c of columns.value) {
    const list = appointments.value.filter((a) => (!c.practitionerId || a.practitioner_id === c.practitionerId) && (!isWeek.value || dateOfIso(a.starts_at) === c.date))
    map[c.key] = layout(list, c.date)
  }
  return map
})
// A practitioner's own blocks in their column; a whole-clinic closure in every
// column. A room's block closes the room, not a diary, so it is not drawn.
function blocksFor(c: Column) {
  return blocks.value
    .filter((b) => (b.practitioner_id === null && b.room_id === null) || (c.practitionerId !== null && b.practitioner_id === c.practitionerId))
    .map((b) => ({ b, s: minuteOfDay(b.starts_at, c.date), e: minuteOfDay(b.ends_at, c.date) }))
    // A block on another day of the week sits wholly before or after this one.
    .filter(({ s, e }) => e > s)
    .map(({ b, s, e }) => {
      return { b, top: yOf(Math.max(s, range.value.start)), height: Math.max(18, yOf(Math.min(e, range.value.end)) - yOf(Math.max(s, range.value.start))) }
    })
}

const now = ref(new Date())
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => { tick = setInterval(() => (now.value = new Date()), 30000) })
onBeforeUnmount(() => clearInterval(tick))
const nowTop = computed(() => {
  if (!shownToday.value) return null
  const m = minuteOfDay(now.value.toISOString(), todayDate.value)
  return m >= range.value.start && m <= range.value.end ? yOf(m) : null
})

// Scrolled to now (or the first visit) when a day opens.
const scroller = ref<HTMLElement | null>(null)
// While another tab is showing, the poll rests; coming back catches up.
const { active } = useKeptAlive({ scrollers: [scroller], onReturn: () => load(true) })
watch([loading, day, view], async ([l]) => {
  if (l) return
  await nextTick()
  const firsts = appointments.value.map((a) => minuteOfDay(a.starts_at, dateOfIso(a.starts_at)))
  const target = nowTop.value ?? (firsts.length ? yOf(Math.min(...firsts)) : 0)
  scroller.value?.scrollTo({ top: Math.max(0, target - 80) })
})

const weekList = computed(() =>
  weekDates.value.map((date) => ({
    date,
    items: appointments.value.filter((a) => dateOfIso(a.starts_at) === date && (!scopePractitioner.value || a.practitioner_id === scopePractitioner.value)),
  })),
)
const timeLabel = (iso: string) => clinicTimeLabel(new Date(iso), tz.value)
const { privacy, togglePrivacy, shown } = usePrivacyMode()
const nameOf = (a: Appointment) => `${a.patients?.first_name ?? ''} ${a.patients?.last_name ?? ''}`.trim()
const practitionerName = (id: string | null) => practitioners.value.find((p) => p.id === id)?.full_name ?? null
function tint(color: string | null | undefined) {
  const c = color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#4F46E5'
  return { background: `${c}1F`, borderLeftColor: c }
}

// -- Selection (the side panel on a wide iPad) ---------------------------------
const selectedId = ref<string | null>(null)
const selected = computed(() => appointments.value.find((a) => a.id === selectedId.value) ?? null)
function open(a: Appointment) {
  if (suppressClick) {
    suppressClick = false
    return
  }
  if (panelWide.value) selectedId.value = a.id
  else navigateTo(`/calendar/${a.id}`)
}
const canChange = (a: Appointment) => !readOnly.value && a.status === 'booked'

// -- Sheets --------------------------------------------------------------------
const newVisit = ref<{ preferredStart: string | null; practitionerId: string | null; date?: string } | null>(null)
const moveFor = ref<{ a: Appointment; preferredStart: string | null; practitionerId: string | null; date?: string } | null>(null)
const cancelFor = ref<Appointment | null>(null)
const blockAt = ref<{ time: string | null; practitionerId: string | null } | null>(null)
const notice = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | undefined
function say(message: string) {
  notice.value = message
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = ''), 3500)
}
function columnPractitioner(c: Column) {
  return c.practitionerId ?? (amPractitioner.value ? context.value!.teamMemberId : null)
}
function startNew() {
  newVisit.value = { preferredStart: null, practitionerId: effectiveScope.value === 'mine' ? (context.value?.teamMemberId ?? null) : null }
}
async function afterBooked(b: { appointmentId: string }, message: string) {
  newVisit.value = null
  moveFor.value = null
  await load(true)
  if (panelWide.value) selectedId.value = b.appointmentId
  say(message)
}
async function afterCancelled(message: string) {
  cancelFor.value = null
  selectedId.value = null
  await load(true)
  say(message)
}
async function afterBlocked() {
  blockAt.value = null
  await load(true)
  say(t('Time blocked.', 'Tiempo bloqueado.'))
}

// -- Holding a free slot, dragging a visit --------------------------------------
// A press held still for half a second; any movement first is a scroll.
const HOLD_MS = 450
const SNAP = 15
let holdTimer: ReturnType<typeof setTimeout> | undefined
let pressStart: { x: number; y: number } | null = null
let suppressClick = false
const ghost = ref<{ columnKey: string; top: number; label: string } | null>(null)

function minuteAtY(column: HTMLElement, clientY: number) {
  const rect = column.getBoundingClientRect()
  const m = range.value.start + ((clientY - rect.top) / HOUR.value) * 60
  return Math.max(range.value.start, Math.min(range.value.end - SNAP, Math.floor(m / SNAP) * SNAP))
}
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

function cancelHold() {
  clearTimeout(holdTimer)
  pressStart = null
}
function onSlotDown(e: PointerEvent, c: Column) {
  if (readOnly.value || (e.target as HTMLElement).closest('[data-appt],[data-block]')) return
  const column = e.currentTarget as HTMLElement
  pressStart = { x: e.clientX, y: e.clientY }
  const y = e.clientY
  clearTimeout(holdTimer)
  holdTimer = setTimeout(() => {
    pressStart = null
    const m = minuteAtY(column, y)
    ghost.value = { columnKey: c.key, top: yOf(m), label: hhmm(m) }
    navigator.vibrate?.(10)
    newVisit.value = { preferredStart: new Date(wallClockToUtc(c.date, hhmm(m), tz.value)).toISOString(), practitionerId: columnPractitioner(c), date: c.date }
  }, HOLD_MS)
}
function onPointerMove(e: PointerEvent) {
  if (pressStart && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 8) cancelHold()
  if (drag.value) moveDrag(e)
}
watch(newVisit, (v) => { if (!v) ghost.value = null })

// Dragging (iPad): hold a visit, then move it -- across the day and between
// practitioners' columns. Nothing is written on letting go: the move sheet
// opens at the new time, which checks clashes again and asks whether to tell
// the patient.
const drag = ref<{ a: Appointment; columnKey: string; offsetMin: number; minute: number; duration: number } | null>(null)
const columnEls = ref<Record<string, HTMLElement>>({})
function setColumnEl(key: string, el: unknown) {
  if (el) columnEls.value[key] = el as HTMLElement
}
function onApptDown(e: PointerEvent, a: Appointment, c: Column) {
  if (!wide.value || !canChange(a)) return
  pressStart = { x: e.clientX, y: e.clientY }
  const y = e.clientY
  clearTimeout(holdTimer)
  holdTimer = setTimeout(() => {
    pressStart = null
    const s = minuteOfDay(a.starts_at, c.date)
    const col = columnEls.value[c.key]
    const at = col ? minuteAtY(col, y) : s
    drag.value = { a, columnKey: c.key, offsetMin: at - s, minute: s, duration: minuteOfDay(a.ends_at, c.date) - s }
    navigator.vibrate?.(10)
  }, HOLD_MS)
}
function moveDrag(e: PointerEvent) {
  const d = drag.value!
  for (const [key, el] of Object.entries(columnEls.value)) {
    const r = el.getBoundingClientRect()
    if (e.clientX >= r.left && e.clientX < r.right) d.columnKey = key
  }
  const col = columnEls.value[d.columnKey]
  if (!col) return
  const r = col.getBoundingClientRect()
  const raw = range.value.start + ((e.clientY - r.top) / HOUR.value) * 60 - d.offsetMin
  d.minute = Math.max(range.value.start, Math.min(range.value.end - d.duration, Math.round(raw / SNAP) * SNAP))
}
function onPointerUp() {
  cancelHold()
  const d = drag.value
  if (!d) return
  drag.value = null
  suppressClick = true
  setTimeout(() => (suppressClick = false), 400)
  const c = columns.value.find((x) => x.key === d.columnKey)
  const practitionerId = c?.practitionerId ?? d.a.practitioner_id
  const date = c?.date ?? day.value
  if (date === dateOfIso(d.a.starts_at) && d.minute === minuteOfDay(d.a.starts_at, date) && practitionerId === d.a.practitioner_id) return
  moveFor.value = { a: d.a, preferredStart: new Date(wallClockToUtc(date, hhmm(d.minute), tz.value)).toISOString(), practitionerId, date }
}
// While a visit is being dragged the page must not scroll under the finger.
function onTouchMove(e: TouchEvent) {
  if (drag.value) e.preventDefault()
}
onMounted(() => document.addEventListener('touchmove', onTouchMove, { passive: false }))
onBeforeUnmount(() => document.removeEventListener('touchmove', onTouchMove))
</script>

<template>
  <div class="flex h-full min-h-0 select-none flex-col bg-surface-page" style="-webkit-touch-callout: none" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp">
    <!-- Day bar -->
    <div class="flex shrink-0 items-center gap-1.5 border-b border-line bg-surface px-3 py-2 md:px-5">
      <div class="relative min-w-0 flex-1">
        <button type="button" class="flex max-w-full items-center gap-1 rounded-ctl py-1 text-left" :aria-label="t(`${title}. Choose a date`, `${title}. Elegir fecha`)" data-cy="agenda-day" @click="openPicker">
          <span class="truncate text-[17px] font-semibold text-ink-900">{{ title }}</span>
          <AppChevron dir="down" class="text-ink-muted" />
        </button>
        <!-- Over the title, invisible: a tap on it is a tap on the native picker
             wherever showPicker() is not supported. -->
        <input ref="datePicker" type="date" :value="day" class="absolute inset-0 h-full w-full cursor-pointer opacity-0" tabindex="-1" aria-hidden="true" data-cy="agenda-date-input" @change="jumpTo" />
      </div>
      <button v-if="!shownToday" type="button" class="h-9 rounded-ctl border border-line-control px-3 text-[13px] font-medium text-ink-700" data-cy="agenda-today" @click="day = today(); selectedId = null">{{ t('Today', 'Hoy') }}</button>
      <button type="button" class="flex h-9 w-9 items-center justify-center rounded-ctl border border-line-control text-ink-700" :aria-label="isWeek ? t('Previous week', 'Semana anterior') : t('Previous day', 'Día anterior')" data-cy="agenda-prev" @click="shiftDay(-1)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <button type="button" class="flex h-9 w-9 items-center justify-center rounded-ctl border border-line-control text-ink-700" :aria-label="isWeek ? t('Next week', 'Semana siguiente') : t('Next day', 'Día siguiente')" data-cy="agenda-next" @click="shiftDay(1)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </button>
      <template v-if="!readOnly">
        <button type="button" class="flex h-9 w-9 items-center justify-center rounded-ctl border" :class="privacy ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-700'" role="switch" :aria-checked="privacy" :aria-label="t('Privacy mode: names as initials', 'Modo privacidad: nombres como iniciales')" data-cy="agenda-privacy" @click="togglePrivacy">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path v-if="!privacy" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle v-if="!privacy" cx="12" cy="12" r="3" /><path v-if="privacy" d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0112 5c6.5 0 10 7 10 7a17.6 17.6 0 01-3.1 4M6.6 6.6C3.9 8.3 2 12 2 12s3.5 7 10 7a9.7 9.7 0 005.4-1.6M9.9 9.9a3 3 0 004.2 4.2" /></svg>
        </button>
        <button type="button" class="flex h-9 w-9 items-center justify-center rounded-ctl border border-line-control text-ink-700 md:w-auto md:gap-1.5 md:px-3" :aria-label="t('Block time', 'Bloquear tiempo')" data-cy="agenda-block" @click="blockAt = { time: null, practitionerId: effectiveScope === 'mine' ? (context?.teamMemberId ?? null) : null }">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></svg>
          <span class="hidden text-[13px] font-medium md:inline">{{ t('Block', 'Bloquear') }}</span>
        </button>
        <button type="button" class="flex h-9 w-9 items-center justify-center rounded-ctl bg-brand text-white md:w-auto md:gap-1.5 md:px-3.5" :aria-label="t('New visit', 'Nueva cita')" data-cy="agenda-new" @click="startNew">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          <span class="hidden text-[13.5px] font-semibold md:inline">{{ t('New visit', 'Nueva cita') }}</span>
        </button>
      </template>
    </div>

    <div class="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 pb-2 pt-1 md:px-5">
      <div v-if="canScopeMine" role="tablist" :aria-label="t('Whose diary', 'De quién')" class="grid min-w-0 flex-1 grid-cols-2 gap-1 rounded-ctl bg-chip-bg p-[3px] md:max-w-[360px]">
        <button v-for="s in (['mine', 'all'] as const)" :key="s" type="button" role="tab" :aria-selected="effectiveScope === s" class="h-8 min-w-0 truncate whitespace-nowrap rounded-ctlSm px-1.5 text-[13px] font-semibold" :class="effectiveScope === s ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-muted'" :data-cy="`agenda-scope-${s}`" @click="scope = s; selectedId = null">
          {{ s === 'mine' ? t('My visits', 'Mis citas') : t('Whole clinic', 'Toda la clínica') }}
        </button>
      </div>
      <div v-else class="flex-1" />
      <div role="tablist" :aria-label="t('View', 'Vista')" class="grid w-[148px] shrink-0 grid-cols-2 gap-1 rounded-ctl bg-chip-bg p-[3px]">
        <button v-for="v in (['day', 'week'] as const)" :key="v" type="button" role="tab" :aria-selected="view === v" class="h-8 rounded-ctlSm text-[13px] font-semibold" :class="view === v ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-muted'" :data-cy="`agenda-view-${v}`" @click="view = v">
          {{ v === 'day' ? t('Day', 'Día') : t('Week', 'Semana') }}
        </button>
      </div>
    </div>

    <div class="flex min-h-0 flex-1">
      <div class="flex min-w-0 flex-1 flex-col bg-surface">
        <AppSkeletonList v-if="contextLoading || loading" :rows="6" class="flex-1" />
        <p v-else-if="loadError" class="m-4 rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text">{{ loadError }}</p>
        <!-- iPhone week: the days as a list -->
        <div v-else-if="isWeek && !wide" class="min-h-0 flex-1 overflow-y-auto bg-surface-page px-3 py-3" data-cy="agenda-week-list">
          <section v-for="d in weekList" :key="d.date" class="mb-3" data-cy="agenda-week-day">
            <button type="button" class="tap-target flex w-full items-center justify-between px-1 pb-1.5 text-left" :data-cy="`agenda-week-open-${d.date}`" @click="openDay(d.date)">
              <span class="text-[13px] font-semibold" :class="d.date === todayDate ? 'text-brand-text' : 'text-ink-700'">{{ capital(fmt(d.date, { weekday: 'long', day: 'numeric', month: 'short' })) }}</span>
              <span class="flex items-center gap-1 text-[12px] text-ink-muted">{{ d.items.length ? t(`${d.items.length} visits`, `${d.items.length} ${d.items.length === 1 ? 'cita' : 'citas'}`) : '' }}<AppChevron /></span>
            </button>
            <div v-if="d.items.length" class="divide-y divide-line-row overflow-hidden rounded-card border border-line bg-surface shadow-card">
              <button v-for="a in d.items" :key="a.id" type="button" class="flex min-h-12 w-full items-center gap-3 px-3.5 py-2 text-left" :class="a.status === 'completed' || a.status === 'no_show' ? 'opacity-55' : ''" data-cy="agenda-item" :data-appt-id="a.id" @click="open(a)">
                <span class="h-8 w-[3px] shrink-0 rounded-full" :style="{ background: tint(a.appointment_types?.color).borderLeftColor }" />
                <span class="w-11 shrink-0 font-mono text-[12.5px] text-ink-700">{{ timeLabel(a.starts_at) }}</span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[14px] font-semibold text-ink-900" :class="a.status === 'no_show' ? 'line-through' : ''">{{ shown(nameOf(a)) }}</span>
                  <span class="block truncate text-[12px] text-ink-muted">{{ a.appointment_types?.name ?? t('Appointment', 'Cita') }}<template v-if="!scopePractitioner && practitionerName(a.practitioner_id)"> · {{ practitionerName(a.practitioner_id) }}</template></span>
                </span>
                <span v-if="a.checked_in_at && a.status === 'booked'" class="h-2 w-2 shrink-0 rounded-full bg-success-accent" :title="t('Checked in', 'Ha llegado')" />
              </button>
            </div>
            <p v-else class="px-1 text-[12.5px] text-ink-faint">{{ t('Nothing booked.', 'Sin citas.') }}</p>
          </section>
        </div>
        <template v-else>
          <div v-if="showColumnHeads" class="flex shrink-0 border-b border-line pl-12">
            <template v-for="c in columns" :key="c.key">
              <button v-if="isWeek" type="button" class="min-w-0 flex-1 truncate border-l border-line-row px-2 py-2 text-left text-[12.5px] font-semibold" :class="c.date === todayDate ? 'text-brand-text' : 'text-ink-700'" :data-cy="`agenda-week-open-${c.date}`" @click="openDay(c.date)">{{ c.name }}</button>
              <div v-else class="min-w-0 flex-1 truncate border-l border-line-row px-2 py-2 text-[12.5px] font-semibold text-ink-700">{{ c.name }}</div>
            </template>
          </div>
          <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto" data-cy="agenda-timeline">
            <div class="relative flex pl-12" :style="{ height: `${totalHeight + 24}px` }">
              <!-- Hour lines -->
              <div v-for="h in hours" :key="h" class="pointer-events-none absolute left-0 right-0 border-t border-line-row" :style="{ top: `${yOf(h * 60)}px` }">
                <span class="absolute left-2 top-1 font-mono text-[10.5px] text-ink-faint">{{ String(h).padStart(2, '0') }}:00</span>
              </div>

              <div
                v-for="c in columns"
                :key="c.key"
                :ref="(el) => setColumnEl(c.key, el)"
                class="relative min-w-0 flex-1"
                :class="showColumnHeads ? 'border-l border-line-row' : ''"
                :style="{ height: `${totalHeight}px` }"
                data-cy="agenda-column"
                @pointerdown="onSlotDown($event, c)"
              >
                <div
                  v-for="x in blocksFor(c)"
                  :key="x.b.id"
                  data-block
                  class="agenda-blocked absolute left-1 right-1 overflow-hidden rounded-[8px] border border-line px-2 py-1 text-[11.5px] text-ink-muted"
                  :style="{ top: `${x.top + 1}px`, height: `${x.height - 2}px` }"
                  data-cy="agenda-blocked"
                >
                  {{ t('Blocked', 'Bloqueado') }}<template v-if="x.b.note"> · {{ x.b.note }}</template>
                </div>

                <button
                  v-for="p in placedByColumn[c.key]"
                  :key="p.a.id"
                  type="button"
                  data-appt
                  class="absolute overflow-hidden rounded-[8px] border-l-[3px] px-2 py-1 text-left"
                  :class="[p.a.status === 'completed' || p.a.status === 'no_show' ? 'opacity-55' : '', selectedId === p.a.id ? 'ring-2 ring-brand' : '', drag?.a.id === p.a.id ? 'opacity-30' : '']"
                  :style="{ top: `${p.top + 1}px`, height: `${p.height - 2}px`, left: `calc(${(p.lane / p.lanes) * 100}% + 4px)`, width: `calc(${100 / p.lanes}% - 8px)`, ...tint(p.a.appointment_types?.color) }"
                  data-cy="agenda-item"
                  :data-appt-id="p.a.id"
                  @pointerdown.stop="onApptDown($event, p.a, c)"
                  @click="open(p.a)"
                >
                  <span class="flex items-center gap-1.5">
                    <span v-if="p.a.checked_in_at && p.a.status === 'booked'" class="h-1.5 w-1.5 shrink-0 rounded-full bg-success-accent" :title="t('Checked in', 'Ha llegado')" />
                    <span class="truncate text-[12.5px] font-semibold text-ink-900" :class="p.a.status === 'no_show' ? 'line-through' : ''">{{ shown(nameOf(p.a)) }}</span>
                  </span>
                  <span v-if="p.height >= 38" class="block truncate text-[11.5px] text-ink-muted">
                    {{ timeLabel(p.a.starts_at) }} · {{ p.a.appointment_types?.name ?? t('Appointment', 'Cita') }}<template v-if="!c.practitionerId && p.lanes === 1 && practitionerName(p.a.practitioner_id)"> · {{ practitionerName(p.a.practitioner_id) }}</template>
                  </span>
                </button>

                <!-- Now, in today's column of the week -->
                <div v-if="isWeek && nowTop !== null && c.date === todayDate" class="pointer-events-none absolute left-0 right-0 z-10 border-t-2 border-danger-text" :style="{ top: `${nowTop}px` }" data-cy="agenda-now" />
                <!-- Where a held slot will book -->
                <div v-if="ghost && ghost.columnKey === c.key" class="pointer-events-none absolute left-1 right-1 flex items-center rounded-[8px] border-[1.5px] border-dashed border-brand bg-brand-tint px-2 text-[12px] font-semibold text-brand-text" :style="{ top: `${ghost.top + 1}px`, height: `${HOUR / 2 - 2}px` }">
                  + {{ t('New visit at', 'Nueva cita a las') }} {{ ghost.label }}
                </div>
                <!-- Where a dragged visit will land -->
                <div v-if="drag && drag.columnKey === c.key" class="pointer-events-none absolute left-1 right-1 rounded-[8px] border-[1.5px] border-brand bg-surface px-2 py-1 shadow-popover" :style="{ top: `${yOf(drag.minute) + 1}px`, height: `${(drag.duration / 60) * HOUR - 2}px` }" data-cy="agenda-drag">
                  <span class="block truncate text-[12.5px] font-semibold text-ink-900">{{ shown(nameOf(drag.a)) }}</span>
                  <span class="block font-mono text-[11.5px] text-brand-text">{{ hhmm(drag.minute) }}–{{ hhmm(drag.minute + drag.duration) }}</span>
                </div>
              </div>

              <div v-if="!isWeek && nowTop !== null" class="pointer-events-none absolute left-10 right-0 z-10 border-t-2 border-danger-text" :style="{ top: `${nowTop}px` }" data-cy="agenda-now">
                <span class="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-danger-text" />
              </div>
            </div>
            <p v-if="!appointments.length" class="pointer-events-none sticky bottom-4 mx-auto w-fit rounded-full bg-surface px-3 py-1.5 text-[12.5px] text-ink-muted shadow-card">
              <template v-if="isWeek">{{ readOnly ? t('Nothing booked this week.', 'No hay citas esta semana.') : t('Nothing booked this week. Hold a free slot to book.', 'No hay citas esta semana. Mantén pulsado un hueco para reservar.') }}</template>
              <template v-else>{{ readOnly ? t('Nothing booked this day.', 'No hay citas este día.') : t('Nothing booked. Hold a free slot to book.', 'No hay citas. Mantén pulsado un hueco para reservar.') }}</template>
            </p>
          </div>
        </template>
      </div>

      <!-- The selected visit, beside the day (iPad landscape) -->
      <aside v-if="panelWide" class="flex w-[300px] shrink-0 flex-col gap-2.5 border-l border-line bg-surface-page p-3.5" data-cy="agenda-panel">
        <template v-if="selected">
          <div class="rounded-card border border-line bg-surface p-3.5 shadow-card">
            <p class="text-[15px] font-semibold text-ink-900">{{ shown(nameOf(selected)) }}</p>
            <p class="mt-0.5 text-[12.5px] text-ink-muted">
              {{ selected.appointment_types?.name ?? t('Appointment', 'Cita') }} · {{ timeLabel(selected.starts_at) }}–{{ timeLabel(selected.ends_at) }}
            </p>
            <p v-if="practitionerName(selected.practitioner_id)" class="text-[12.5px] text-ink-muted">{{ practitionerName(selected.practitioner_id) }}</p>
            <p v-if="selected.checked_in_at && selected.status === 'booked'" class="mt-2 inline-flex rounded-full bg-success-bg px-2 py-0.5 text-[11.5px] font-semibold text-success-text">{{ t('Checked in', 'Ha llegado') }}</p>
          </div>
          <NuxtLink :to="`/calendar/${selected.id}`" class="flex h-11 items-center justify-center rounded-card bg-brand text-[14.5px] font-semibold text-white" data-cy="agenda-panel-open">{{ t('Open visit', 'Abrir la cita') }}</NuxtLink>
          <div v-if="canChange(selected)" class="grid grid-cols-2 gap-2">
            <button type="button" class="h-10 rounded-ctl border border-line-control bg-surface text-[13.5px] font-medium text-ink-700" data-cy="agenda-panel-move" @click="moveFor = { a: selected, preferredStart: null, practitionerId: selected.practitioner_id }">{{ t('Move', 'Mover') }}</button>
            <button type="button" class="h-10 rounded-ctl border border-line-control bg-surface text-[13.5px] font-medium text-danger-text" data-cy="agenda-panel-cancel" @click="cancelFor = selected">{{ t('Cancel', 'Cancelar') }}</button>
          </div>
          <p v-if="!readOnly" class="mt-1 text-[12px] leading-snug text-ink-faint">{{ t('Drag a visit to move it; hold a free slot to book.', 'Arrastra una cita para moverla; mantén pulsado un hueco para crear una.') }}</p>
        </template>
        <p v-else class="mt-8 px-3 text-center text-[13px] leading-snug text-ink-muted">
          {{ readOnly ? t('Pick a visit to see it.', 'Elige una cita para verla.') : t('Pick a visit to see it. Drag one to move it; hold a free slot to book.', 'Elige una cita para verla. Arrastra una para moverla; mantén pulsado un hueco para reservar.') }}
        </p>
      </aside>
    </div>

    <div v-if="notice" class="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4 md:bottom-6" role="status">
      <span class="rounded-full bg-ink-900 px-4 py-2 text-[13px] font-medium text-surface shadow-popover" data-cy="agenda-notice">{{ notice }}</span>
    </div>

    <NewVisitSheet
      v-if="newVisit"
      :date="newVisit.date ?? day"
      :preferred-start="newVisit.preferredStart"
      :practitioner-id="newVisit.practitionerId"
      @booked="(b) => afterBooked(b, t('Visit booked.', 'Cita reservada.'))"
      @close="newVisit = null"
    />
    <BookVisitSheet
      v-if="moveFor"
      :patient-id="moveFor.a.patient_id"
      :practitioner-id="moveFor.practitionerId"
      :type-id="moveFor.a.appointment_type_id"
      :suggested-date="moveFor.date ?? dateOfIso(moveFor.a.starts_at)"
      :preferred-start="moveFor.preferredStart"
      :title="t(`Move · ${shown(nameOf(moveFor.a))}`, `Mover · ${shown(nameOf(moveFor.a))}`)"
      :move="{ appointmentId: moveFor.a.id, startsAt: moveFor.a.starts_at, endsAt: moveFor.a.ends_at, roomId: moveFor.a.room_id }"
      @booked="(b) => afterBooked(b, t('Visit moved.', 'Cita movida.'))"
      @close="moveFor = null"
    />
    <CancelVisitSheet
      v-if="cancelFor"
      :appointment="{
        id: cancelFor.id,
        patient_id: cancelFor.patient_id,
        clinic_id: cancelFor.clinic_id,
        practitioner_id: cancelFor.practitioner_id,
        appointment_type_id: cancelFor.appointment_type_id,
        starts_at: cancelFor.starts_at,
        ends_at: cancelFor.ends_at,
        patientName: nameOf(cancelFor),
        typeName: cancelFor.appointment_types?.name ?? null,
        practitionerName: practitionerName(cancelFor.practitioner_id),
      }"
      @done="afterCancelled"
      @close="cancelFor = null"
    />
    <BlockTimeSheet
      v-if="blockAt"
      :date="day"
      :time="blockAt.time"
      :practitioner-id="blockAt.practitionerId"
      :practitioners="practitioners"
      @saved="afterBlocked"
      @close="blockAt = null"
    />
  </div>
</template>

<style scoped>
.agenda-blocked {
  /* Theme variables, so the stripes follow a dark theme too. */
  background: repeating-linear-gradient(135deg, rgb(var(--color-line-row)), rgb(var(--color-line-row)) 6px, rgb(var(--color-surface-subtle)) 6px, rgb(var(--color-surface-subtle)) 12px);
}
</style>

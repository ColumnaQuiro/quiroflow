<script setup lang="ts">
import { clinicDateOf, nextDate, startOfLocalDate } from '../../utils/clinicClock'
import { ABSENCE_KINDS, DEFAULT_LEAVE_DAYS, absenceKindLabel, isOpenEndedAbsence, leaveWorkingDays } from '../../utils/staffShifts'
import { absenceInYear, clinicClosedDays, daysOfYear, leaveOverlaps, teamLeaveBalance, type TeamAbsence } from '../../utils/teamLeave'
import { loadLeaveCarryIn, type LeaveCarry } from '../../composables/useLeaveCarryIn'

// Personal > Vacaciones: the whole team's leave across a year, month by month,
// a row per person and a column per day -- the view Turnos (one week) could
// not give. Each kind has its colour; a request still waiting is hatched and
// can be approved or rejected from its cell, through the same endpoint as
// Turnos (decide_staff_absence blocks the calendar). A day two or more
// practitioners are away carries a marker that names them and counts the
// visits booked with each. Dragging across a row records leave agreed in
// person, already approved (record_staff_absence). Owners only, as the page.
// With `memberId` it is one person's year (Personal › their file › Ausencias):
// their row only, no team-wide pending list, and the add form already knows who.
const props = defineProps<{ accountId: string; timeZone: string; memberId?: string }>()
const t = useT()
const { preference: lang } = useLang()
const supabase = useSupabaseClient()
const authedFetch = useAuthedFetch()
const locale = computed(() => (lang.value === 'es' ? 'es-ES' : 'en-GB'))

interface Member { id: string; full_name: string; is_practitioner: boolean; color: string }
interface Absence extends TeamAbsence { note: string | null }

const today = computed(() => clinicDateOf(new Date(), props.timeZone))
const year = ref(Number(today.value.slice(0, 4)))
const members = ref<Member[]>([])
const absences = ref<Absence[]>([])
const allowances = ref<Map<string, number>>(new Map())
const closed = ref<Set<string>>(new Set())
const loaded = ref(false)
const error = ref('')
const carry = ref<LeaveCarry>({ max: 0, of: () => 0 })
const pendingList = ref<{ load: () => Promise<void> } | null>(null)

async function load() {
  const y = year.value
  const [ms, abs, allow, blocks, carried] = await Promise.all([
    props.memberId
      ? supabase.from('team_members').select('id, full_name, is_practitioner, color').eq('account_id', props.accountId).eq('id', props.memberId)
      : supabase.from('team_members').select('id, full_name, is_practitioner, color').eq('account_id', props.accountId).is('deleted_at', null).order('full_name'),
    (props.memberId
      ? supabase.from('staff_absences').select('id, team_member_id, kind, starts_on, ends_on, half_day, status, note').eq('account_id', props.accountId).eq('team_member_id', props.memberId)
      : supabase.from('staff_absences').select('id, team_member_id, kind, starts_on, ends_on, half_day, status, note').eq('account_id', props.accountId)
    ).in('status', ['approved', 'pending']).lte('starts_on', `${y}-12-31`).gte('ends_on', `${y}-01-01`),
    supabase.from('staff_leave_allowances').select('team_member_id, days_per_year').eq('account_id', props.accountId),
    supabase.from('availability_blocks').select('starts_at, ends_at').eq('account_id', props.accountId).is('practitioner_id', null).is('room_id', null).gte('ends_at', `${y - 1}-12-31`).lte('starts_at', `${y}-12-31T23:59:59`),
    loadLeaveCarryIn(supabase, { accountId: props.accountId, year: y, timeZone: props.timeZone, memberId: props.memberId }),
  ])
  carry.value = carried
  error.value = ms.error || abs.error ? t("Couldn't load the team's leave.", 'No se han podido cargar las ausencias del equipo.') : ''
  // Practitioners first: they are the ones whose absence empties a calendar.
  members.value = ((ms.data as Member[] | null) ?? []).sort((a, b) => Number(b.is_practitioner) - Number(a.is_practitioner) || a.full_name.localeCompare(b.full_name))
  absences.value = (abs.data as Absence[] | null) ?? []
  allowances.value = new Map(((allow.data as { team_member_id: string; days_per_year: number }[] | null) ?? []).map((a) => [a.team_member_id, Number(a.days_per_year)]))
  closed.value = clinicClosedDays((blocks.data as { starts_at: string; ends_at: string }[] | null) ?? [], props.timeZone)
  loaded.value = true
}
onMounted(load)
watch(year, () => {
  selected.value = null
  load()
})

// ---- the grid
const months = computed(() => {
  const all = daysOfYear(year.value)
  return Array.from({ length: 12 }, (_, i) => {
    const key = `${year.value}-${String(i + 1).padStart(2, '0')}`
    return { key, label: new Date(`${key}-15T12:00:00Z`).toLocaleDateString(locale.value, { month: 'long', timeZone: 'UTC' }), days: all.filter((d) => d.startsWith(key)) }
  })
})
/** member|day -> the absence covering it. Open-ended ones stop at the year's end. */
const cellAbsence = computed(() => {
  const map = new Map<string, Absence>()
  for (const a of absences.value) {
    const span = absenceInYear(a, year.value)
    if (!span) continue
    for (let d = span.from; d <= span.to; d = nextDate(d)) map.set(`${a.team_member_id}|${d}`, a)
  }
  return map
})
const weekend = (d: string) => {
  const wd = new Date(`${d}T12:00:00Z`).getUTCDay()
  return wd === 0 || wd === 6
}
const practitionerIds = computed(() => new Set(members.value.filter((m) => m.is_practitioner).map((m) => m.id)))
const overlaps = computed(() => leaveOverlaps(absences.value, practitionerIds.value, year.value, closed.value))

const KIND_VAR: Record<string, string> = {
  vacation: '--color-brand',
  personal: '--color-info-accent',
  sick: '--color-warning-accent',
  parental: '--color-success-accent',
  training: '--color-ink-faint',
}
function cellStyle(a: Absence): Record<string, string> {
  const c = `var(${KIND_VAR[a.kind] ?? '--color-ink-faint'})`
  const fill = a.status === 'pending' ? `repeating-linear-gradient(135deg, rgb(${c}) 0 3px, rgb(${c} / .22) 3px 6px)` : `linear-gradient(rgb(${c}), rgb(${c}))`
  // Half a day fills half the cell.
  return { backgroundImage: fill, backgroundSize: a.half_day ? '50% 100%' : '100% 100%', backgroundRepeat: 'no-repeat' }
}
const dayNumber = (d: string) => Number(d.slice(8))
const fmt = (d: string, withYear = false) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale.value, { weekday: 'short', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' })
const memberName = (id: string) => members.value.find((m) => m.id === id)?.full_name ?? ''
function cellTitle(m: Member, d: string) {
  const a = cellAbsence.value.get(`${m.id}|${d}`)
  if (a) return `${m.full_name} · ${absenceKindLabel(a.kind, t)}${a.status === 'pending' ? ` (${t('pending', 'pendiente')})` : ''} · ${fmt(d)}`
  if (closed.value.has(d)) return `${fmt(d)} · ${t('clinic closed', 'clínica cerrada')}`
  return `${m.full_name} · ${fmt(d)}`
}

// ---- the year's figures, per person
const balances = computed(() => new Map(members.value.map((m) => [m.id, teamLeaveBalance(absences.value.filter((a) => a.team_member_id === m.id), (allowances.value.get(m.id) ?? DEFAULT_LEAVE_DAYS) + carry.value.of(m.id), year.value, today.value, closed.value)])))
const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString(locale.value))

// ---- clicking: an absence, or an overlap marker, opens a card under its month
type Selected = { month: string; kind: 'absence'; absence: Absence } | { month: string; kind: 'overlap'; day: string; who: string[] }
const selected = ref<Selected | null>(null)
const overlapVisits = ref<Map<string, number> | null>(null)
async function selectOverlap(month: string, day: string) {
  const who = overlaps.value.get(day) ?? []
  selected.value = { month, kind: 'overlap', day, who }
  overlapVisits.value = null
  const counts = await Promise.all(who.map((id) => countVisits(id, day, day)))
  overlapVisits.value = new Map(who.map((id, i) => [id, counts[i]!]))
}
async function countVisits(memberId: string, from: string, to: string) {
  const { count } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('practitioner_id', memberId)
    .is('deleted_at', null)
    .not('status', 'in', '(cancelled,no_show)')
    .gte('starts_at', startOfLocalDate(from, props.timeZone).toISOString())
    .lt('starts_at', startOfLocalDate(nextDate(to), props.timeZone).toISOString())
  return count ?? 0
}
function spanText(a: Absence) {
  if (isOpenEndedAbsence(a.ends_on)) return t(`from ${fmt(a.starts_on, true)} · no return date`, `desde el ${fmt(a.starts_on, true)} · sin fecha de vuelta`)
  if (a.starts_on === a.ends_on) return `${fmt(a.starts_on, true)}${a.half_day ? t(' (half day)', ' (medio día)') : ''}`
  return `${fmt(a.starts_on)} – ${fmt(a.ends_on, true)}`
}

const deciding = ref(false)
const decideError = ref('')
async function decide(a: Absence, approve: boolean) {
  deciding.value = true
  decideError.value = ''
  try {
    const r = await authedFetch<{ absence: { id: string; team_member_id: string; starts_on: string; ends_on: string; status: string }; visits: number }>(`/api/staff-absences/${a.id}/decide`, { method: 'POST', body: { approve } })
    afterDecided(r)
    selected.value = null
  } catch (e: any) {
    decideError.value = e?.data?.statusMessage ?? t("Couldn't decide it.", 'No se ha podido decidir.')
  } finally {
    deciding.value = false
  }
}

// ---- visits left to move after leave is approved or recorded
const leftToMove = ref<{ who: string; from: string; to: string; count: number } | null>(null)
const moveOpen = ref(false)
function afterDecided(r: { absence: { team_member_id: string; starts_on: string; ends_on: string; status: string }; visits: number }) {
  leftToMove.value = r.absence.status === 'approved' && r.visits > 0 ? { who: r.absence.team_member_id, from: r.absence.starts_on, to: r.absence.ends_on, count: r.visits } : null
  pendingList.value?.load()
  load()
}

// ---- adding: drag across a row (or tap one day), or the button
const drag = ref<{ member: string; month: string; from: string; to: string } | null>(null)
function dragStart(m: Member, month: string, d: string, e: PointerEvent) {
  if (cellAbsence.value.has(`${m.id}|${d}`) || e.button !== 0) return
  // Let the pointer move over the next cells instead of staying captured here
  // (touch captures it implicitly). Throws for a pointer that holds no capture.
  try {
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
  } catch {
    // Nothing was captured: the next cells already get the pointer.
  }
  drag.value = { member: m.id, month, from: d, to: d }
}
function dragOver(m: Member, month: string, d: string) {
  if (drag.value && drag.value.member === m.id && drag.value.month === month) drag.value.to = d
}
function dragEnd() {
  const g = drag.value
  if (!g) return
  drag.value = null
  const [from, to] = g.from <= g.to ? [g.from, g.to] : [g.to, g.from]
  openAdd(g.member, from, to, g.month)
}
const inDrag = (m: Member, d: string) => {
  const g = drag.value
  if (!g || g.member !== m.id) return false
  const [a, b] = g.from <= g.to ? [g.from, g.to] : [g.to, g.from]
  return d >= a && d <= b
}
onMounted(() => window.addEventListener('pointerup', dragEnd))
onBeforeUnmount(() => window.removeEventListener('pointerup', dragEnd))

const adding = ref(false)
// Where the form (and, after it, the visits left to move) shows: at the top
// for the button, or under the month whose days were picked -- in December
// the top of the page is far out of sight.
const place = ref<string>('top')
const form = reactive({ member: '', kind: 'vacation' as string, from: '', to: '', note: '' })
const saving = ref(false)
const addError = ref('')
function openAdd(member = props.memberId ?? '', from = today.value, to = from, where = 'top') {
  place.value = where
  Object.assign(form, { member, kind: 'vacation', from, to, note: '' })
  addError.value = ''
  selected.value = null
  adding.value = true
}
const formDays = computed(() => (form.from && form.to && form.to >= form.from ? leaveWorkingDays(form.from, form.to, false, closed.value) : 0))
const formProblem = computed(() => {
  if (!form.member) return t('Choose who.', 'Elige quién.')
  if (!form.from || !form.to) return t('Choose the first and last day.', 'Elige el primer y el último día.')
  if (form.to < form.from) return t('The last day is before the first.', 'El último día es anterior al primero.')
  return ''
})
async function record() {
  if (formProblem.value) return
  saving.value = true
  addError.value = ''
  const { error: e } = await supabase.rpc('record_staff_absence', {
    p_team_member_id: form.member,
    p_kind: form.kind,
    p_starts_on: form.from,
    // The function takes the day they are back.
    p_returns_on: nextDate(form.to),
    p_note: form.note.trim() || null,
  })
  if (e) {
    saving.value = false
    addError.value = e.message
    return
  }
  const visits = practitionerIds.value.has(form.member) ? await countVisits(form.member, form.from, form.to) : 0
  saving.value = false
  adding.value = false
  afterDecided({ absence: { team_member_id: form.member, starts_on: form.from, ends_on: form.to, status: 'approved' }, visits })
}

const legend = computed(() => ABSENCE_KINDS.map((k) => ({ kind: k, label: absenceKindLabel(k, t), style: cellStyle({ kind: k, status: 'approved', half_day: false } as Absence) })))
const pendingSwatch = computed(() => cellStyle({ kind: 'vacation', status: 'pending', half_day: false } as Absence))
const overlapList = computed(() => [...overlaps.value.keys()].sort())

const th = 'whitespace-nowrap px-2.5 py-2 text-left text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted'
const td = 'border-t border-line-row px-2.5 py-2 text-[13px] text-ink-900'
const inputClass = 'h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
</script>

<template>
  <div class="flex flex-col gap-4" data-cy="staff-leave" :data-ready="loaded ? 'true' : undefined">
    <div class="flex flex-wrap items-center gap-2">
      <UiBtn size="sm" :aria-label="t('Previous year', 'Año anterior')" data-cy="leave-year-prev" @click="year--"><UiChevron dir="left" /></UiBtn>
      <span class="text-[15px] font-bold text-ink-900" data-cy="leave-year">{{ year }}</span>
      <UiBtn size="sm" :aria-label="t('Next year', 'Año siguiente')" data-cy="leave-year-next" @click="year++"><UiChevron dir="right" /></UiBtn>
      <span class="flex-1" />
      <UiBtn size="sm" variant="primary" data-cy="leave-add" @click="openAdd()">{{ t('Add leave', 'Añadir ausencia') }}</UiBtn>
    </div>
    <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>

    <div id="leave-add-top" class="contents" />
    <TimeclockLeavePending v-if="!memberId" ref="pendingList" :account-id="accountId" @decided="afterDecided" />
    <Teleport v-if="leftToMove" :to="`#leave-add-${place}`" defer>
    <div class="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-4 py-3" data-cy="leave-year-visits">
      <span class="flex-1 text-[13px] text-ink-700">{{ t(`${memberName(leftToMove.who)} has ${leftToMove.count} visits booked on those days. Their calendar is blocked; the visits still need moving.`, `${memberName(leftToMove.who)} tiene ${leftToMove.count} visitas esos días. Su agenda ya está bloqueada; falta mover las visitas.`) }}</span>
      <UiBtn size="sm" variant="primary" data-cy="leave-year-visits-move" @click="moveOpen = true">{{ t('Move or cancel them', 'Moverlas o cancelarlas') }}</UiBtn>
    </div>
    </Teleport>

    <Teleport v-if="adding" :to="`#leave-add-${place}`" defer>
    <form class="flex flex-col gap-3 rounded-card border border-line bg-surface px-4 py-4" data-cy="leave-add-form" @submit.prevent="record">
      <h2 class="text-[14.5px] font-bold text-ink-900">{{ t('Add leave', 'Añadir ausencia') }}</h2>
      <p class="-mt-2 text-[12.5px] text-ink-muted">{{ t('For leave agreed in person. It goes in approved, and their calendar is blocked those days.', 'Para ausencias ya acordadas. Queda aprobada y su agenda se bloquea esos días.') }}</p>
      <label v-if="!memberId" class="flex flex-col gap-1 text-[13px] font-semibold text-ink-700">
        {{ t('Who', 'Quién') }}
        <select v-model="form.member" :class="inputClass" data-cy="leave-add-member">
          <option value="" disabled>{{ t('Choose…', 'Elige…') }}</option>
          <option v-for="m in members" :key="m.id" :value="m.id">{{ m.full_name }}</option>
        </select>
      </label>
      <div class="flex flex-wrap gap-1.5" role="group" :aria-label="t('Type', 'Tipo')">
        <button
          v-for="k in ABSENCE_KINDS"
          :key="k"
          type="button"
          class="h-8 touch:h-11 rounded-full border px-3 text-[13px] font-semibold"
          :class="form.kind === k ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'"
          :aria-pressed="form.kind === k"
          :data-cy="`leave-add-kind-${k}`"
          @click="form.kind = k"
        >
          {{ absenceKindLabel(k, t) }}
        </button>
      </div>
      <div class="flex flex-wrap gap-3">
        <label class="flex flex-col gap-1 text-[13px] font-semibold text-ink-700">
          {{ t('First day', 'Primer día') }}
          <input v-model="form.from" type="date" :class="inputClass" data-cy="leave-add-from" />
        </label>
        <label class="flex flex-col gap-1 text-[13px] font-semibold text-ink-700">
          {{ t('Last day', 'Último día') }}
          <input v-model="form.to" type="date" :min="form.from || undefined" :class="inputClass" data-cy="leave-add-to" />
        </label>
      </div>
      <span v-if="formDays" class="text-[12.5px] text-ink-muted" data-cy="leave-add-days">{{ t(`${fmtDays(formDays)} working days`, `${fmtDays(formDays)} días laborables`) }}</span>
      <label class="flex flex-col gap-1 text-[13px] font-semibold text-ink-700">
        {{ t('Note (optional)', 'Nota (opcional)') }}
        <input v-model="form.note" type="text" maxlength="200" :class="inputClass" data-cy="leave-add-note" />
        <span class="text-[12px] font-normal text-ink-muted">{{ t('Never a diagnosis: a sick leave needs only its dates.', 'Nunca un diagnóstico: una baja solo necesita sus fechas.') }}</span>
      </label>
      <p v-if="addError || (formProblem && form.member)" role="alert" class="text-[13px] text-danger-text">{{ addError || formProblem }}</p>
      <div class="flex gap-2">
        <UiBtn variant="primary" type="submit" :disabled="saving || !!formProblem" data-cy="leave-add-save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
        <UiBtn variant="ghost" data-cy="leave-add-cancel" @click="adding = false">{{ t('Cancel', 'Cancelar') }}</UiBtn>
      </div>
    </form>
    </Teleport>

    <section class="min-w-0 overflow-x-auto rounded-card border border-line bg-surface px-4 py-3" data-cy="leave-year-totals">
      <h2 class="text-[14.5px] font-bold text-ink-900">{{ t(`Holidays in ${year}`, `Vacaciones de ${year}`) }}</h2>
      <table class="mt-1.5 w-full border-collapse">
        <thead><tr><th :class="th">{{ t('Person', 'Persona') }}</th><th :class="th">{{ t('Has', 'Tiene') }}</th><th :class="th">{{ t('Taken', 'Usadas') }}</th><th :class="th">{{ t('Approved', 'Aprobadas') }}</th><th :class="th">{{ t('Pending', 'Pendientes') }}</th><th :class="th">{{ t('Left', 'Quedan') }}</th></tr></thead>
        <tbody v-if="!loaded" aria-busy="true">
          <tr v-for="i in 3" :key="i"><td v-for="j in 6" :key="j" :class="td"><UiSkeleton class="h-3.5 rounded-ctlSm" :class="j === 1 ? 'w-24' : 'w-8'" /></td></tr>
        </tbody>
        <tbody v-else>
          <tr v-for="m in members" :key="m.id" data-cy="leave-year-total" :data-name="m.full_name">
            <td :class="td" class="whitespace-nowrap">{{ m.full_name }}</td>
            <td :class="td" class="font-mono">{{ fmtDays(balances.get(m.id)!.allowance) }}</td>
            <td :class="td" class="font-mono">{{ fmtDays(balances.get(m.id)!.taken) }}</td>
            <td :class="td" class="font-mono">{{ fmtDays(balances.get(m.id)!.coming) }}</td>
            <td :class="td" class="font-mono" data-cy="leave-year-pending">{{ fmtDays(balances.get(m.id)!.pending) }}</td>
            <td :class="td" class="font-mono" data-cy="leave-year-left"><strong>{{ fmtDays(balances.get(m.id)!.left) }}</strong></td>
          </tr>
        </tbody>
      </table>
      <p class="mt-2 text-[12px] text-ink-muted">{{ t('Working days, Monday to Friday, less days the whole clinic is closed. The allowance is set on Registro de jornada › Turnos.', 'Días laborables, de lunes a viernes, sin los días que cierra toda la clínica. Los días de cada persona se cambian en Registro de jornada › Turnos.') }}<template v-if="carry.max"> {{ t(`“Has” includes up to ${fmtDays(carry.max)} unused days carried over from last year.`, `«Tiene» incluye hasta ${fmtDays(carry.max)} días sin usar del año pasado.`) }}</template></p>
    </section>

    <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-ink-muted" data-cy="leave-legend">
      <span v-for="l in legend" :key="l.kind" class="flex items-center gap-1.5"><span class="h-3 w-3 rounded-[3px]" :style="l.style" aria-hidden="true" />{{ l.label }}</span>
      <span class="flex items-center gap-1.5"><span class="h-3 w-3 rounded-[3px]" :style="pendingSwatch" aria-hidden="true" />{{ t('Pending', 'Pendiente') }}</span>
      <span class="flex items-center gap-1.5"><span class="h-3 w-3 rounded-[3px] bg-ink-faint/35" aria-hidden="true" />{{ t('Clinic closed', 'Clínica cerrada') }}</span>
      <span v-if="!memberId" class="flex items-center gap-1.5"><span class="h-1.5 w-1.5 rounded-full bg-danger-text" aria-hidden="true" />{{ t('Two or more practitioners away', 'Dos o más profesionales fuera') }}</span>
    </div>
    <p v-if="loaded && overlapList.length" class="-mt-2 text-[12.5px] text-ink-700" data-cy="leave-overlap-summary">
      {{ overlapList.length === 1 ? t('1 day with two or more practitioners away.', '1 día con dos o más profesionales fuera.') : t(`${overlapList.length} days with two or more practitioners away.`, `${overlapList.length} días con dos o más profesionales fuera.`) }}
    </p>

    <div v-if="!loaded" class="grid gap-4 xl:grid-cols-2" aria-busy="true">
      <UiSkeleton v-for="i in 4" :key="i" class="h-40 w-full rounded-card" />
    </div>
    <div v-else-if="!members.length" class="rounded-card border border-line bg-surface px-4 py-6 text-[13.5px] text-ink-muted">{{ t('Nobody on the team yet.', 'Todavía no hay nadie en el equipo.') }}</div>
    <div v-else class="grid gap-4 xl:grid-cols-2 [touch-action:pan-y]">
      <section v-for="mo in months" :key="mo.key" class="min-w-0 rounded-card border border-line bg-surface px-3 py-3" data-cy="leave-month" :data-month="mo.key">
        <h3 class="mb-1.5 text-[13.5px] font-bold capitalize text-ink-900">{{ mo.label }}</h3>
        <div class="grid select-none items-center gap-y-[3px]" :style="{ gridTemplateColumns: `minmax(4.5rem, 8rem) repeat(${mo.days.length}, minmax(0, 1fr))` }">
          <span />
          <span v-for="d in mo.days" :key="d" class="relative flex h-7 flex-col items-center justify-start text-[10px] leading-none" :class="d === today ? 'font-bold text-brand-text' : weekend(d) ? 'text-ink-faint' : 'text-ink-muted'">
            <span class="hidden sm:inline">{{ dayNumber(d) }}</span>
            <span class="sm:hidden">{{ dayNumber(d) % 5 === 0 || dayNumber(d) === 1 ? dayNumber(d) : '' }}</span>
            <button
              v-if="overlaps.has(d)"
              type="button"
              class="absolute bottom-0 left-1/2 h-2 w-full max-w-2 -translate-x-1/2 rounded-full bg-danger-text"
              :aria-label="t(`${overlaps.get(d)!.length} practitioners away on ${fmt(d)}`, `${overlaps.get(d)!.length} profesionales fuera el ${fmt(d)}`)"
              :data-cy="`leave-overlap-${d}`"
              @click="selectOverlap(mo.key, d)"
            />
          </span>
          <template v-for="m in members" :key="m.id">
            <span class="truncate pr-2 text-[12px] text-ink-700" :title="m.full_name">{{ m.full_name }}</span>
            <template v-for="d in mo.days" :key="d">
              <button
                v-if="cellAbsence.get(`${m.id}|${d}`)"
                type="button"
                class="h-5 border-r border-surface"
                :style="cellStyle(cellAbsence.get(`${m.id}|${d}`)!)"
                :title="cellTitle(m, d)"
                :aria-label="cellTitle(m, d)"
                :data-cy="`leave-cell`"
                :data-name="m.full_name"
                :data-day="d"
                :data-kind="cellAbsence.get(`${m.id}|${d}`)!.kind"
                :data-status="cellAbsence.get(`${m.id}|${d}`)!.status"
                @click="selected = { month: mo.key, kind: 'absence', absence: cellAbsence.get(`${m.id}|${d}`)! }"
              />
              <span
                v-else
                class="h-5 cursor-cell border-r border-surface"
                :class="[inDrag(m, d) ? 'bg-brand-tintDeep' : closed.has(d) ? 'bg-ink-faint/35' : weekend(d) ? 'bg-surface-subtle' : 'bg-chip-bg']"
                :title="cellTitle(m, d)"
                data-cy="leave-free"
                :data-name="m.full_name"
                :data-day="d"
                @pointerdown="dragStart(m, mo.key, d, $event)"
                @pointerenter="dragOver(m, mo.key, d)"
              />
            </template>
          </template>
        </div>

        <div :id="`leave-add-${mo.key}`" class="flex flex-col gap-3" :class="place === mo.key && (adding || leftToMove) ? 'mt-3' : ''" />
        <div v-if="selected && selected.month === mo.key" class="mt-3 flex flex-col gap-2 rounded-ctl border border-line bg-surface-subtle px-3 py-2.5" data-cy="leave-detail">
          <template v-if="selected.kind === 'absence'">
            <span class="text-[13.5px] text-ink-900">
              <strong class="font-semibold">{{ memberName(selected.absence.team_member_id) }}</strong>
              · {{ absenceKindLabel(selected.absence.kind, t) }} · {{ spanText(selected.absence) }}
              <template v-if="selected.absence.status === 'pending'"> · <span class="font-semibold text-warning-text">{{ t('waiting for you', 'pendiente de tu decisión') }}</span></template>
            </span>
            <span v-if="selected.absence.note" class="text-[12.5px] text-ink-muted">«{{ selected.absence.note }}»</span>
            <p v-if="decideError" role="alert" class="text-[12.5px] text-danger-text">{{ decideError }}</p>
            <div class="flex flex-wrap gap-2">
              <template v-if="selected.absence.status === 'pending'">
                <UiBtn size="sm" variant="primary" :disabled="deciding" data-cy="leave-detail-approve" @click="decide(selected.absence, true)">{{ t('Approve', 'Aprobar') }}</UiBtn>
                <UiBtn size="sm" :disabled="deciding" data-cy="leave-detail-reject" @click="decide(selected.absence, false)">{{ t('Reject', 'Rechazar') }}</UiBtn>
              </template>
              <NuxtLink v-else-if="!memberId" :to="`/personal/${selected.absence.team_member_id}?tab=leave`" class="text-[12.5px] font-semibold text-brand-text">{{ t('Their file →', 'Su ficha →') }}</NuxtLink>
              <UiBtn size="sm" variant="ghost" @click="selected = null">{{ t('Close', 'Cerrar') }}</UiBtn>
            </div>
          </template>
          <template v-else>
            <span class="text-[13.5px] font-semibold text-ink-900">{{ fmt(selected.day, true) }} · {{ t(`${selected.who.length} practitioners away`, `${selected.who.length} profesionales fuera`) }}</span>
            <ul class="flex flex-col gap-0.5 text-[13px] text-ink-700">
              <li v-for="id in selected.who" :key="id" data-cy="leave-detail-who">
                {{ memberName(id) }}<template v-if="overlapVisits"> · {{ overlapVisits.get(id) ? t(`${overlapVisits.get(id)} visits booked`, `${overlapVisits.get(id)} visitas reservadas`) : t('no visits booked', 'sin visitas') }}</template>
              </li>
            </ul>
            <div><UiBtn size="sm" variant="ghost" @click="selected = null">{{ t('Close', 'Cerrar') }}</UiBtn></div>
          </template>
        </div>
      </section>
    </div>
    <p v-if="loaded && members.length" class="-mt-2 text-[12px] text-ink-muted">{{ memberId ? t('Drag across the row to add leave for those days. Click an absence to see it, or to decide one that is waiting.', 'Arrastra sobre la fila para añadir una ausencia esos días. Pulsa una ausencia para verla, o para decidir una pendiente.') : t('Drag across someone’s row to add leave for those days. Click an absence to see it, or to decide one that is waiting.', 'Arrastra sobre la fila de alguien para añadir una ausencia esos días. Pulsa una ausencia para verla, o para decidir una pendiente.') }}</p>

    <LazyCalendarUnplannedAbsence v-if="moveOpen && leftToMove" :prefill="{ who: leftToMove.who, from: leftToMove.from, to: leftToMove.to, alreadyBlocked: true }" @close="moveOpen = false" @done="moveOpen = false; leftToMove = null" />
  </div>
</template>

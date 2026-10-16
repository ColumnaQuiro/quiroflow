<script setup lang="ts">
import type { BusinessHours } from '../../utils/businessHours'
import { clinicDateOf } from '../../utils/clinicClock'
import { workdayWeekStart, workdaysOf, workdayClock, formatWorked, type WorkEntry } from '../../utils/workday'
import { DEFAULT_LEAVE_DAYS, absenceKindLabel, formatShift, leaveWorkingDays, parseShift, shiftForDay, shiftGaps, shiftMinutes, type ShiftRanges } from '../../utils/staffShifts'

// Registro de jornada > Turnos, for owners (web). Design: TurnosWeb on the
// QuiroFlow canvas. The week by person: each day's shift (their weekly
// hours, or the day an owner changed -- click a day to change it), leave
// on it, and the week's shift hours against what was clocked; the leave
// requests waiting; days off left this year per person; and the clocked
// days more than 15 minutes off their shift (informative only).
const props = defineProps<{ accountId: string; timeZone: string }>()
const t = useT()
const { preference: lang } = useLang()
const supabase = useSupabaseClient()

interface Member { id: string; full_name: string; business_hours: BusinessHours | null; is_practitioner: boolean; role: string }
interface Absence { id: string; team_member_id: string; kind: string; starts_on: string; ends_on: string; half_day: boolean }

const today = computed(() => clinicDateOf(new Date(), props.timeZone))
const weekStart = ref(workdayWeekStart(today.value))
const days = computed(() => Array.from({ length: 7 }, (_, i) => {
  const d = new Date(`${weekStart.value}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + i)
  return d.toISOString().slice(0, 10)
}))
function shiftWeek(n: number) {
  const d = new Date(`${weekStart.value}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 7 * n)
  weekStart.value = d.toISOString().slice(0, 10)
}

const members = ref<Member[]>([])
const clinicHours = ref<BusinessHours | null>(null)
const overrides = ref<Map<string, ShiftRanges>>(new Map())
const exempt = ref<Set<string>>(new Set())
const entries = ref<(WorkEntry & { team_member_id: string })[]>([])
const absences = ref<Absence[]>([])
const allowances = ref<Map<string, number>>(new Map())
const closed = ref<Set<string>>(new Set())
const error = ref('')

async function load() {
  const year = weekStart.value.slice(0, 4)
  const [{ data: ms }, { data: clinic }, { data: sd }, { data: ex }, { data: es }, { data: abs }, { data: allow }, { data: blocks }] = await Promise.all([
    supabase.from('team_members').select('id, full_name, business_hours, is_practitioner, role').is('deleted_at', null).order('full_name'),
    supabase.from('clinics').select('business_hours').is('archived_at', null).order('created_at').limit(1).maybeSingle(),
    supabase.from('shift_days').select('team_member_id, day, ranges').gte('day', days.value[0]!).lte('day', days.value[6]!),
    supabase.from('time_clock_exemptions').select('team_member_id'),
    supabase.from('time_entries').select('id, team_member_id, kind, at, work_date').is('superseded_by', null).gte('work_date', days.value[0]!).lte('work_date', days.value[6]!).order('at'),
    supabase.from('staff_absences').select('id, team_member_id, kind, starts_on, ends_on, half_day').eq('account_id', props.accountId).eq('status', 'approved').lte('starts_on', `${year}-12-31`).gte('ends_on', `${year}-01-01`),
    supabase.from('staff_leave_allowances').select('team_member_id, days_per_year').eq('account_id', props.accountId),
    supabase.from('availability_blocks').select('starts_at, ends_at').is('practitioner_id', null).is('room_id', null).gte('ends_at', `${year}-01-01`).lte('starts_at', `${year}-12-31T23:59:59`),
  ])
  members.value = (ms as unknown as Member[] | null) ?? []
  clinicHours.value = ((clinic as { business_hours: BusinessHours | null } | null)?.business_hours ?? null)
  overrides.value = new Map(((sd as { team_member_id: string; day: string; ranges: ShiftRanges }[] | null) ?? []).map((d) => [`${d.team_member_id}|${d.day}`, d.ranges]))
  exempt.value = new Set(((ex as { team_member_id: string }[] | null) ?? []).map((e) => e.team_member_id))
  entries.value = (es as (WorkEntry & { team_member_id: string })[] | null) ?? []
  absences.value = (abs as Absence[] | null) ?? []
  allowances.value = new Map(((allow as { team_member_id: string; days_per_year: number }[] | null) ?? []).map((a) => [a.team_member_id, Number(a.days_per_year)]))
  const shut = new Set<string>()
  for (const b of (blocks as { starts_at: string; ends_at: string }[] | null) ?? []) {
    for (let d = new Date(b.starts_at); d < new Date(b.ends_at); d.setUTCDate(d.getUTCDate() + 1)) shut.add(clinicDateOf(d, props.timeZone))
  }
  closed.value = shut
}
onMounted(load)
watch(weekStart, load)

const shiftOf = (m: Member, day: string) => shiftForDay(day, m, clinicHours.value, overrides.value.get(`${m.id}|${day}`))
const absenceOf = (m: Member, day: string) => absences.value.find((a) => a.team_member_id === m.id && a.starts_on <= day && a.ends_on >= day && !a.half_day) ?? null
const changed = (m: Member, day: string) => overrides.value.has(`${m.id}|${day}`)

const clocked = computed(() => {
  const by = new Map<string, ReturnType<typeof workdaysOf>>()
  for (const m of members.value) by.set(m.id, workdaysOf(entries.value.filter((e) => e.team_member_id === m.id)))
  return by
})
function plannedMinutes(m: Member) {
  return days.value.reduce((s, d) => s + (absenceOf(m, d) ? 0 : shiftMinutes(shiftOf(m, d) ?? [])), 0)
}
function clockedMinutes(m: Member) {
  return (clocked.value.get(m.id) ?? []).reduce((s, d) => s + d.workedMinutes, 0)
}

// Clocked days more than SHIFT_GAP_MINUTES off the shift.
const gaps = computed(() => {
  const out: { member: Member; day: string; text: string }[] = []
  for (const m of members.value) {
    for (const d of clocked.value.get(m.id) ?? []) {
      const shift = shiftOf(m, d.date)
      if (!shift?.length) continue
      const inAt = d.firstIn ? workdayClock(d.firstIn, props.timeZone) : null
      const outAt = d.lastOut ? workdayClock(d.lastOut, props.timeZone) : null
      const g = shiftGaps(shift, inAt, outAt)
      const parts: string[] = []
      if (g.in !== null) parts.push(t(`in ${inAt} (shift ${shift[0]![0]})`, `entrada ${inAt} (turno ${shift[0]![0]})`))
      if (g.out !== null) parts.push(t(`out ${outAt} (shift ${shift[shift.length - 1]![1]})`, `salida ${outAt} (turno ${shift[shift.length - 1]![1]})`))
      if (parts.length) out.push({ member: m, day: d.date, text: parts.join(' · ') })
    }
  }
  return out
})

// Holiday this year: allowance, taken (before today), approved still to
// come, and what is left.
function leaveOf(m: Member) {
  const mine = absences.value.filter((a) => a.team_member_id === m.id && a.kind === 'vacation')
  const taken = mine.filter((a) => a.ends_on < today.value).reduce((s, a) => s + leaveWorkingDays(a.starts_on, a.ends_on, a.half_day, closed.value), 0)
  const coming = mine.filter((a) => a.ends_on >= today.value).reduce((s, a) => s + leaveWorkingDays(a.starts_on, a.ends_on, a.half_day, closed.value), 0)
  const allowance = allowances.value.get(m.id) ?? DEFAULT_LEAVE_DAYS
  return { allowance, taken, coming, left: allowance - taken - coming }
}
async function setAllowance(m: Member, value: string) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return
  const { error: e } = await supabase.from('staff_leave_allowances').upsert({ team_member_id: m.id, account_id: props.accountId, days_per_year: n })
  if (e) error.value = e.message
  await load()
}

// ---- changing one day
const editing = ref<{ memberId: string; day: string } | null>(null)
const editText = ref('')
const editError = ref('')
function startEdit(m: Member, day: string) {
  editing.value = { memberId: m.id, day }
  editText.value = formatShift(shiftOf(m, day) ?? []).replace(/ · /g, ', ').replace(/–/g, '-')
  editError.value = ''
}
async function saveDay() {
  const e = editing.value
  if (!e) return
  const ranges = parseShift(editText.value)
  if (!ranges) {
    editError.value = t('Write it like 09:00-14:00, 16:00-19:00 (empty: off).', 'Escríbelo así: 09:00-14:00, 16:00-19:00 (vacío: libre).')
    return
  }
  const { error: err } = await supabase.from('shift_days').upsert({ team_member_id: e.memberId, day: e.day, account_id: props.accountId, ranges, updated_at: new Date().toISOString() })
  if (err) {
    editError.value = err.message
    return
  }
  editing.value = null
  await load()
}
async function resetDay() {
  const e = editing.value
  if (!e) return
  await supabase.from('shift_days').delete().eq('team_member_id', e.memberId).eq('day', e.day)
  editing.value = null
  await load()
}

// ---- after approving leave: their visits on those days
const absenceVisits = ref<{ who: string; from: string; to: string; count: number } | null>(null)
const absenceOpen = ref(false)
function onDecided(r: { absence: { team_member_id: string; starts_on: string; ends_on: string; status: string }; visits: number }) {
  absenceVisits.value = r.absence.status === 'approved' && r.visits > 0 ? { who: r.absence.team_member_id, from: r.absence.starts_on, to: r.absence.ends_on, count: r.visits } : null
  load()
}

const dayHead = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(lang.value === 'es' ? 'es-ES' : 'en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
const weekLabel = computed(() => {
  const f = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(lang.value === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${f(days.value[0]!)} – ${f(days.value[6]!)}`
})
const memberName = (id: string) => members.value.find((m) => m.id === id)?.full_name ?? ''
const th = 'px-2.5 py-2 text-left text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted'
const td = 'border-t border-line-row px-2.5 py-2 align-top text-[12.5px] text-ink-900'
</script>

<template>
  <div class="flex flex-col gap-4" data-cy="team-shifts">
    <div class="flex items-center gap-2">
      <UiBtn size="sm" :aria-label="t('Previous week', 'Semana anterior')" data-cy="shifts-prev" @click="shiftWeek(-1)">‹</UiBtn>
      <span class="text-[13.5px] font-semibold text-ink-900" data-cy="shifts-week">{{ t('Week', 'Semana') }} {{ weekLabel }}</span>
      <UiBtn size="sm" :aria-label="t('Next week', 'Semana siguiente')" data-cy="shifts-next" @click="shiftWeek(1)">›</UiBtn>
      <span class="flex-1" />
      <NuxtLink to="/settings/team" class="text-[12.5px] font-semibold text-brand-text">{{ t('Weekly hours: Settings › Team →', 'Horario semanal: Ajustes › Equipo →') }}</NuxtLink>
    </div>
    <p v-if="error" role="alert" class="text-[12.5px] text-danger-text">{{ error }}</p>

    <TimeclockLeavePending :account-id="accountId" @decided="onDecided" />
    <div v-if="absenceVisits" class="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-4 py-3" data-cy="leave-visits">
      <span class="flex-1 text-[13px] text-ink-700">{{ t(`${memberName(absenceVisits.who)} has ${absenceVisits.count} visits booked on those days. Their calendar is blocked; the visits still need moving.`, `${memberName(absenceVisits.who)} tiene ${absenceVisits.count} visitas esos días. Su agenda ya está bloqueada; falta mover las visitas.`) }}</span>
      <UiBtn size="sm" variant="primary" data-cy="leave-visits-move" @click="absenceOpen = true">{{ t('Move or cancel them', 'Moverlas o cancelarlas') }}</UiBtn>
    </div>

    <section class="overflow-x-auto rounded-card border border-line bg-surface">
      <table class="w-full border-collapse">
        <thead>
          <tr>
            <th :class="th" class="w-[170px]">{{ t('Person', 'Persona') }}</th>
            <th v-for="d in days" :key="d" :class="th" class="capitalize">{{ dayHead(d) }}</th>
            <th :class="th" class="w-[140px]">{{ t('Shift / clocked', 'Previsto / fichado') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in members" :key="m.id" data-cy="shifts-row" :data-name="m.full_name">
            <td :class="td"><strong>{{ m.full_name }}</strong><div class="text-[11.5px] text-ink-muted">{{ m.is_practitioner ? t('Practitioner', 'Profesional') : m.role }}</div></td>
            <td v-for="d in days" :key="d" :class="td">
              <span v-if="absenceOf(m, d)" class="block rounded-ctlSm bg-warning-bg px-1.5 py-1 text-[11.5px] font-semibold text-warning-text">{{ absenceKindLabel(absenceOf(m, d)!.kind, t) }}</span>
              <form v-else-if="editing && editing.memberId === m.id && editing.day === d" class="flex flex-col gap-1" @submit.prevent="saveDay">
                <input v-model="editText" class="h-8 w-full rounded-ctlSm border border-line-control bg-surface px-1.5 font-mono text-[11.5px]" placeholder="09:00-14:00" :aria-label="t('Hours that day', 'Horas ese día')" data-cy="shift-edit-input" />
                <span class="flex gap-1">
                  <UiBtn size="sm" variant="primary" type="submit" data-cy="shift-edit-save">{{ t('Save', 'Guardar') }}</UiBtn>
                  <UiBtn v-if="changed(m, d)" size="sm" variant="ghost" data-cy="shift-edit-reset" @click="resetDay">{{ t('Usual', 'Habitual') }}</UiBtn>
                </span>
                <span v-if="editError" class="text-[11px] text-danger-text">{{ editError }}</span>
              </form>
              <button v-else type="button" class="block w-full rounded-ctlSm text-left hover:bg-surface-subtle" :data-cy="`shift-cell-${d}`" @click="startEdit(m, d)">
                <span v-if="shiftOf(m, d) === null" class="text-[12px] text-ink-faint">—</span>
                <span v-else-if="!shiftOf(m, d)!.length" class="text-[12px] text-ink-faint">{{ t('Off', 'Libre') }}</span>
                <span v-else class="block rounded-ctlSm px-1.5 py-1 font-mono text-[11.5px] leading-snug" :class="changed(m, d) ? 'bg-warning-bg2 text-ink-900 ring-1 ring-warning-border' : 'bg-brand-tint text-brand-text'">
                  <template v-for="(r, i) in shiftOf(m, d)!" :key="i">{{ r[0] }}–{{ r[1] }}<br v-if="i < shiftOf(m, d)!.length - 1" /></template>
                </span>
              </button>
            </td>
            <td :class="td" class="font-mono" data-cy="shifts-hours">
              {{ formatWorked(plannedMinutes(m)) }} / {{ exempt.has(m.id) ? '—' : formatWorked(clockedMinutes(m)) }}
              <div v-if="exempt.has(m.id)" class="font-sans text-[11.5px] text-ink-muted">{{ t("Doesn't clock", 'No ficha') }}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
    <p class="-mt-2 text-[12px] text-ink-muted">{{ t('Click a day to change that day only; its usual hours come back with “Usual”.', 'Pulsa un día para cambiar solo ese día; «Habitual» vuelve a su horario de siempre.') }}</p>

    <div class="grid gap-4 md:grid-cols-2">
      <section class="rounded-card border border-line bg-surface px-4 py-3" data-cy="leave-allowances">
        <h2 class="text-[14.5px] font-bold text-ink-900">{{ t('Holiday this year', 'Vacaciones del año') }}</h2>
        <table class="mt-1.5 w-full border-collapse">
          <thead><tr><th :class="th">{{ t('Person', 'Persona') }}</th><th :class="th">{{ t('Has', 'Tiene') }}</th><th :class="th">{{ t('Taken', 'Usadas') }}</th><th :class="th">{{ t('Approved', 'Aprobadas') }}</th><th :class="th">{{ t('Left', 'Quedan') }}</th></tr></thead>
          <tbody>
            <tr v-for="m in members" :key="m.id" data-cy="leave-allowance-row" :data-name="m.full_name">
              <td :class="td">{{ m.full_name }}</td>
              <td :class="td"><input :value="leaveOf(m).allowance" type="number" min="0" step="0.5" class="h-8 w-16 rounded-ctlSm border border-line-control bg-surface px-1.5 text-right font-mono text-[12.5px]" :aria-label="t(`Days for ${m.full_name}`, `Días de ${m.full_name}`)" data-cy="leave-allowance-input" @change="setAllowance(m, ($event.target as HTMLInputElement).value)" /></td>
              <td :class="td" class="font-mono">{{ leaveOf(m).taken }}</td>
              <td :class="td" class="font-mono">{{ leaveOf(m).coming }}</td>
              <td :class="td" class="font-mono"><strong>{{ leaveOf(m).left }}</strong></td>
            </tr>
          </tbody>
        </table>
        <p class="mt-2 text-[12px] text-ink-muted">{{ t('Working days, Monday to Friday. Days the whole clinic is closed do not count.', 'Días laborables, de lunes a viernes. Los días que cierra toda la clínica no cuentan.') }}</p>
      </section>
      <section class="rounded-card border border-line bg-surface px-4 py-3" data-cy="shift-gaps">
        <h2 class="text-[14.5px] font-bold text-ink-900">{{ t('Clocked against the shift', 'Fichado frente a turno') }}</h2>
        <p v-if="!gaps.length" class="mt-2 text-[13px] text-ink-muted">{{ t('No differences this week.', 'Sin diferencias esta semana.') }}</p>
        <div v-for="g in gaps" :key="`${g.member.id}${g.day}`" class="flex justify-between gap-2 border-b border-line-divider py-2 text-[13px] last:border-b-0" data-cy="shift-gap">
          <span class="capitalize">{{ g.member.full_name }} · {{ dayHead(g.day) }}</span><span class="font-mono text-[12.5px] text-ink-muted">{{ g.text }}</span>
        </div>
        <p class="mt-2 text-[12px] text-ink-muted">{{ t('More than 15 minutes either way. It only informs: what was clocked stays as it is.', 'Más de 15 minutos de diferencia. Solo informa: lo fichado no cambia.') }}</p>
      </section>
    </div>

    <LazyCalendarUnplannedAbsence v-if="absenceOpen && absenceVisits" :prefill="{ who: absenceVisits.who, from: absenceVisits.from, to: absenceVisits.to, alreadyBlocked: true }" @close="absenceOpen = false" @done="absenceOpen = false; absenceVisits = null" />
  </div>
</template>

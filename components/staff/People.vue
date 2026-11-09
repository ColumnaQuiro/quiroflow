<script setup lang="ts">
import type { BusinessHours } from '../../utils/businessHours'
import { clinicDateOf, nextDate } from '../../utils/clinicClock'
import { workdaySummary, workdayClock, formatWorked, type WorkEntry } from '../../utils/workday'
import { DEFAULT_LEAVE_DAYS, absenceKindLabel, isOpenEndedAbsence, shiftForDay, shiftMinutes, type ShiftRanges } from '../../utils/staffShifts'
import { clinicClosedDays, teamLeaveBalance, type TeamAbsence } from '../../utils/teamLeave'

// Personal > Personas: one row per person on the team -- where they are today,
// holiday left this year, and this month's hours so far against their shift
// -- under what is waiting for the owner (leave to decide, clocking to
// correct). Each person opens onto their page in Settings > Team until the
// person file exists (phase 2 of the spec).
const props = defineProps<{ accountId: string; timeZone: string }>()
const emit = defineEmits<{ 'open-leave': [] }>()
const t = useT()
const { preference: lang } = useLang()
const supabase = useSupabaseClient()

interface Member { id: string; full_name: string; role: string; is_practitioner: boolean; color: string; business_hours: BusinessHours | null }

const now = ref(new Date())
const today = computed(() => clinicDateOf(now.value, props.timeZone))
const year = computed(() => Number(today.value.slice(0, 4)))
const monthStart = computed(() => `${today.value.slice(0, 7)}-01`)

const members = ref<Member[]>([])
const clinicHours = ref<BusinessHours | null>(null)
const overrides = ref<Map<string, ShiftRanges>>(new Map())
const exempt = ref<Set<string>>(new Set())
const entries = ref<(WorkEntry & { team_member_id: string })[]>([])
const absences = ref<TeamAbsence[]>([])
const allowances = ref<Map<string, number>>(new Map())
const closed = ref<Set<string>>(new Set())
const pendingCorrections = ref(0)
const loaded = ref(false)
const error = ref('')

async function load() {
  const y = year.value
  const [ms, clinic, sd, ex, es, abs, allow, blocks, corr] = await Promise.all([
    supabase.from('team_members').select('id, full_name, role, is_practitioner, color, business_hours').eq('account_id', props.accountId).is('deleted_at', null).order('full_name'),
    supabase.from('clinics').select('business_hours').eq('account_id', props.accountId).is('archived_at', null).order('created_at').limit(1).maybeSingle(),
    supabase.from('shift_days').select('team_member_id, day, ranges').eq('account_id', props.accountId).gte('day', monthStart.value).lte('day', today.value),
    supabase.from('time_clock_exemptions').select('team_member_id').eq('account_id', props.accountId),
    supabase.from('time_entries').select('id, team_member_id, kind, at, work_date').eq('account_id', props.accountId).is('superseded_by', null).gte('work_date', monthStart.value).lte('work_date', today.value).order('at'),
    supabase.from('staff_absences').select('id, team_member_id, kind, starts_on, ends_on, half_day, status').eq('account_id', props.accountId).in('status', ['approved', 'pending']).lte('starts_on', `${y}-12-31`).gte('ends_on', `${y}-01-01`),
    supabase.from('staff_leave_allowances').select('team_member_id, days_per_year').eq('account_id', props.accountId),
    supabase.from('availability_blocks').select('starts_at, ends_at').eq('account_id', props.accountId).is('practitioner_id', null).is('room_id', null).gte('ends_at', `${y}-01-01`).lte('starts_at', `${y}-12-31T23:59:59`),
    supabase.from('time_corrections').select('id', { count: 'exact', head: true }).eq('account_id', props.accountId).eq('status', 'pending'),
  ])
  const failed = [ms, abs, es].find((r) => r.error)
  error.value = failed?.error ? t("Couldn't load the team.", 'No se ha podido cargar el equipo.') : ''
  members.value = (ms.data as Member[] | null) ?? []
  clinicHours.value = (clinic.data as { business_hours: BusinessHours | null } | null)?.business_hours ?? null
  overrides.value = new Map(((sd.data as { team_member_id: string; day: string; ranges: ShiftRanges }[] | null) ?? []).map((d) => [`${d.team_member_id}|${d.day}`, d.ranges]))
  exempt.value = new Set(((ex.data as { team_member_id: string }[] | null) ?? []).map((e) => e.team_member_id))
  entries.value = (es.data as (WorkEntry & { team_member_id: string })[] | null) ?? []
  absences.value = (abs.data as TeamAbsence[] | null) ?? []
  allowances.value = new Map(((allow.data as { team_member_id: string; days_per_year: number }[] | null) ?? []).map((a) => [a.team_member_id, Number(a.days_per_year)]))
  closed.value = clinicClosedDays((blocks.data as { starts_at: string; ends_at: string }[] | null) ?? [], props.timeZone)
  pendingCorrections.value = corr.count ?? 0
  loaded.value = true
}
onMounted(load)

const pendingLeave = computed(() => absences.value.filter((a) => a.status === 'pending').length)

const shiftOf = (m: Member, day: string) => shiftForDay(day, m, clinicHours.value, overrides.value.get(`${m.id}|${day}`))
const awayOn = (m: Member, day: string) => absences.value.find((a) => a.team_member_id === m.id && a.status === 'approved' && !a.half_day && a.starts_on <= day && a.ends_on >= day) ?? null

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(uiLocaleTag(lang.value), { day: 'numeric', month: 'short', timeZone: 'UTC' })

type Tone = 'ok' | 'away' | 'warn' | 'quiet'
/** Where someone is today, in words, and how loudly to say it. */
function todayOf(m: Member): { text: string; tone: Tone } {
  const away = awayOn(m, today.value)
  if (away) {
    const until = isOpenEndedAbsence(away.ends_on) ? t('no return date', 'sin fecha de vuelta') : t(`back ${fmtDay(nextDate(away.ends_on))}`, `vuelve el ${fmtDay(nextDate(away.ends_on))}`)
    return { text: `${absenceKindLabel(away.kind, t)} · ${until}`, tone: 'away' }
  }
  if (closed.value.has(today.value)) return { text: t('Clinic closed', 'Clínica cerrada'), tone: 'quiet' }
  const mine = entries.value.filter((e) => e.team_member_id === m.id && e.work_date === today.value)
  if (mine.length) {
    const day = workdaySummary(today.value, mine, now.value)
    if (day.state === 'working') return { text: t(`Working since ${workdayClock(day.firstIn!, props.timeZone)}`, `Trabajando desde las ${workdayClock(day.firstIn!, props.timeZone)}`), tone: 'ok' }
    if (day.state === 'on_break') return { text: t('On a break', 'En pausa'), tone: 'ok' }
    return { text: t(`Finished · ${formatWorked(day.workedMinutes)}`, `Ha terminado · ${formatWorked(day.workedMinutes)}`), tone: 'quiet' }
  }
  const shift = shiftOf(m, today.value)
  if (!shift?.length) return { text: t('Off', 'Libre'), tone: 'quiet' }
  const starts = shift[0]![0]
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: props.timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now.value)
  if (clock >= starts && !exempt.value.has(m.id)) return { text: t(`Not clocked in · shift from ${starts}`, `Sin fichar · turno desde las ${starts}`), tone: 'warn' }
  return { text: t(`Starts at ${starts}`, `Entra a las ${starts}`), tone: 'quiet' }
}

function leaveOf(m: Member) {
  return teamLeaveBalance(absences.value.filter((a) => a.team_member_id === m.id), allowances.value.get(m.id) ?? DEFAULT_LEAVE_DAYS, year.value, today.value, closed.value)
}

/** This month so far: the shift's hours (less days away or closed) against what was clocked. */
function monthOf(m: Member) {
  let planned = 0
  for (let d = monthStart.value; d <= today.value; d = nextDate(d)) {
    if (closed.value.has(d) || awayOn(m, d)) continue
    planned += shiftMinutes(shiftOf(m, d) ?? [])
  }
  const mine = entries.value.filter((e) => e.team_member_id === m.id)
  const byDay = new Map<string, WorkEntry[]>()
  for (const e of mine) byDay.set(e.work_date, [...(byDay.get(e.work_date) ?? []), e])
  let clocked = 0
  for (const [day, list] of byDay) clocked += workdaySummary(day, list, now.value).workedMinutes
  return { planned, clocked }
}

const roleOf = (m: Member) => (m.role === 'owner' ? t('Owner', 'Propietario') : m.is_practitioner ? t('Practitioner', 'Profesional') : m.role === 'front_desk' ? t('Front desk', 'Recepción') : t('Team', 'Equipo'))
const toneClass: Record<Tone, string> = {
  ok: 'bg-success-bg text-success-text',
  away: 'bg-warning-bg text-warning-text',
  warn: 'bg-danger-bg text-danger-text',
  quiet: 'text-ink-muted',
}
const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString(uiLocaleTag(lang.value)))
const th = 'whitespace-nowrap px-3 py-2 text-left text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted'
const td = 'border-t border-line-row px-3 py-2.5 align-middle text-[13px] text-ink-900'
</script>

<template>
  <div class="flex flex-col gap-4" data-cy="staff-people" :data-ready="loaded ? 'true' : undefined">
    <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>

    <section v-if="loaded && (pendingLeave || pendingCorrections)" class="flex flex-col gap-2 rounded-card border border-warning-border bg-warning-bg2 px-4 py-3" data-cy="staff-waiting">
      <h2 class="text-[14px] font-bold text-ink-900">{{ t('Waiting for you', 'Te esperan') }}</h2>
      <div class="flex flex-wrap gap-2">
        <button v-if="pendingLeave" type="button" class="rounded-ctl border border-line-control bg-surface px-3 py-1.5 text-[13px] font-semibold text-ink-700 hover:border-line-controlHover" data-cy="staff-waiting-leave" @click="emit('open-leave')">
          {{ pendingLeave === 1 ? t('1 leave request to decide', '1 solicitud de ausencia por decidir') : t(`${pendingLeave} leave requests to decide`, `${pendingLeave} solicitudes de ausencia por decidir`) }} →
        </button>
        <NuxtLink v-if="pendingCorrections" to="/jornada" class="rounded-ctl border border-line-control bg-surface px-3 py-1.5 text-[13px] font-semibold text-ink-700 hover:border-line-controlHover" data-cy="staff-waiting-corrections">
          {{ pendingCorrections === 1 ? t('1 clocking correction to review', '1 corrección de fichaje por revisar') : t(`${pendingCorrections} clocking corrections to review`, `${pendingCorrections} correcciones de fichaje por revisar`) }} →
        </NuxtLink>
      </div>
    </section>

    <section class="overflow-x-auto rounded-card border border-line bg-surface">
      <table class="w-full border-collapse">
        <thead>
          <tr>
            <th :class="th">{{ t('Person', 'Persona') }}</th>
            <th :class="th">{{ t('Today', 'Hoy') }}</th>
            <th :class="th">{{ t('Holidays left', 'Vacaciones') }}</th>
            <th :class="th">{{ t('This month', 'Este mes') }}</th>
          </tr>
        </thead>
        <tbody v-if="!loaded" aria-busy="true">
          <tr v-for="i in 3" :key="i">
            <td v-for="j in 4" :key="j" :class="td"><UiSkeleton class="h-3.5 rounded-ctlSm" :class="j === 1 ? 'w-32' : 'w-20'" /></td>
          </tr>
        </tbody>
        <tbody v-else>
          <tr v-for="m in members" :key="m.id" data-cy="staff-person" :data-name="m.full_name">
            <td :class="td">
              <NuxtLink :to="`/settings/team/${m.id}`" class="flex items-center gap-2.5 hover:underline" data-cy="staff-person-link">
                <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ backgroundColor: m.color }" aria-hidden="true" />
                <span>
                  <strong class="block font-semibold">{{ m.full_name }}</strong>
                  <span class="block text-[12px] text-ink-muted">{{ roleOf(m) }}</span>
                </span>
              </NuxtLink>
            </td>
            <td :class="td" data-cy="staff-person-today">
              <span class="inline-block rounded-ctlSm px-2 py-0.5 text-[12.5px] font-semibold" :class="toneClass[todayOf(m).tone]">{{ todayOf(m).text }}</span>
            </td>
            <td :class="td" data-cy="staff-person-leave">
              <strong class="font-mono">{{ fmtDays(leaveOf(m).left) }}</strong>
              <span class="text-ink-muted"> / {{ fmtDays(leaveOf(m).allowance) }} {{ t('days', 'días') }}</span>
              <span v-if="leaveOf(m).pending" class="block text-[12px] text-warning-text">{{ t(`${fmtDays(leaveOf(m).pending)} pending`, `${fmtDays(leaveOf(m).pending)} pendientes`) }}</span>
            </td>
            <td :class="td" class="font-mono" data-cy="staff-person-month">
              <template v-if="exempt.has(m.id)"><span class="font-sans text-ink-muted">{{ t("Doesn't clock", 'No ficha') }}</span></template>
              <template v-else>
                <span class="whitespace-nowrap">{{ formatWorked(monthOf(m).clocked) }}</span>
                <span class="text-ink-muted"> / <span class="whitespace-nowrap">{{ formatWorked(monthOf(m).planned) }}</span></span>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
    <p class="-mt-2 text-[12px] text-ink-muted">{{ t('This month: clocked so far / their shift up to today, leaving out days away and days the clinic is closed. Holidays: working days left of this year’s allowance.', 'Este mes: fichado hasta hoy / su turno hasta hoy, sin contar ausencias ni días de cierre. Vacaciones: días laborables que le quedan este año.') }}</p>
  </div>
</template>

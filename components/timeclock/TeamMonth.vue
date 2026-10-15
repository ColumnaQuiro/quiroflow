<script setup lang="ts">
import { workdaysOf, formatWorked, workdayClock, workdayWeekStart, workdayMonthBounds, workEntryLabel, type WorkEntry, type WorkdaySummary } from '../../utils/workday'
import { clinicDateOf } from '../../utils/clinicClock'

// Registro de jornada, the owners' view (/jornada): the team's month, the
// corrections waiting for them, and one person's days in detail with every
// correction beside the entry it replaced. Owners only -- RLS shows anyone
// else just their own rows, and decide_time_correction refuses them.
//
// Who does not have to clock (an autónomo renting a room) is excluded here,
// per person: their clock disappears from My Day and they leave the export.
const props = defineProps<{ accountId: string; timeZone: string; month: string }>()
const t = useT()
const { preference: lang } = useLang()
const supabase = useSupabaseClient()

interface Member { id: string; full_name: string; is_practitioner: boolean; role: string }
interface Entry extends WorkEntry { team_member_id: string; superseded_by: string | null; correction_id: string | null }
interface Correction { id: string; team_member_id: string; work_date: string; kind: string; at: string; reason: string; status: string; replaces_entry_id: string | null; requested_at: string; decided_by: string | null; decided_at: string | null }

const members = ref<Member[]>([])
const exempt = ref<Set<string>>(new Set())
const entries = ref<Entry[]>([])
const corrections = ref<Correction[]>([])
const pending = ref<Correction[]>([])
const selected = ref<string | null>(null)
const loaded = ref(false)
const error = ref('')
const busy = ref(false)

const today = computed(() => clinicDateOf(new Date(), props.timeZone))
const bounds = computed(() => workdayMonthBounds(props.month))

async function load() {
  const from = [bounds.value.first, workdayWeekStart(today.value)].sort()[0]!
  const [{ data: ms }, { data: ex }, { data: es }, { data: cs }, { data: ps }] = await Promise.all([
    supabase.from('team_members').select('id, full_name, is_practitioner, role').is('deleted_at', null).order('full_name'),
    supabase.from('time_clock_exemptions').select('team_member_id'),
    supabase.from('time_entries').select('id, team_member_id, kind, at, work_date, superseded_by, correction_id').gte('work_date', from).lte('work_date', bounds.value.last).order('at'),
    supabase.from('time_corrections').select('id, team_member_id, work_date, kind, at, reason, status, replaces_entry_id, requested_at, decided_by, decided_at').gte('work_date', bounds.value.first).lte('work_date', bounds.value.last),
    supabase.from('time_corrections').select('id, team_member_id, work_date, kind, at, reason, status, replaces_entry_id, requested_at, decided_by, decided_at').eq('status', 'pending').order('requested_at'),
  ])
  members.value = (ms as Member[] | null) ?? []
  exempt.value = new Set(((ex as { team_member_id: string }[] | null) ?? []).map((r) => r.team_member_id))
  entries.value = (es as Entry[] | null) ?? []
  corrections.value = (cs as Correction[] | null) ?? []
  pending.value = (ps as Correction[] | null) ?? []
  if (!selected.value || !members.value.some((m) => m.id === selected.value)) selected.value = members.value.find((m) => !exempt.value.has(m.id))?.id ?? null
  loaded.value = true
}
onMounted(load)
watch(() => props.month, load)

const name = (id: string | null) => members.value.find((m) => m.id === id)?.full_name ?? '—'
const clock = (at: string) => workdayClock(at, props.timeZone)
const locale = computed(() => (lang.value === 'es' ? 'es-ES' : 'en-GB'))
const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(locale.value, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

const inForce = computed(() => entries.value.filter((e) => !e.superseded_by))
function daysOf(memberId: string): WorkdaySummary[] {
  return workdaysOf(inForce.value.filter((e) => e.team_member_id === memberId))
}

const rows = computed(() => members.value.map((m) => {
  const all = daysOf(m.id)
  const month = all.filter((d) => d.date >= bounds.value.first && d.date <= bounds.value.last)
  const weekStart = workdayWeekStart(today.value)
  const todayDay = all.find((d) => d.date === today.value) ?? all.find((d) => d.open && !d.missingOut) ?? null
  return {
    member: m,
    exempt: exempt.value.has(m.id),
    today: todayDay,
    week: all.filter((d) => d.date >= weekStart && d.date <= today.value).reduce((s, d) => s + d.workedMinutes, 0),
    month: month.reduce((s, d) => s + d.workedMinutes, 0),
    days: month.length,
  }
}))

function todaySpan(d: WorkdaySummary | null) {
  if (!d) return '—'
  const start = d.firstIn ? clock(d.firstIn) : '?'
  if (d.state === 'working') return `${start} – ${t('ongoing', 'en curso')}`
  if (d.state === 'on_break') return `${start} – ${t('on a break', 'en pausa')}`
  return `${start} – ${d.lastOut ? clock(d.lastOut) : '?'}`
}
function statePill(d: WorkdaySummary | null) {
  if (d?.state === 'working') return { label: t('Working', 'Trabajando'), cls: 'bg-success-bg text-success-text' }
  if (d?.state === 'on_break') return { label: t('On a break', 'En pausa'), cls: 'bg-brand-tint text-brand-text' }
  if (d && !d.open) return { label: t('Clocked out', 'Salida fichada'), cls: 'bg-surface-subtle text-ink-muted' }
  return null
}

// ---- one person's month
const detailDays = computed(() => (selected.value ? daysOf(selected.value).filter((d) => d.date >= bounds.value.first && d.date <= bounds.value.last) : []))
function notesFor(date: string) {
  return corrections.value.filter((c) => c.team_member_id === selected.value && c.work_date === date)
}
function replacedAt(c: Correction) {
  const e = c.replaces_entry_id ? entries.value.find((x) => x.id === c.replaces_entry_id) : null
  return e ? clock(e.at) : null
}
function breaksOf(d: WorkdaySummary) {
  return d.breaks.map((b) => `${clock(b.start)}–${b.end ? clock(b.end) : '?'}`).join(', ')
}

async function decide(c: Correction, approve: boolean) {
  busy.value = true
  error.value = ''
  const { error: e } = await supabase.rpc('decide_time_correction', { p_correction_id: c.id, p_approve: approve })
  busy.value = false
  if (e) error.value = e.message
  await load()
}

async function setExempt(memberId: string, value: boolean) {
  error.value = ''
  const { error: e } = value
    ? await supabase.from('time_clock_exemptions').insert({ team_member_id: memberId, account_id: props.accountId })
    : await supabase.from('time_clock_exemptions').delete().eq('team_member_id', memberId)
  if (e) error.value = e.message
  await load()
}

const selectedRow = computed(() => rows.value.find((r) => r.member.id === selected.value) ?? null)
const th = 'px-3 py-2 text-left text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted'
const td = 'border-t border-line-divider px-3 py-2.5 text-[13px] text-ink-900'
</script>

<template>
  <div class="flex flex-col gap-4" data-cy="team-month">
    <p v-if="error" role="alert" class="text-[12.5px] text-danger-text">{{ error }}</p>

    <section v-if="pending.length" class="rounded-card border border-warning-border bg-warning-bg2 px-4 py-3" data-cy="pending-corrections">
      <h2 class="text-[14.5px] font-bold text-ink-900">{{ t('Corrections waiting', 'Correcciones pendientes') }} · {{ pending.length }}</h2>
      <div v-for="c in pending" :key="c.id" class="mt-2.5 flex flex-wrap items-center gap-3" data-cy="pending-correction">
        <span class="text-[13.5px] font-semibold text-ink-900">{{ name(c.team_member_id) }}</span>
        <span class="text-[12.5px] text-ink-muted">
          <span class="capitalize">{{ dayLabel(c.work_date) }}</span> ·
          {{ workEntryLabel(c.kind, t) }}<template v-if="replacedAt(c)"> {{ replacedAt(c) }}</template><template v-else> {{ t('(missing)', '(sin fichar)') }}</template>
          → <strong class="font-mono text-ink-900">{{ clock(c.at) }}</strong> · «{{ c.reason }}»
        </span>
        <span class="flex-grow" />
        <UiBtn size="sm" :disabled="busy" data-cy="reject-correction" @click="decide(c, false)">{{ t('Reject', 'Rechazar') }}</UiBtn>
        <UiBtn size="sm" variant="primary" :disabled="busy" data-cy="approve-correction" @click="decide(c, true)">{{ t('Approve', 'Aprobar') }}</UiBtn>
      </div>
    </section>

    <section class="overflow-x-auto rounded-card border border-line bg-surface">
      <table class="w-full border-collapse">
        <thead>
          <tr>
            <th :class="th">{{ t('Person', 'Persona') }}</th>
            <th :class="th">{{ t('Today', 'Hoy') }}</th>
            <th :class="th">{{ t('This week', 'Esta semana') }}</th>
            <th :class="th">{{ t('This month', 'Este mes') }}</th>
            <th :class="th">{{ t('Days', 'Días') }}</th>
            <th :class="th">{{ t('Status', 'Estado') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in rows"
            :key="r.member.id"
            class="cursor-pointer"
            :class="selected === r.member.id ? 'bg-brand-tint' : 'hover:bg-surface-subtle'"
            data-cy="team-month-row"
            :data-member="r.member.full_name"
            @click="selected = r.member.id"
          >
            <td :class="td"><strong>{{ r.member.full_name }}</strong></td>
            <template v-if="r.exempt">
              <td :class="td" colspan="4" class="text-ink-muted">{{ t("Doesn't clock (excluded)", 'No ficha (excluido)') }}</td>
              <td :class="td" />
            </template>
            <template v-else>
              <td :class="td" class="font-mono">{{ todaySpan(r.today) }}</td>
              <td :class="td" class="font-mono">{{ formatWorked(r.week) }}</td>
              <td :class="td" class="font-mono" data-cy="team-month-total">{{ formatWorked(r.month) }}</td>
              <td :class="td">{{ r.days }}</td>
              <td :class="td"><span v-if="statePill(r.today)" class="inline-flex h-[22px] items-center rounded-pill px-2 text-[11.5px] font-semibold" :class="statePill(r.today)!.cls">{{ statePill(r.today)!.label }}</span></td>
            </template>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="selectedRow" class="rounded-card border border-line bg-surface px-4 py-3" data-cy="team-month-detail">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-[14.5px] font-bold text-ink-900">{{ selectedRow.member.full_name }} · {{ t('the month in detail', 'detalle del mes') }}</h2>
        <label class="flex items-center gap-2 text-[12.5px] text-ink-muted">
          <input type="checkbox" :checked="selectedRow.exempt" data-cy="team-month-exempt" @change="setExempt(selectedRow.member.id, ($event.target as HTMLInputElement).checked)" />
          {{ t("Doesn't have to clock (self-employed)", 'No tiene que fichar (autónomo)') }}
        </label>
      </div>
      <table v-if="detailDays.length" class="mt-2 w-full border-collapse">
        <thead>
          <tr>
            <th :class="th">{{ t('Day', 'Día') }}</th>
            <th :class="th">{{ t('In', 'Entrada') }}</th>
            <th :class="th">{{ t('Breaks', 'Pausas') }}</th>
            <th :class="th">{{ t('Out', 'Salida') }}</th>
            <th :class="th">{{ t('Total', 'Total') }}</th>
            <th :class="th">{{ t('Notes', 'Notas') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in detailDays" :key="d.date" data-cy="team-month-day" :data-date="d.date">
            <td :class="td" class="capitalize">{{ dayLabel(d.date) }}</td>
            <td :class="td" class="font-mono">{{ d.firstIn ? clock(d.firstIn) : '—' }}</td>
            <td :class="td" class="font-mono">{{ breaksOf(d) || '—' }}</td>
            <td :class="td" class="font-mono">{{ d.lastOut ? clock(d.lastOut) : '—' }}</td>
            <td :class="td" class="font-mono">{{ d.open ? '—' : formatWorked(d.workedMinutes) }}</td>
            <td :class="td" class="text-[12.5px] text-ink-muted">
              <span v-if="d.missingOut" class="mr-1 inline-flex h-[22px] items-center rounded-pill bg-warning-bg px-2 text-[11.5px] font-semibold text-warning-text">{{ t('No clock-out', 'Sin salida') }}</span>
              <span v-for="c in notesFor(d.date)" :key="c.id" class="block" data-cy="team-month-note">
                <template v-if="c.status === 'pending'"><span class="inline-flex h-[22px] items-center rounded-pill bg-warning-bg px-2 text-[11.5px] font-semibold text-warning-text">{{ t('Correction pending', 'Corrección pendiente') }}</span></template>
                <template v-else>
                  {{ c.status === 'approved' ? t('Corrected', 'Corregida') : t('Correction rejected', 'Corrección rechazada') }}:
                  {{ workEntryLabel(c.kind, t).toLowerCase() }} {{ clock(c.at) }}<template v-if="replacedAt(c)"> ({{ t('was', 'antes') }} {{ replacedAt(c) }})</template>
                  · {{ t('asked', 'pedida') }} «{{ c.reason }}» · {{ name(c.decided_by) }}
                </template>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="mt-2 text-[13px] text-ink-muted">{{ t('Nothing clocked this month.', 'Nada fichado este mes.') }}</p>
      <p class="mt-2.5 text-[12px] text-ink-muted">{{ t('Records are kept for four years and never deleted: every correction stays beside the original entry, with who asked for it and who approved it.', 'Los registros se guardan 4 años y no se borran: cada corrección queda al lado del fichaje original, con quién la pidió y quién la aprobó.') }}</p>
    </section>
  </div>
</template>

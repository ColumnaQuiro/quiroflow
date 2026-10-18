<script setup lang="ts">
import { workdaySummary, workdaysOf, formatWorked, workdayClock, workdayWeekStart, workdayMonthBounds, workEntryLabel, type WorkEntry, type WorkdaySummary } from '../../utils/workday'
import { clinicDateOf, startOfLocalDate } from '../../utils/clinicClock'

// Registro de jornada: one person's month -- their days, hours and the
// corrections they have asked for -- and where they ask for one. A
// correction names the entry it fixes (or the one that is missing), the real
// time and why; an owner approves it, and the original entry is kept beside
// it either way (decide_time_correction).
//
// Shared by the web's /jornada and the app's, so no account store.
const props = defineProps<{ accountId: string; teamMemberId: string; timeZone: string }>()
const t = useT()
const { preference: lang } = useLang()
const supabase = useSupabaseClient()

interface Correction { id: string; work_date: string; kind: string; at: string; reason: string; status: string; replaces_entry_id: string | null }

const today = computed(() => clinicDateOf(new Date(), props.timeZone))
const month = ref(today.value.slice(0, 7))
const entries = ref<WorkEntry[]>([])
const corrections = ref<Correction[]>([])
const loaded = ref(false)

async function load() {
  const { first, last } = workdayMonthBounds(month.value)
  // From the Monday of this week when it began last month, for "this week".
  const from = [first, workdayWeekStart(today.value)].sort()[0]!
  const [{ data: es }, { data: cs }] = await Promise.all([
    supabase.from('time_entries').select('id, kind, at, work_date').eq('team_member_id', props.teamMemberId).is('superseded_by', null).gte('work_date', from).lte('work_date', last).order('at'),
    supabase.from('time_corrections').select('id, work_date, kind, at, reason, status, replaces_entry_id').eq('team_member_id', props.teamMemberId).gte('work_date', first).lte('work_date', last).order('requested_at', { ascending: false }),
  ])
  entries.value = (es as WorkEntry[] | null) ?? []
  corrections.value = (cs as Correction[] | null) ?? []
  loaded.value = true
}
onMounted(load)
watch(month, load)

const bounds = computed(() => workdayMonthBounds(month.value))
const allDays = computed(() => workdaysOf(entries.value))
// A day with nothing clocked can still be asked for (missingDay), so it is
// listed while it is being filled in.
const missingDay = ref('')
const days = computed(() => {
  const inMonth = allDays.value.filter((d) => d.date >= bounds.value.first && d.date <= bounds.value.last)
  const extra = missingDay.value && !inMonth.some((d) => d.date === missingDay.value) ? [workdaySummary(missingDay.value, [])] : []
  return [...inMonth, ...extra].sort((a, b) => b.date.localeCompare(a.date))
})
const monthMinutes = computed(() => days.value.reduce((s, d) => s + d.workedMinutes, 0))
const weekMinutes = computed(() => {
  const start = workdayWeekStart(today.value)
  return allDays.value.filter((d) => d.date >= start && d.date <= today.value).reduce((s, d) => s + d.workedMinutes, 0)
})
const pendingOn = computed(() => new Set(corrections.value.filter((c) => c.status === 'pending').map((c) => c.work_date)))

function shiftMonth(by: number) {
  const [y, m] = month.value.split('-').map(Number)
  const d = new Date(Date.UTC(y!, m! - 1 + by, 1))
  month.value = d.toISOString().slice(0, 7)
  editing.value = null
  missingDay.value = ''
}
const monthLabel = computed(() => new Date(`${month.value}-15T12:00:00Z`).toLocaleDateString(lang.value === 'es' ? 'es-ES' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }))
const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(lang.value === 'es' ? 'es-ES' : 'en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
const clock = (at: string) => workdayClock(at, props.timeZone)
function span(d: WorkdaySummary) {
  if (!d.entries.length) return '—'
  const start = d.firstIn ? clock(d.firstIn) : '?'
  if (d.missingOut) return `${start} – ?`
  if (d.open) return `${start} – ${t('ongoing', 'en curso')}`
  return `${start} – ${d.lastOut ? clock(d.lastOut) : '?'} · ${formatWorked(d.workedMinutes)}`
}

// ---- asking for a correction
const editing = ref<string | null>(null)
const target = ref('')
const time = ref('')
const reason = ref('')
const busy = ref(false)
const error = ref('')
const sent = ref('')
const editingDay = computed(() => days.value.find((d) => d.date === editing.value) ?? null)

function open(date: string) {
  sent.value = ''
  error.value = ''
  if (editing.value === date) {
    editing.value = null
    return
  }
  editing.value = date
  const d = days.value.find((x) => x.date === date)
  reason.value = ''
  if (!d || !d.entries.length || d.open) {
    target.value = d?.entries.length ? 'add:out' : 'add:in'
    time.value = ''
  } else {
    target.value = `fix:${d.entries[0]!.id}`
    time.value = clock(d.entries[0]!.at)
  }
}
function addMissingDay(date: string) {
  if (!date || date > today.value) return
  missingDay.value = date
  month.value = date.slice(0, 7)
  editing.value = null
  nextTick(() => open(date))
}
watch(target, (v) => {
  if (!v.startsWith('fix:')) return
  const e = editingDay.value?.entries.find((x) => x.id === v.slice(4))
  if (e) time.value = clock(e.at)
})

async function send() {
  const date = editing.value
  if (!date || !time.value || !reason.value.trim()) {
    error.value = t('Give the real time and say why.', 'Indica la hora real y el motivo.')
    return
  }
  const fixing = target.value.startsWith('fix:') ? editingDay.value?.entries.find((e) => e.id === target.value.slice(4)) ?? null : null
  const kind = fixing ? fixing.kind : target.value.slice(4)
  const [h, m] = time.value.split(':').map(Number)
  let at = new Date(startOfLocalDate(date, props.timeZone).getTime() + (h! * 60 + m!) * 60_000)
  // A salida (or a vuelta) earlier than the day's entrada is after midnight.
  const firstIn = editingDay.value?.firstIn
  if ((kind === 'out' || kind === 'break_end') && firstIn && at.getTime() < Date.parse(firstIn)) at = new Date(at.getTime() + 24 * 3600_000)
  busy.value = true
  error.value = ''
  const { error: e } = await supabase.rpc('request_time_correction', {
    p_account_id: props.accountId,
    p_work_date: date,
    p_kind: kind,
    p_at: at.toISOString(),
    p_replaces_entry_id: fixing?.id ?? null,
    p_reason: reason.value.trim(),
  })
  busy.value = false
  if (e) {
    error.value = e.message
    return
  }
  editing.value = null
  missingDay.value = ''
  sent.value = t('Sent to the owner. Your original entry stays as it was until they approve it.', 'Enviada al propietario. Tu fichaje original se mantiene hasta que la apruebe.')
  await load()
}

const statusLabel = (s: string) => (s === 'pending' ? t('Pending', 'Pendiente') : s === 'approved' ? t('Approved', 'Aprobada') : t('Rejected', 'Rechazada'))
const field = 'h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900'
</script>

<template>
  <div class="flex flex-col gap-3" data-cy="my-month">
    <div class="flex items-center justify-between gap-2">
      <UiBtn variant="ghost" size="sm" :aria-label="t('Previous month', 'Mes anterior')" data-cy="my-month-prev" @click="shiftMonth(-1)"><UiChevron dir="left" /></UiBtn>
      <p class="text-[14.5px] font-semibold capitalize text-ink-900">{{ monthLabel }}</p>
      <UiBtn variant="ghost" size="sm" :aria-label="t('Next month', 'Mes siguiente')" :disabled="month >= today.slice(0, 7)" @click="shiftMonth(1)"><UiChevron dir="right" /></UiBtn>
    </div>

    <div class="flex justify-between rounded-card border border-line bg-surface p-4">
      <div>
        <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('This month', 'Este mes') }}</p>
        <p class="mt-1 font-mono text-[20px] font-semibold text-ink-900" data-cy="my-month-total">{{ formatWorked(monthMinutes) }}</p>
      </div>
      <div class="text-right">
        <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('This week', 'Esta semana') }}</p>
        <p class="mt-1 font-mono text-[20px] font-semibold text-ink-900" data-cy="my-month-week">{{ formatWorked(weekMinutes) }}</p>
      </div>
    </div>

    <p v-if="sent" role="status" class="rounded-ctl bg-success-bg px-3 py-2 text-[13px] text-success-text" data-cy="correction-sent">{{ sent }}</p>

    <div class="rounded-card border border-line bg-surface px-4 py-1">
      <p v-if="loaded && !days.length" class="py-3 text-[13px] text-ink-muted">{{ t('No days clocked this month.', 'Ningún día fichado este mes.') }}</p>
      <div v-for="d in days" :key="d.date" class="border-b border-line-divider last:border-b-0">
        <button type="button" class="flex w-full items-center justify-between gap-2 py-2.5 text-left" data-cy="my-month-day" :data-date="d.date" @click="open(d.date)">
          <span class="flex flex-wrap items-center gap-2 text-[13.5px] capitalize text-ink-900">
            {{ dayLabel(d.date) }}
            <span v-if="pendingOn.has(d.date)" class="inline-flex h-5 items-center rounded-pill bg-warning-bg px-2 text-[11px] font-semibold normal-case text-warning-text">{{ t('Correction pending', 'Corrección pendiente') }}</span>
          </span>
          <span class="font-mono text-[12.5px] text-ink-muted">{{ span(d) }}</span>
        </button>
        <div v-if="editing === d.date" class="flex flex-col gap-2 pb-3" data-cy="correction-form">
          <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('Ask for a correction', 'Pedir una corrección') }}</p>
          <label class="flex flex-col gap-1 text-[12.5px] text-ink-muted">{{ t('What to fix', 'Qué corregir') }}
            <select v-model="target" :class="field" data-cy="correction-target">
              <option v-for="e in d.entries" :key="e.id" :value="`fix:${e.id}`">{{ workEntryLabel(e.kind, t) }} {{ clock(e.at) }}</option>
              <option v-for="k in ['in', 'break_start', 'break_end', 'out']" :key="k" :value="`add:${k}`">{{ t('Add a missing', 'Añadir que falta:') }} {{ workEntryLabel(k, t).toLowerCase() }}</option>
            </select>
          </label>
          <label class="flex flex-col gap-1 text-[12.5px] text-ink-muted">{{ t('Real time', 'Hora real') }}<input v-model="time" type="time" :class="field" data-cy="correction-time" /></label>
          <label class="flex flex-col gap-1 text-[12.5px] text-ink-muted">{{ t('Reason', 'Motivo') }}<input v-model="reason" :class="field" :placeholder="t('I forgot to clock out', 'Olvidé fichar la salida')" data-cy="correction-reason" /></label>
          <p v-if="error" role="alert" class="text-[12.5px] text-danger-text">{{ error }}</p>
          <UiBtn variant="primary" size="lg" :disabled="busy" data-cy="correction-send" @click="send">{{ t('Send to the owner', 'Enviar al propietario') }}</UiBtn>
        </div>
      </div>
    </div>
    <label class="flex items-center justify-between gap-2 text-[12.5px] text-ink-muted">{{ t('A day with nothing clocked?', '¿Un día sin ningún fichaje?') }}
      <input type="date" :max="today" class="h-9 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-900" data-cy="my-month-add-day" @change="addMissingDay(($event.target as HTMLInputElement).value)" />
    </label>

    <div v-if="corrections.length" class="rounded-card border border-line bg-surface px-4 py-2">
      <p class="py-1 text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('Your corrections', 'Tus correcciones') }}</p>
      <div v-for="c in corrections" :key="c.id" class="flex items-center justify-between gap-2 border-b border-line-divider py-2 text-[13px] last:border-b-0" data-cy="my-correction" :data-status="c.status">
        <span class="text-ink-900"><span class="capitalize">{{ dayLabel(c.work_date) }}</span> · {{ workEntryLabel(c.kind, t) }} <span class="font-mono">{{ clock(c.at) }}</span> <span class="text-ink-muted">· «{{ c.reason }}»</span></span>
        <span class="shrink-0 text-[12px] font-semibold" :class="c.status === 'approved' ? 'text-success-text' : c.status === 'rejected' ? 'text-danger-text' : 'text-warning-text'">{{ statusLabel(c.status) }}</span>
      </div>
    </div>
  </div>
</template>

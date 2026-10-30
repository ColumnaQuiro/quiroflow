<script setup lang="ts">
import { workdaySummary, formatWorked, workdayClock, WORKDAY_STALE_HOURS, type WorkEntry } from '../../utils/workday'
import { clinicDateOf } from '../../utils/clinicClock'

// Registro de jornada, on My Day (web and app): the person's own clock.
// Entrada, pausa, vuelta, salida -- each one a call to clock_time(), which
// stamps the server's time; nothing here sends a time. A day left open is
// fixed with a correction from "My month", which an owner approves.
//
// Shared by the web's My Day and the app's, so no account store: the caller
// passes who and where.
// `compact`: web My Day, where the day's visits come first. Once the person
// has clocked in today the card shrinks to one line with the same buttons --
// a full card of "0 h 00" stood above the schedule all day. Before the first
// clock-in, or with an earlier day left open, it stays the full card: then
// the clock is the thing to deal with.
const props = defineProps<{ accountId: string; teamMemberId: string; timeZone: string; monthTo: string; compact?: boolean }>()
const t = useT()
const supabase = useSupabaseClient()

const exempt = ref<boolean | null>(null)
const entries = ref<WorkEntry[]>([])
const busy = ref(false)
const error = ref('')
const now = ref(new Date())
let timer: ReturnType<typeof setInterval> | null = null

async function load() {
  const since = new Date(Date.now() - 40 * 3600_000).toISOString()
  const [{ data: ex }, { data }] = await Promise.all([
    supabase.from('time_clock_exemptions').select('team_member_id').eq('team_member_id', props.teamMemberId).maybeSingle(),
    supabase.from('time_entries').select('id, kind, at, work_date').eq('team_member_id', props.teamMemberId).is('superseded_by', null).gte('at', since).order('at'),
  ])
  exempt.value = !!ex
  entries.value = (data as WorkEntry[] | null) ?? []
  now.value = new Date()
}

onMounted(() => {
  load()
  timer = setInterval(() => { now.value = new Date() }, 30_000)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
watch(() => props.teamMemberId, load)

// The day shown: the one still going, or else today's (closed) one.
const day = computed(() => {
  const last = entries.value[entries.value.length - 1]
  const today = clinicDateOf(now.value, props.timeZone)
  const going = last && last.kind !== 'out' && now.value.getTime() - Date.parse(last.at) <= WORKDAY_STALE_HOURS * 3600_000
  const date = going ? last.work_date : today
  const of = entries.value.filter((e) => e.work_date === date)
  return of.length ? workdaySummary(date, of, now.value) : null
})
// An earlier day never closed: nothing to clock against, a correction to ask for.
const leftOpen = computed(() => {
  const last = entries.value[entries.value.length - 1]
  return !!last && last.kind !== 'out' && now.value.getTime() - Date.parse(last.at) > WORKDAY_STALE_HOURS * 3600_000
})
const state = computed(() => day.value?.state ?? 'off')
const asBar = computed(() => props.compact && !!day.value && !leftOpen.value)

const detail = computed(() => {
  const d = day.value
  if (!d) return ''
  const clock = (at: string) => workdayClock(at, props.timeZone)
  const parts: string[] = []
  if (d.firstIn) parts.push(`${t('In', 'Entrada')} ${clock(d.firstIn)}`)
  for (const b of d.breaks) parts.push(`${t('Break', 'Pausa')} ${clock(b.start)}–${b.end ? clock(b.end) : '…'}`)
  if (d.lastOut) parts.push(`${t('Out', 'Salida')} ${clock(d.lastOut)}`)
  return parts.join(' · ')
})

async function clock(kind: 'in' | 'break_start' | 'break_end' | 'out') {
  busy.value = true
  error.value = ''
  const { error: e } = await supabase.rpc('clock_time', { p_account_id: props.accountId, p_kind: kind })
  if (e) error.value = e.message
  await load()
  busy.value = false
}
</script>

<template>
  <section
    v-if="exempt === false && asBar"
    class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-line bg-surface px-4 py-2"
    data-cy="clock-card"
    :data-state="state"
  >
    <span class="font-mono text-[15px] font-semibold text-ink-900" data-cy="clock-worked">{{ formatWorked(day?.workedMinutes ?? 0) }}</span>
    <span class="min-w-0 flex-1 truncate text-[12.5px] text-ink-muted" data-cy="clock-detail">
      {{ detail }}<template v-if="state === 'working'"> · {{ t('working', 'trabajando') }}</template><template v-else-if="state === 'on_break'"> · {{ t('on a break', 'en pausa') }}</template>
    </span>
    <div class="flex items-center gap-2">
      <UiBtn v-if="state === 'off'" variant="secondary" size="sm" :disabled="busy" data-cy="clock-in" @click="clock('in')">{{ t('Clock in again', 'Volver a fichar entrada') }}</UiBtn>
      <template v-else>
        <UiBtn v-if="state === 'working'" variant="secondary" size="sm" :disabled="busy" data-cy="clock-break" @click="clock('break_start')">{{ t('Break', 'Pausa') }}</UiBtn>
        <UiBtn v-else variant="secondary" size="sm" :disabled="busy" data-cy="clock-back" @click="clock('break_end')">{{ t('Back from break', 'Vuelta') }}</UiBtn>
        <UiBtn variant="secondary" size="sm" class="!text-danger-text" :disabled="busy" data-cy="clock-out" @click="clock('out')">{{ t('Clock out', 'Salida') }}</UiBtn>
      </template>
      <NuxtLink :to="monthTo" class="text-[12.5px] font-semibold text-brand-text" data-cy="clock-month">{{ t('My month', 'Mi mes') }}</NuxtLink>
    </div>
    <p v-if="error" role="alert" class="w-full text-[12.5px] text-danger-text">{{ error }}</p>
  </section>
  <section v-else-if="exempt === false" class="rounded-card border border-line bg-surface p-4" data-cy="clock-card" :data-state="state">
    <div class="flex items-baseline justify-between gap-3">
      <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t("Today's working time", 'Jornada de hoy') }}</p>
      <span class="font-mono text-[20px] font-semibold text-ink-900" data-cy="clock-worked">{{ formatWorked(day?.workedMinutes ?? 0) }}</span>
    </div>
    <p v-if="detail" class="mt-1 text-[12.5px] text-ink-muted" data-cy="clock-detail">
      {{ detail }}<template v-if="state === 'working'"> · {{ t('working', 'trabajando') }}</template><template v-else-if="state === 'on_break'"> · {{ t('on a break', 'en pausa') }}</template>
    </p>
    <p v-if="leftOpen" class="mt-2 text-[12.5px] text-warning-text" data-cy="clock-left-open">
      {{ t('An earlier day was left without a clock-out. Ask for a correction in My month.', 'Un día anterior quedó sin salida. Pide una corrección en Mi mes.') }}
    </p>

    <div class="mt-3 flex gap-2">
      <UiBtn v-if="state === 'off'" variant="primary" size="lg" class="flex-1" :disabled="busy" data-cy="clock-in" @click="clock('in')">
        {{ day ? t('Clock in again', 'Volver a fichar entrada') : t('Clock in', 'Fichar entrada') }}
      </UiBtn>
      <template v-else>
        <UiBtn v-if="state === 'working'" variant="secondary" size="lg" class="flex-1" :disabled="busy" data-cy="clock-break" @click="clock('break_start')">{{ t('Break', 'Pausa') }}</UiBtn>
        <UiBtn v-else variant="secondary" size="lg" class="flex-1" :disabled="busy" data-cy="clock-back" @click="clock('break_end')">{{ t('Back from break', 'Vuelta') }}</UiBtn>
        <UiBtn variant="secondary" size="lg" class="flex-1 !text-danger-text" :disabled="busy" data-cy="clock-out" @click="clock('out')">{{ t('Clock out', 'Salida') }}</UiBtn>
      </template>
    </div>
    <p v-if="error" role="alert" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
    <p class="mt-3 text-[12px] text-ink-muted">
      {{ t('The time is the server\'s. Forgot to clock? Ask for a correction in', 'La hora la pone el servidor. ¿Olvidaste fichar? Pide una corrección en') }}
      <NuxtLink :to="monthTo" class="font-semibold text-brand-text" data-cy="clock-month">{{ t('My month', 'Mi mes') }}</NuxtLink>.
    </p>
  </section>
</template>

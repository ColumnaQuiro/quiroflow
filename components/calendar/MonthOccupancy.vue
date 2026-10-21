<script setup lang="ts">
import { fetchAllRows } from '~/composables/useFetchAllRows'
import type { BusinessHours } from '~/utils/businessHours'
import { hoursLabel, monthOccupancy, type OccupancyRange } from '~/utils/monthOccupancy'

// The calendar's Month view: a month of days, each with how full it is and
// how much time is still free, so the gaps show at a glance where the week
// view only ever showed seven days. A day opens in the Day view. The figures
// are utils/monthOccupancy.ts's; this fetches the month and lays it out.
//
// Whose time: the practitioners on the tab that is open -- one, or everyone
// at the clinic -- counted at every clinic they work at, since a visit at the
// other one takes the same hour.

const props = defineProps<{
  month: Date
  clinicId: string
  clinicHours: BusinessHours | null | undefined
  practitioners: { id: string; full_name: string; business_hours: BusinessHours | null }[]
}>()
const emit = defineEmits<{ openDay: [day: Date] }>()

const supabase = useSupabaseClient()
const t = useT()

const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const addDays = (d: Date, n: number) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
// Monday-first weeks, as the week view.
const gridDays = computed(() => {
  const first = startOfMonth(props.month)
  const start = addDays(first, -((first.getDay() + 6) % 7))
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
  const end = addDays(last, 6 - ((last.getDay() + 6) % 7))
  const days: Date[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d)
  return days
})
const inMonth = (d: Date) => d.getMonth() === props.month.getMonth()

const appointments = ref<OccupancyRange[]>([])
const blocks = ref<OccupancyRange[]>([])
const loading = ref(true)
const failed = ref(false)

let run = 0
async function load() {
  const mine = ++run
  loading.value = true
  failed.value = false
  const ids = props.practitioners.map((p) => p.id)
  const from = gridDays.value[0]!.toISOString()
  const to = addDays(gridDays.value[gridDays.value.length - 1]!, 1).toISOString()
  try {
    const [appts, blockRows] = await Promise.all([
      ids.length
        ? fetchAllRows<OccupancyRange>((f, tt) =>
            supabase
              .from('appointments')
              .select('practitioner_id, room_id, starts_at, ends_at')
              .in('practitioner_id', ids)
              .is('deleted_at', null)
              .not('status', 'in', '(cancelled,no_show)')
              .lt('starts_at', to)
              .gt('ends_at', from)
              .order('starts_at')
              .range(f, tt) as any,
          )
        : Promise.resolve([] as OccupancyRange[]),
      // Their own blocks anywhere, and this clinic's closures.
      fetchAllRows<OccupancyRange & { clinic_id: string }>((f, tt) =>
        supabase
          .from('availability_blocks')
          .select('practitioner_id, room_id, starts_at, ends_at, clinic_id')
          .or(`clinic_id.eq.${props.clinicId}${ids.length ? `,practitioner_id.in.(${ids.join(',')})` : ''}`)
          .lt('starts_at', to)
          .gt('ends_at', from)
          .range(f, tt) as any,
      ),
    ])
    if (mine !== run) return
    appointments.value = appts
    blocks.value = blockRows.filter((b) => b.practitioner_id ? ids.includes(b.practitioner_id) : b.clinic_id === props.clinicId)
  } catch {
    if (mine === run) failed.value = true
  } finally {
    if (mine === run) loading.value = false
  }
}
watch(() => [props.month.getFullYear(), props.month.getMonth(), props.clinicId, props.practitioners.map((p) => p.id).join(',')], load, { immediate: true })

const days = computed(() =>
  monthOccupancy({ days: gridDays.value, practitioners: props.practitioners, clinicHours: props.clinicHours, appointments: appointments.value, blocks: blocks.value }),
)
const monthDays = computed(() => days.value.filter((d) => inMonth(d.day)))
const totals = computed(() => {
  const list = monthDays.value
  const measured = list.every((d) => d.capacityMin !== null)
  const capacity = list.reduce((s, d) => s + (d.capacityMin ?? 0), 0)
  const booked = list.reduce((s, d) => s + d.bookedMin, 0)
  return {
    visits: list.reduce((s, d) => s + d.visits, 0),
    booked,
    free: measured ? list.reduce((s, d) => s + (d.freeMin ?? 0), 0) : null,
    share: measured && capacity ? booked / capacity : null,
  }
})

const pct = (share: number) => `${Math.round(share * 100)} %`
// Full is a fact, not a warning: amber from three quarters, red when there is
// under half an hour left in a working day.
function tone(d: { share: number | null; freeMin: number | null; capacityMin: number | null }) {
  if (d.share === null) return 'bg-line-control'
  if (d.capacityMin && (d.freeMin ?? 0) < 30) return 'bg-danger-text'
  if (d.share >= 0.75) return 'bg-warning-text'
  return 'bg-brand'
}
const isToday = (d: Date) => d.toDateString() === new Date().toDateString()
const weekdays = computed(() => [t('Mon', 'Lun'), t('Tue', 'Mar'), t('Wed', 'Mié'), t('Thu', 'Jue'), t('Fri', 'Vie'), t('Sat', 'Sáb'), t('Sun', 'Dom')])
const dayLabel = (d: Date) => d.toLocaleDateString(t('en-GB', 'es-ES'), { weekday: 'long', day: 'numeric', month: 'long' })
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-page px-3 pb-6 pt-3 lg:px-6" data-cy="calendar-month" :data-ready="loading ? undefined : 'true'">
    <div class="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-ink-muted" data-cy="calendar-month-totals">
      <span><strong class="font-semibold text-ink-900" data-cy="month-visits">{{ totals.visits }}</strong> {{ t('visits', 'citas') }}</span>
      <span v-if="totals.share !== null"><strong class="font-semibold text-ink-900" data-cy="month-share">{{ pct(totals.share) }}</strong> {{ t('booked', 'ocupado') }}</span>
      <span v-if="totals.free !== null"><strong class="font-semibold text-ink-900" data-cy="month-free">{{ hoursLabel(totals.free) }}</strong> {{ t('free', 'libres') }}</span>
      <span v-else class="text-ink-faint">{{ t('Set working hours in Settings › Team to see how full each day is.', 'Pon los horarios en Ajustes › Equipo para ver la ocupación de cada día.') }}</span>
    </div>

    <p v-if="failed" class="mt-3 rounded-card border border-danger-border bg-danger-bg px-4 py-3 text-[13px] text-danger-text">
      {{ t('The month could not be loaded.', 'No se ha podido cargar el mes.') }}
      <button type="button" class="ml-2 font-semibold underline" @click="load">{{ t('Try again', 'Reintentar') }}</button>
    </p>

    <div class="mt-3 grid grid-cols-7 gap-px overflow-hidden rounded-card border border-line bg-line">
      <div v-for="w in weekdays" :key="w" class="bg-surface-subtle px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[.04em] text-ink-muted">{{ w }}</div>
      <button
        v-for="d in days"
        :key="d.day.toDateString()"
        type="button"
        class="flex min-h-[84px] flex-col gap-1 bg-surface px-2 py-1.5 text-left outline-none hover:bg-surface-subtle focus-visible:shadow-focus lg:min-h-[104px]"
        :class="inMonth(d.day) ? '' : 'opacity-45'"
        :aria-label="`${dayLabel(d.day)}: ${d.visits} ${t('visits', 'citas')}${d.share !== null ? `, ${pct(d.share)} ${t('booked', 'ocupado')}` : ''}${d.freeMin !== null ? `, ${hoursLabel(d.freeMin)} ${t('free', 'libres')}` : ''}`"
        data-cy="month-day"
        :data-day="d.day.getDate()"
        :data-in-month="inMonth(d.day) || undefined"
        @click="emit('openDay', d.day)"
      >
        <span class="flex items-center justify-between">
          <span class="flex h-6 w-6 items-center justify-center rounded-full text-[12.5px] font-semibold" :class="isToday(d.day) ? 'bg-brand text-white' : 'text-ink-900'">{{ d.day.getDate() }}</span>
          <span v-if="d.visits" class="text-[11.5px] text-ink-muted">{{ d.visits }}</span>
        </span>
        <template v-if="loading">
          <UiSkeleton class="h-1.5 w-full rounded-full" />
        </template>
        <template v-else-if="d.capacityMin === 0">
          <span class="text-[11.5px] text-ink-faint">{{ t('Closed', 'Cerrado') }}</span>
        </template>
        <template v-else>
          <span v-if="d.share !== null" class="h-1.5 w-full overflow-hidden rounded-full bg-chip-bg" aria-hidden="true">
            <span class="block h-full rounded-full" :class="tone(d)" :style="{ width: `${Math.max(d.share * 100, d.bookedMin ? 4 : 0)}%` }" />
          </span>
          <span v-if="d.share !== null" class="text-[11.5px] font-medium text-ink-700" data-cy="month-day-share">{{ pct(d.share) }}</span>
          <span v-if="d.freeMin !== null && d.freeMin > 0" class="text-[11.5px] text-ink-muted" data-cy="month-day-free">{{ hoursLabel(d.freeMin) }} {{ t('free', 'libres') }}</span>
          <span v-else-if="d.freeMin === 0" class="text-[11.5px] font-medium text-danger-text">{{ t('Full', 'Lleno') }}</span>
          <span v-else-if="d.capacityMin === null && d.bookedMin" class="text-[11.5px] text-ink-muted">{{ hoursLabel(d.bookedMin) }} {{ t('booked', 'reservado') }}</span>
        </template>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { carePlanPeriods, periodWindow, planOnTrack, type PeriodPlan, type PeriodStatus } from '../../utils/carePlanPeriods'
import { clinicDateOf } from '../../utils/clinicClock'

// The care plan, period by period, as a row of circles (utils/carePlanPeriods.ts):
// each period's visits done out of expected, coloured by how it went, with
// "on track" / "behind" for the plan. On the record's Overview and in the
// staff app's patient screen.
const props = defineProps<{ patientId: string; plan: PeriodPlan; timeZone?: string | null }>()

const t = useT()
const supabase = useSupabaseClient()
const visits = ref<{ day: string; status: string }[]>([])
const loading = ref(true)
const showAll = ref(false)
const zone = computed(() => props.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone)

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('appointments')
    .select('starts_at, status')
    .eq('patient_id', props.patientId)
    .is('deleted_at', null)
    .gte('starts_at', `${props.plan.started_at}T00:00:00Z`)
    .order('starts_at')
  visits.value = ((data as { starts_at: string; status: string }[] | null) ?? []).map((v) => ({ day: clinicDateOf(new Date(v.starts_at), zone.value), status: v.status }))
  loading.value = false
}
watch(() => [props.patientId, props.plan.started_at, props.plan.total_visits, props.plan.frequency_value, props.plan.visits_per_period], load, { immediate: true })

const today = computed(() => clinicDateOf(new Date(), zone.value))
const periods = computed(() => carePlanPeriods(props.plan, visits.value, today.value))
const shown = computed(() => (showAll.value ? periods.value : periodWindow(periods.value)))
const onTrack = computed(() => planOnTrack(periods.value))
const current = computed(() => periods.value.find((p) => p.isCurrent) ?? null)

const RING: Record<PeriodStatus, string> = {
  completed: 'border-success-accent bg-success-bg text-success-text',
  scheduled: 'border-warning-accent bg-warning-bg text-warning-text',
  behind: 'border-danger-text bg-danger-bg text-danger-text',
  current: 'border-brand bg-brand-tint text-brand-text',
  unscheduled: 'border-line-control bg-surface text-ink-faint',
}
const LEGEND = computed(() => [
  { key: 'completed', label: t('Done', 'Hecho'), dot: 'bg-success-accent' },
  { key: 'scheduled', label: t('Booked', 'Reservado'), dot: 'bg-warning-accent' },
  { key: 'behind', label: t('Behind', 'Retrasado'), dot: 'bg-danger-text' },
  { key: 'unscheduled', label: t('Not booked', 'Sin reservar'), dot: 'bg-line-control' },
])
const label = (start: string) => {
  const [, m, d] = start.split('-').map(Number)
  return `${d}/${m}`
}
</script>

<template>
  <div class="mt-3" data-cy="plan-periods" :data-ready="loading ? undefined : 'true'">
    <div class="flex flex-wrap items-center gap-2">
      <p v-if="current" class="text-[12.5px] text-ink-700" data-cy="plan-period-now">
        {{ t(`This period: ${current.completed} of ${current.expected}`, `Este periodo: ${current.completed} de ${current.expected}`) }}
        <span v-if="current.booked" class="text-ink-muted">{{ t(`(${current.booked} booked)`, `(${current.booked} reservada${current.booked === 1 ? '' : 's'})`) }}</span>
      </p>
      <span v-if="!loading" class="ml-auto rounded-pill px-2 py-0.5 text-[11px] font-semibold" :class="onTrack ? 'bg-success-bg text-success-text' : 'bg-danger-bg text-danger-text'" data-cy="plan-on-track">
        {{ onTrack ? t('On track', 'Al día') : t('Behind', 'Con retraso') }}
      </span>
    </div>
    <UiSkeleton v-if="loading" class="mt-2 h-12 w-full rounded-ctl" />
    <ol v-else class="mt-2 flex flex-wrap gap-2.5" :aria-label="t('Periods of the plan', 'Periodos del plan')">
      <li v-for="p in shown" :key="p.index" class="flex w-11 flex-col items-center gap-1" data-cy="plan-period" :data-status="p.status" :title="`${p.start} – ${p.end}`">
        <span class="flex h-10 w-10 items-center justify-center rounded-full border-2 text-[11.5px] font-semibold tabular-nums" :class="[RING[p.status], p.isCurrent ? 'ring-2 ring-brand/30 ring-offset-1 ring-offset-surface' : '']">
          {{ p.completed }}/{{ p.expected }}
        </span>
        <span class="text-[10.5px]" :class="p.isCurrent ? 'font-semibold text-brand-text' : 'text-ink-faint'">{{ p.isCurrent ? t('Now', 'Ahora') : label(p.start) }}</span>
      </li>
    </ol>
    <div v-if="!loading" class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
      <span v-for="l in LEGEND" :key="l.key" class="inline-flex items-center gap-1"><span class="h-2 w-2 rounded-full" :class="l.dot" />{{ l.label }}</span>
      <button v-if="periods.length > shown.length || showAll" type="button" class="ml-auto font-medium text-brand-text hover:underline" data-cy="plan-periods-all" @click="showAll = !showAll">
        {{ showAll ? t('Show fewer', 'Ver menos') : t(`All ${periods.length} periods`, `Los ${periods.length} periodos`) }}
      </button>
    </div>
  </div>
</template>

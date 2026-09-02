<script setup lang="ts">
// KPI: no-show rate for the current week, with a point-delta against last
// week. Scoped to "this week" like WeeklyVisitsWidget/VisitSummaryWidget
// rather than the dashboard's period filter, since it's meant to answer
// "how are we doing right now."
const props = defineProps<{ practitionerId?: string; clinicId?: string }>()

interface ApptRow { status: string }

const t = useT()
const supabase = useSupabaseClient()
const loading = ref(true)
const rate = ref<number | null>(null)
const deltaPts = ref<number | null>(null)

function rateFor(rows: ApptRow[]): number | null {
  const finished = rows.filter((r) => r.status === 'completed' || r.status === 'no_show')
  if (finished.length === 0) return null
  const noShow = finished.filter((r) => r.status === 'no_show').length
  return Math.round((noShow / finished.length) * 100)
}

async function fetchWeek(weekOf: Date): Promise<ApptRow[]> {
  const { from, to } = getWeekRange(weekOf)
  const { from: fromDate, to: toDate } = rangeBounds({ from, to })
  let query = supabase.from('appointments').select('status').gte('starts_at', fromDate.toISOString()).lte('starts_at', toDate.toISOString())
  if (props.practitionerId) query = query.eq('practitioner_id', props.practitionerId)
  if (props.clinicId) query = query.eq('clinic_id', props.clinicId)
  return fetchAllRows<ApptRow>((f, t) => query.range(f, t))
}

async function load() {
  loading.value = true
  const now = new Date()
  const lastWeek = new Date(now)
  lastWeek.setDate(lastWeek.getDate() - 7)
  const [thisWeekRows, lastWeekRows] = await Promise.all([fetchWeek(now), fetchWeek(lastWeek)])
  const thisRate = rateFor(thisWeekRows)
  const lastRate = rateFor(lastWeekRows)
  rate.value = thisRate
  deltaPts.value = thisRate !== null && lastRate !== null ? thisRate - lastRate : null
  loading.value = false
}
onMounted(load)
watch(() => [props.practitionerId, props.clinicId], load)
</script>

<template>
  <div v-if="loading" class="text-[13px] text-ink-faint">{{ t('Loading…', 'Cargando…') }}</div>
  <div v-else>
    <p class="font-mono text-[27px] leading-none text-ink-900">{{ rate === null ? '—' : `${rate}%` }}</p>
    <p v-if="deltaPts !== null" class="mt-1.5 text-[12px] font-medium" :class="deltaPts > 0 ? 'text-danger-text' : 'text-success-text'">
      {{ t(`${deltaPts > 0 ? '+' : ''}${deltaPts} pts vs last week`, `${deltaPts > 0 ? '+' : ''}${deltaPts} pts frente a la semana pasada`) }}
    </p>
    <p v-else class="mt-1.5 text-[12px] text-ink-muted2">{{ t('No finished visits last week', 'Ninguna visita finalizada la semana pasada') }}</p>
  </div>
</template>

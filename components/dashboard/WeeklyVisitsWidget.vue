<script setup lang="ts">
const props = defineProps<{ practitionerId?: string; clinicId?: string }>()

const supabase = useSupabaseClient()
const loading = ref(true)

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const kept = ref<number[]>(Array(7).fill(0))
const lost = ref<number[]>(Array(7).fill(0))

async function load() {
  loading.value = true
  const { from, to } = getWeekRange()
  const { from: fromDate, to: toDate } = rangeBounds({ from, to })

  let query = supabase
    .from('appointments')
    .select('starts_at, status')
    .gte('starts_at', fromDate.toISOString())
    .lte('starts_at', toDate.toISOString())
  if (props.practitionerId) query = query.eq('practitioner_id', props.practitionerId)
  if (props.clinicId) query = query.eq('clinic_id', props.clinicId)

  const rows = await fetchAllRows((f, t) => query.range(f, t))

  const nextKept = Array(7).fill(0)
  const nextLost = Array(7).fill(0)
  for (const row of rows) {
    const day = new Date(row.starts_at).getDay()
    const index = day === 0 ? 6 : day - 1
    if (row.status === 'cancelled' || row.status === 'no_show') nextLost[index]++
    else nextKept[index]++
  }
  kept.value = nextKept
  lost.value = nextLost
  loading.value = false
}
onMounted(load)
watch(() => [props.practitionerId, props.clinicId], load)

// Bar heights scale to the 132px chart area based on the tallest stacked
// column across the week; a floor of 1 keeps an all-zero week from dividing
// by zero rather than implying real data.
const CHART_HEIGHT_PX = 132
const maxTotal = computed(() => Math.max(1, ...DAY_LABELS.map((_, i) => kept.value[i] + lost.value[i])))
function keptHeightPx(i: number) {
  return Math.round((kept.value[i] / maxTotal.value) * CHART_HEIGHT_PX)
}
function lostHeightPx(i: number) {
  return Math.round((lost.value[i] / maxTotal.value) * CHART_HEIGHT_PX)
}
</script>

<template>
  <div v-if="loading" class="text-[13px] text-ink-faint">Loading…</div>
  <div v-else>
    <div class="flex items-center gap-4 text-[11.5px] text-ink-muted2">
      <span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-[2px] bg-brand" />Visits</span>
      <span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-[2px] bg-chart-cancelled" />Cancelled / no-show</span>
    </div>
    <div class="mt-2 border-t border-line-row2" />
    <div class="mt-3 flex items-end" :style="{ height: `${CHART_HEIGHT_PX}px`, gap: '10px' }">
      <div v-for="(day, i) in DAY_LABELS" :key="day" class="flex h-full flex-1 flex-col-reverse items-stretch">
        <div class="w-full rounded-t-[2px] bg-brand" :style="{ height: `${keptHeightPx(i)}px` }" />
        <div v-if="lost[i] > 0" class="w-full bg-chart-cancelled" :style="{ height: `${lostHeightPx(i)}px` }" />
      </div>
    </div>
    <div class="mt-1.5 flex" style="gap: 10px">
      <span v-for="day in DAY_LABELS" :key="day" class="flex-1 text-center text-[11px] text-ink-muted2">{{ day }}</span>
    </div>
  </div>
</template>

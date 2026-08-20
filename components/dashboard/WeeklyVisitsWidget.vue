<script setup lang="ts">
import { Bar } from 'vue-chartjs'

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

const chartData = computed(() => ({
  labels: DAY_LABELS,
  datasets: [
    { label: 'Visits', data: kept.value, backgroundColor: '#4f46e5' },
    { label: 'Cancelled / no-show', data: lost.value, backgroundColor: '#fca5a5' },
  ],
}))
const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } },
  plugins: { legend: { position: 'bottom' as const } },
}
</script>

<template>
  <div v-if="loading" class="flex h-64 items-center justify-center text-sm text-gray-400">Loading…</div>
  <div v-else class="h-64">
    <Bar :data="chartData" :options="chartOptions" />
  </div>
</template>

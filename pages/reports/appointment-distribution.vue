<script setup lang="ts">
import { Bar } from 'vue-chartjs'

const supabase = useSupabaseClient()

interface AppointmentRow { starts_at: string; status: string }

const rangeDays = ref(90)
const loading = ref(true)
const rows = ref<AppointmentRow[]>([])

async function load() {
  loading.value = true
  const from = new Date()
  from.setDate(from.getDate() - rangeDays.value)
  const { data } = await supabase.from('appointments').select('starts_at, status').gte('starts_at', from.toISOString())
  rows.value = data ?? []
  loading.value = false
}
onMounted(load)
watch(rangeDays, load)

const SHIFTS = [
  { key: 'morning', label: 'Morning (before 12pm)', test: (h: number) => h < 12 },
  { key: 'afternoon', label: 'Afternoon (12–4pm)', test: (h: number) => h >= 12 && h < 16 },
  { key: 'evening', label: 'Evening (4pm+)', test: (h: number) => h >= 16 },
]

const shiftStats = computed(() => {
  return SHIFTS.map((shift) => {
    const inShift = rows.value.filter((r) => shift.test(new Date(r.starts_at).getHours()))
    const completed = inShift.filter((r) => r.status === 'completed').length
    const noShow = inShift.filter((r) => r.status === 'no_show').length
    const cancelled = inShift.filter((r) => r.status === 'cancelled').length
    const booked = inShift.filter((r) => r.status === 'booked').length
    const total = inShift.length
    const finished = completed + noShow // completed or definitively didn't show
    return {
      ...shift,
      total,
      completed,
      noShow,
      cancelled,
      booked,
      showRate: finished === 0 ? null : Math.round((completed / finished) * 100),
    }
  })
})

const shiftChartData = computed(() => ({
  labels: SHIFTS.map((s) => s.label),
  datasets: [
    { label: 'Completed', data: shiftStats.value.map((s) => s.completed), backgroundColor: '#4f46e5' },
    { label: 'No-show', data: shiftStats.value.map((s) => s.noShow), backgroundColor: '#ef4444' },
    { label: 'Cancelled', data: shiftStats.value.map((s) => s.cancelled), backgroundColor: '#fca5a5' },
    { label: 'Booked (upcoming)', data: shiftStats.value.map((s) => s.booked), backgroundColor: '#c7d2fe' },
  ],
}))
const shiftChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } },
  plugins: { legend: { position: 'bottom' as const } },
}

const hourLabels = Array.from({ length: 12 }, (_, i) => `${(i + 8) % 12 || 12}${i + 8 < 12 ? 'am' : 'pm'}`)
const byHour = computed(() => {
  const counts = new Array(12).fill(0)
  for (const r of rows.value) {
    const h = new Date(r.starts_at).getHours()
    if (h >= 8 && h < 20) counts[h - 8]++
  }
  return counts
})
const hourChartData = computed(() => ({
  labels: hourLabels,
  datasets: [{ label: 'Appointments', data: byHour.value, backgroundColor: '#4f46e5' }],
}))
const hourChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
  plugins: { legend: { display: false } },
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Appointment Distribution</h1>
      <NuxtLink to="/reports" class="text-sm text-gray-500 hover:text-gray-700">&larr; Reports</NuxtLink>
    </div>
    <p class="mt-1 text-sm text-gray-500">Which shift and time of day performs best, by volume and show-up rate.</p>

    <div class="mt-4 flex items-center gap-2">
      <button
        v-for="d in [30, 90, 365]"
        :key="d"
        type="button"
        class="rounded-md border px-3 py-1 text-sm"
        :class="rangeDays === d ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300 text-gray-600 hover:bg-gray-50'"
        @click="rangeDays = d"
      >
        Last {{ d }} days
      </button>
    </div>

    <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div v-for="s in shiftStats" :key="s.key" class="rounded-lg border border-gray-200 bg-white p-4">
        <p class="text-xs font-medium uppercase tracking-wide text-gray-500">{{ s.label }}</p>
        <p class="mt-1 text-2xl font-semibold text-gray-900">{{ loading ? '—' : s.total }}</p>
        <p class="text-xs text-gray-400">
          {{ loading ? '' : s.showRate === null ? 'No completed history yet' : `${s.showRate}% show-up rate` }}
        </p>
      </div>
    </div>

    <div class="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <h3 class="text-sm font-semibold text-gray-900">By shift, by outcome</h3>
      <div class="mt-3 h-72">
        <Bar v-if="!loading" :data="shiftChartData" :options="shiftChartOptions" />
      </div>
    </div>

    <div class="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <h3 class="text-sm font-semibold text-gray-900">By hour of day</h3>
      <div class="mt-3 h-64">
        <Bar v-if="!loading" :data="hourChartData" :options="hourChartOptions" />
      </div>
    </div>
  </div>
</template>

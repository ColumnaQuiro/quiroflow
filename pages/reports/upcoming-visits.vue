<script setup lang="ts">
import { Bar } from 'vue-chartjs'

const supabase = useSupabaseClient()
const store = useAccountStore()

interface AppointmentRow { starts_at: string; status: string }

const monthOffset = ref(0)
const loading = ref(true)
const rows = ref<AppointmentRow[]>([])
const prevMonthCount = ref(0)

function monthStart(offset: number) {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  d.setMonth(d.getMonth() + offset)
  return d
}
function addMonths(d: Date, n: number) {
  const c = new Date(d)
  c.setMonth(c.getMonth() + n)
  return c
}
function daysInMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

const rangeStart = computed(() => monthStart(monthOffset.value))
const rangeEnd = computed(() => addMonths(rangeStart.value, 1))
const monthLabel = computed(() => rangeStart.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))

async function load() {
  loading.value = true
  const prevStart = addMonths(rangeStart.value, -1)

  const [{ data: current }, { count: prevCount }] = await Promise.all([
    supabase
      .from('appointments')
      .select('starts_at, status')
      .gte('starts_at', rangeStart.value.toISOString())
      .lt('starts_at', rangeEnd.value.toISOString()),
    supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .gte('starts_at', prevStart.toISOString())
      .lt('starts_at', rangeStart.value.toISOString()),
  ])

  rows.value = current ?? []
  prevMonthCount.value = prevCount ?? 0
  loading.value = false
}
onMounted(load)
watch(monthOffset, load)

const totalCount = computed(() => rows.value.length)
const changePct = computed(() => {
  if (prevMonthCount.value === 0) return null
  return Math.round(((totalCount.value - prevMonthCount.value) / prevMonthCount.value) * 100)
})

const byDay = computed(() => {
  const n = daysInMonth(rangeStart.value)
  const scheduled = new Array(n).fill(0)
  const cancelledNoShow = new Array(n).fill(0)
  for (const r of rows.value) {
    const day = new Date(r.starts_at).getDate() - 1
    if (r.status === 'cancelled' || r.status === 'no_show') cancelledNoShow[day]++
    else scheduled[day]++
  }
  return { labels: Array.from({ length: n }, (_, i) => String(i + 1)), scheduled, cancelledNoShow }
})

const dayChartData = computed(() => ({
  labels: byDay.value.labels,
  datasets: [
    { label: 'Kept', data: byDay.value.scheduled, backgroundColor: '#4f46e5' },
    { label: 'Cancelled / No-show', data: byDay.value.cancelledNoShow, backgroundColor: '#fca5a5' },
  ],
}))
const dayChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } },
  plugins: { legend: { position: 'bottom' as const } },
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const byWeekday = computed(() => {
  const counts = new Array(7).fill(0)
  for (const r of rows.value) {
    const jsDay = new Date(r.starts_at).getDay() // 0=Sun
    const idx = jsDay === 0 ? 6 : jsDay - 1
    counts[idx]++
  }
  return counts
})
const weekdayChartData = computed(() => ({
  labels: WEEKDAY_LABELS,
  datasets: [{ label: 'Appointments', data: byWeekday.value, backgroundColor: '#4f46e5' }],
}))
const weekdayChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
  plugins: { legend: { display: false } },
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Upcoming Visits</h1>
      <NuxtLink to="/reports" class="text-sm text-gray-500 hover:text-gray-700">&larr; Reports</NuxtLink>
    </div>
    <p class="mt-1 text-sm text-gray-500">
      Appointment distribution across the month — use it to gauge ad spend, spot maintenance-retention gaps, and
      predict how the month will close.
    </p>

    <div class="mt-4 flex items-center gap-3">
      <button type="button" class="rounded-md border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50" @click="monthOffset--">&lsaquo;</button>
      <span class="text-sm font-medium text-gray-700">{{ monthLabel }}</span>
      <button type="button" class="rounded-md border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50" @click="monthOffset++">&rsaquo;</button>
      <button v-if="monthOffset !== 0" type="button" class="text-sm text-indigo-600 hover:text-indigo-500" @click="monthOffset = 0">Today</button>
    </div>

    <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div class="rounded-lg border border-gray-200 bg-white p-4">
        <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Total this month</p>
        <p class="mt-1 text-2xl font-semibold text-gray-900">{{ loading ? '—' : totalCount }}</p>
      </div>
      <div class="rounded-lg border border-gray-200 bg-white p-4">
        <p class="text-xs font-medium uppercase tracking-wide text-gray-500">vs. previous month</p>
        <p class="mt-1 text-2xl font-semibold" :class="changePct !== null && changePct < 0 ? 'text-red-600' : 'text-green-600'">
          {{ loading || changePct === null ? '—' : `${changePct > 0 ? '+' : ''}${changePct}%` }}
        </p>
      </div>
      <div class="rounded-lg border border-gray-200 bg-white p-4">
        <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Daily average</p>
        <p class="mt-1 text-2xl font-semibold text-gray-900">
          {{ loading ? '—' : (totalCount / daysInMonth(rangeStart)).toFixed(1) }}
        </p>
      </div>
    </div>

    <div class="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <h3 class="text-sm font-semibold text-gray-900">By day of month</h3>
      <div class="mt-3 h-72">
        <Bar v-if="!loading" :data="dayChartData" :options="dayChartOptions" />
      </div>
    </div>

    <div class="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <h3 class="text-sm font-semibold text-gray-900">By day of week</h3>
      <p class="text-xs text-gray-400">Which weekdays fill up fastest — useful for staffing and ad scheduling.</p>
      <div class="mt-3 h-64">
        <Bar v-if="!loading" :data="weekdayChartData" :options="weekdayChartOptions" />
      </div>
    </div>
  </div>
</template>

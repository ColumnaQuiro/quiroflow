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
    { label: 'Kept', data: byDay.value.scheduled, backgroundColor: '#4F46E5' },
    { label: 'Cancelled / No-show', data: byDay.value.cancelledNoShow, backgroundColor: '#F6C7CE' },
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
  datasets: [{ label: 'Appointments', data: byWeekday.value, backgroundColor: '#4F46E5' }],
}))
const weekdayChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
  plugins: { legend: { display: false } },
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Upcoming Visits" meta="Appointment distribution across the month">
      <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; Reports</NuxtLink>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <p class="text-[13px] text-ink-muted2">
        Use it to gauge ad spend, spot maintenance-retention gaps, and predict how the month will close.
      </p>

      <div class="mt-4 flex items-center gap-3">
        <button type="button" class="flex h-8 items-center rounded-ctl border border-line-control px-2.5 text-[13px] text-ink-600 hover:border-line-controlHover" @click="monthOffset--">&lsaquo;</button>
        <span class="text-[13px] font-medium text-ink-700">{{ monthLabel }}</span>
        <button type="button" class="flex h-8 items-center rounded-ctl border border-line-control px-2.5 text-[13px] text-ink-600 hover:border-line-controlHover" @click="monthOffset++">&rsaquo;</button>
        <button v-if="monthOffset !== 0" type="button" class="text-[13px] text-brand-text hover:text-brand-hover" @click="monthOffset = 0">Today</button>
      </div>

      <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div class="rounded-card border border-line bg-surface p-4 shadow-card">
          <p class="text-[11px] font-medium uppercase tracking-wide text-ink-muted2">Total this month</p>
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900">{{ loading ? '—' : totalCount }}</p>
        </div>
        <div class="rounded-card border border-line bg-surface p-4 shadow-card">
          <p class="text-[11px] font-medium uppercase tracking-wide text-ink-muted2">vs. previous month</p>
          <p class="mt-1.5 font-mono text-[23px] font-semibold" :class="changePct !== null && changePct < 0 ? 'text-danger-text' : 'text-success-text'">
            {{ loading || changePct === null ? '—' : `${changePct > 0 ? '+' : ''}${changePct}%` }}
          </p>
        </div>
        <div class="rounded-card border border-line bg-surface p-4 shadow-card">
          <p class="text-[11px] font-medium uppercase tracking-wide text-ink-muted2">Daily average</p>
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900">
            {{ loading ? '—' : (totalCount / daysInMonth(rangeStart)).toFixed(1) }}
          </p>
        </div>
      </div>

      <div class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
        <h3 class="text-[13.5px] font-semibold text-ink-800">By day of month</h3>
        <div class="mt-3 h-72">
          <Bar v-if="!loading" :data="dayChartData" :options="dayChartOptions" />
        </div>
      </div>

      <div class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
        <h3 class="text-[13.5px] font-semibold text-ink-800">By day of week</h3>
        <p class="text-[12px] text-ink-faint2">Which weekdays fill up fastest — useful for staffing and ad scheduling.</p>
        <div class="mt-3 h-64">
          <Bar v-if="!loading" :data="weekdayChartData" :options="weekdayChartOptions" />
        </div>
      </div>
    </div>
  </div>
</template>

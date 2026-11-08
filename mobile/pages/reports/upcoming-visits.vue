<script setup lang="ts">
// Próximas visitas, on the phone: the web's pages/reports/upcoming-visits.vue
// with the same two queries (the month's appointments, and a head count of
// the month before) and the same day and weekday buckets, so the figures
// match the web. Reshaped for a phone: the month stepper sits in the filter
// row, the three tiles go two to a row (three on an iPad), and both bar
// charts keep their data at h-56. Like the web it has no practitioner picker:
// reports_own_only goes straight onto both queries. Left out: the PDF button
// (no PDF on the app yet).
import { Bar } from 'vue-chartjs'
import '../../../utils/chartSetup'

definePageMeta({ layout: 'practitioner' })

const supabase = useSupabaseClient()
const t = useT()
const { canOpen, context, reportsPractitionerId } = useReportAccess()
const locale = computed(() => t('en-GB', 'es-ES'))

interface AppointmentRow { starts_at: string; status: string }

const monthOffset = ref(0)
const loading = ref(true)
const failed = ref(false)
const rows = ref<AppointmentRow[]>([])
const prevMonthCount = ref(0)
const allowed = computed(() => !!context.value && canOpen('/reports/upcoming-visits'))

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
const monthLabel = computed(() => rangeStart.value.toLocaleDateString(locale.value, { month: 'long', year: 'numeric' }))

// Stepping through months quickly starts a run per tap; only the latest
// may write, or a slow earlier answer shows the wrong month's figures.
let run = 0
async function load() {
  if (!allowed.value) return
  const mine = ++run
  loading.value = true
  failed.value = false
  const prevStart = addMonths(rangeStart.value, -1)

  let current_ = supabase
    .from('appointments')
    .select('starts_at, status')
    .gte('starts_at', rangeStart.value.toISOString())
    .lt('starts_at', rangeEnd.value.toISOString())
  let previous = supabase
    .from('appointments')
    .select('*', { count: 'exact', head: true })
    .gte('starts_at', prevStart.toISOString())
    .lt('starts_at', rangeStart.value.toISOString())
  // reports_own_only: this report has no practitioner picker to pin, so the
  // restriction goes straight onto both counts.
  if (reportsPractitionerId.value) {
    current_ = current_.eq('practitioner_id', reportsPractitionerId.value)
    previous = previous.eq('practitioner_id', reportsPractitionerId.value)
  }
  const [{ data: current, error: currentError }, { count: prevCount, error: prevError }] = await Promise.all([current_, previous])
  if (mine !== run) return

  // A refused read is a failure to say so, not an empty month.
  if (currentError || prevError) {
    failed.value = true
    loading.value = false
    return
  }
  rows.value = (current ?? []) as AppointmentRow[]
  prevMonthCount.value = prevCount ?? 0
  loading.value = false
}
// Only once the role is known to include it.
watch(allowed, (ok) => { if (ok) load() }, { immediate: true })
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
    { label: t('Kept', 'Mantenidas'), data: byDay.value.scheduled, backgroundColor: '#4F46E5' },
    { label: t('Cancelled / No-show', 'Canceladas / No presentado'), data: byDay.value.cancelledNoShow, backgroundColor: '#F6C7CE' },
  ],
}))
// Thirty-one bars on a phone: Chart.js skips day labels it cannot fit
// rather than tilting them, so the axis stays readable.
const dayChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  scales: { x: { stacked: true, ticks: { autoSkip: true, maxRotation: 0 } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } },
  plugins: { legend: { position: 'bottom' as const, labels: { boxWidth: 12, font: { size: 11 } } } },
}

const WEEKDAY_LABELS = computed(() => [
  t('Mon', 'lun'),
  t('Tue', 'mar'),
  t('Wed', 'mié'),
  t('Thu', 'jue'),
  t('Fri', 'vie'),
  t('Sat', 'sáb'),
  t('Sun', 'dom'),
])
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
  labels: WEEKDAY_LABELS.value,
  datasets: [{ label: t('Appointments', 'Citas'), data: byWeekday.value, backgroundColor: '#4F46E5' }],
}))
const weekdayChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
  plugins: { legend: { display: false } },
}
</script>

<template>
  <ReportScreen
    :title="t('Upcoming Visits', 'Próximas visitas')"
    path="/reports/upcoming-visits"
    :description="t('Use it to gauge ad spend, spot maintenance-retention gaps, and predict how the month will close.', 'Úsalo para calibrar el gasto en publicidad, detectar huecos de retención de mantenimiento y predecir cómo cerrará el mes.')"
  >
    <template #filters>
      <button type="button" class="flex h-9 w-11 shrink-0 items-center justify-center rounded-full border border-line-control bg-surface text-ink-700" :aria-label="t('Previous month', 'Mes anterior')" data-cy="report-upcoming-visits-prev" @click="monthOffset--">
        <AppChevron dir="left" :size="16" />
      </button>
      <span class="shrink-0 whitespace-nowrap px-1 text-[13px] font-semibold capitalize text-ink-700" data-cy="report-upcoming-visits-month">{{ monthLabel }}</span>
      <button type="button" class="flex h-9 w-11 shrink-0 items-center justify-center rounded-full border border-line-control bg-surface text-ink-700" :aria-label="t('Next month', 'Mes siguiente')" data-cy="report-upcoming-visits-next" @click="monthOffset++">
        <AppChevron dir="right" :size="16" />
      </button>
      <button v-if="monthOffset !== 0" type="button" class="flex h-9 shrink-0 items-center rounded-full px-3 text-[13px] font-semibold text-brand-text" data-cy="report-upcoming-visits-today" @click="monthOffset = 0">{{ t('Today', 'Hoy') }}</button>
    </template>

    <p v-if="failed" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text" role="alert" data-cy="report-upcoming-visits-error">
      {{ t('Could not load the report.', 'No se ha podido cargar el informe.') }}
      <button type="button" class="ml-1 font-semibold underline" @click="load">{{ t('Try again', 'Reintentar') }}</button>
    </p>

    <div class="grid grid-cols-2 gap-3 md:grid-cols-3" data-cy="report-upcoming-visits-tiles">
      <ReportsStat :label="t('Total this month', 'Total este mes')" :loading="loading">
        <p class="font-mono text-[23px] font-semibold text-ink-900" data-cy="report-upcoming-visits-total">{{ totalCount }}</p>
      </ReportsStat>
      <ReportsStat :label="t('vs. previous month', 'vs. mes anterior')" :loading="loading">
        <p class="font-mono text-[23px] font-semibold" :class="changePct !== null && changePct < 0 ? 'text-danger-text' : 'text-success-text'" data-cy="report-upcoming-visits-change">
          {{ changePct === null ? '—' : `${changePct > 0 ? '+' : ''}${changePct}%` }}
        </p>
      </ReportsStat>
      <ReportsStat :label="t('Daily average', 'Media diaria')" :loading="loading">
        <p class="font-mono text-[23px] font-semibold text-ink-900" data-cy="report-upcoming-visits-average">{{ (totalCount / daysInMonth(rangeStart)).toFixed(1) }}</p>
      </ReportsStat>
    </div>

    <ReportsModule :title="t('By day of month', 'Por día del mes')" :loading="loading" chart-height="h-56">
      <div class="mt-3 h-56" data-cy="report-upcoming-visits-day-chart"><Bar :data="dayChartData" :options="dayChartOptions" /></div>
    </ReportsModule>

    <ReportsModule
      :title="t('By day of week', 'Por día de la semana')"
      :description="t('Which weekdays fill up fastest — useful for staffing and ad scheduling.', 'Qué días de la semana se llenan más rápido — útil para la plantilla y la publicidad.')"
      :loading="loading"
      chart-height="h-56"
    >
      <div class="mt-3 h-56" data-cy="report-upcoming-visits-weekday-chart"><Bar :data="weekdayChartData" :options="weekdayChartOptions" /></div>
    </ReportsModule>
  </ReportScreen>
</template>

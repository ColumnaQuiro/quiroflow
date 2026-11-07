<script setup lang="ts">
// Distribución de citas, on the phone: the web's
// pages/reports/appointment-distribution.vue with the same query (every
// non-deleted appointment starting in the range, narrowed by practitioner and
// clinic) and the same shift and hour buckets, so the figures match the web.
// Reshaped for a phone: the three shift tiles stack one per row (three across
// on an iPad), with the outcome split that the web only shows in the chart
// written under each figure, and both bar charts keep their data at h-56.
// Left out: the PDF button (no PDF on the app yet).
import { Bar } from 'vue-chartjs'
import '../../../utils/chartSetup'
import { computePresetRange, rangeBounds, type DateRange } from '../../../composables/useDateRangePresets'
import { fetchAllRows } from '../../../composables/useFetchAllRows'
import { useReportFilterOptions } from '../../../composables/useReportFilterOptions'

definePageMeta({ layout: 'practitioner' })

interface AppointmentRow { starts_at: string; status: string }

const supabase = useSupabaseClient()
const { practitioners, clinics, load: loadFilterOptions } = useReportFilterOptions()
const t = useT()
const { canOpen, context, reportsPractitionerId } = useReportAccess()

const range = ref<DateRange>(computePresetRange({ months: 1 }))
// reports_own_only: pinned to the viewer, with the picker hidden
// (useReportAccess stands in for the web's useOwnScope).
const practitionerFilter = ref(reportsPractitionerId.value ?? '')
const clinicFilter = ref('')
const loading = ref(true)
const failed = ref(false)
const rows = ref<AppointmentRow[]>([])
const allowed = computed(() => !!context.value && canOpen('/reports/appointment-distribution'))

// A range or filter picked while this is in flight starts another run; only
// the latest may write, or a slow earlier answer lands over the newer one.
let run = 0
async function load() {
  if (!allowed.value) return
  const mine = ++run
  loading.value = true
  failed.value = false
  const { from, to } = rangeBounds(range.value)
  try {
    const result = await fetchAllRows<AppointmentRow>((f, tt) => {
      // Deleted appointments are gone everywhere else in the app -- the
      // calendar, Statistics, report pages -- and are not counted here either.
      let query = supabase.from('appointments').select('starts_at, status').is('deleted_at', null).gte('starts_at', from.toISOString()).lte('starts_at', to.toISOString())
      if (practitionerFilter.value) query = query.eq('practitioner_id', practitionerFilter.value)
      if (clinicFilter.value) query = query.eq('clinic_id', clinicFilter.value)
      return query.range(f, tt)
    })
    if (mine !== run) return
    rows.value = result
  } catch {
    if (mine !== run) return
    failed.value = true
  }
  loading.value = false
}

// Only once the role is known to include it: a refused read would come back
// empty and read as a quiet month.
watch(
  allowed,
  (ok) => {
    if (!ok) return
    loadFilterOptions()
    // Pinning the practitioner starts the load through the filter watch
    // below; loading here as well would only send the query twice.
    const locked = reportsPractitionerId.value
    if (locked && practitionerFilter.value !== locked) practitionerFilter.value = locked
    else load()
  },
  { immediate: true },
)
watch([range, practitionerFilter, clinicFilter], load)

const SHIFTS = computed(() => [
  { key: 'morning', label: t('Morning (before 12pm)', 'Mañana (antes de las 12h)'), test: (h: number) => h < 12 },
  { key: 'afternoon', label: t('Afternoon (12–4pm)', 'Tarde (12–16h)'), test: (h: number) => h >= 12 && h < 16 },
  { key: 'evening', label: t('Evening (4pm+)', 'Noche (a partir de las 16h)'), test: (h: number) => h >= 16 },
])

const shiftStats = computed(() => {
  return SHIFTS.value.map((shift) => {
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
  labels: SHIFTS.value.map((s) => s.label),
  datasets: [
    { label: t('Completed', 'Completadas'), data: shiftStats.value.map((s) => s.completed), backgroundColor: '#4f46e5' },
    { label: t('No-show', 'No presentado'), data: shiftStats.value.map((s) => s.noShow), backgroundColor: '#ef4444' },
    { label: t('Cancelled', 'Canceladas'), data: shiftStats.value.map((s) => s.cancelled), backgroundColor: '#fca5a5' },
    { label: t('Booked (upcoming)', 'Reservadas (próximas)'), data: shiftStats.value.map((s) => s.booked), backgroundColor: '#c7d2fe' },
  ],
}))
// The shift names are long for a phone's x axis, so the axis shows only the
// first word ("Mañana", "Tarde", "Noche"); the tiles above carry the hours.
const shiftChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: { stacked: true, ticks: { callback: (_v: number | string, i: number) => SHIFTS.value[i]?.label.split(' ')[0] ?? '' } },
    y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
  },
  plugins: { legend: { position: 'bottom' as const, labels: { boxWidth: 12, font: { size: 11 } } } },
}))

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
  datasets: [{ label: t('Appointments', 'Citas'), data: byHour.value, backgroundColor: '#4f46e5' }],
}))
const hourChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
  plugins: { legend: { display: false } },
}
</script>

<template>
  <ReportScreen :title="t('Appointment Distribution', 'Distribución de citas')" path="/reports/appointment-distribution" :description="t('Volume and show-up rate by shift and time of day', 'Volumen y tasa de asistencia por turno y hora del día')">
    <template #filters>
      <ReportRangePicker v-model="range" />
      <ReportPeopleFilters v-model:practitioner-id="practitionerFilter" v-model:clinic-id="clinicFilter" :locked-to="reportsPractitionerId" :practitioners="practitioners" :clinics="clinics" />
    </template>

    <p v-if="failed" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text" role="alert" data-cy="report-appointment-distribution-error">
      {{ t('Could not load the report.', 'No se ha podido cargar el informe.') }}
      <button type="button" class="ml-1 font-semibold underline" @click="load">{{ t('Try again', 'Reintentar') }}</button>
    </p>

    <div class="grid grid-cols-1 gap-3 md:grid-cols-3" data-cy="report-appointment-distribution-shifts">
      <ReportsStat v-for="s in shiftStats" :key="s.key" :label="s.label" :loading="loading">
        <p class="font-mono text-[23px] font-semibold text-ink-900" :data-cy="`report-appointment-distribution-${s.key}`">{{ s.total }}</p>
        <p class="text-[12.5px] text-ink-faint2">
          {{ s.showRate === null ? t('No completed history yet', 'Sin historial de citas completadas') : t(`${s.showRate}% show-up rate`, `${s.showRate}% de tasa de asistencia`) }}
        </p>
        <p v-if="s.total > 0" class="mt-1 text-[11.5px] text-ink-faint2">
          {{ t(
            `${s.completed} completed · ${s.noShow} no-show · ${s.cancelled} cancelled · ${s.booked} booked`,
            `${s.completed} completadas · ${s.noShow} no presentado · ${s.cancelled} canceladas · ${s.booked} reservadas`,
          ) }}
        </p>
      </ReportsStat>
    </div>

    <ReportsModule :title="t('By shift, by outcome', 'Por turno, por resultado')" :loading="loading" chart-height="h-56">
      <div class="mt-3 h-56" data-cy="report-appointment-distribution-shift-chart"><Bar :data="shiftChartData" :options="shiftChartOptions" /></div>
    </ReportsModule>

    <ReportsModule :title="t('By hour of day', 'Por hora del día')" :loading="loading" chart-height="h-56">
      <div class="mt-3 h-56" data-cy="report-appointment-distribution-hour-chart"><Bar :data="hourChartData" :options="hourChartOptions" /></div>
    </ReportsModule>
  </ReportScreen>
</template>

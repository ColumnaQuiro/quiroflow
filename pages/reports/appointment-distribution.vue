<script setup lang="ts">
import { Bar } from 'vue-chartjs'
import { computePresetRange, rangeBounds } from '~/composables/useDateRangePresets'
import { fetchAllRows } from '~/composables/useFetchAllRows'

const supabase = useSupabaseClient()
const { practitioners, clinics, load: loadFilterOptions } = useReportFilterOptions()
const t = useT()

interface AppointmentRow { starts_at: string; status: string }

const range = ref(computePresetRange({ months: 1 }))
const practitionerFilter = ref('')
const clinicFilter = ref('')
const loading = ref(true)
const rows = ref<AppointmentRow[]>([])

async function load() {
  loading.value = true
  const { from, to } = rangeBounds(range.value)
  rows.value = await fetchAllRows<AppointmentRow>((f, t) => {
    let query = supabase.from('appointments').select('starts_at, status').gte('starts_at', from.toISOString()).lte('starts_at', to.toISOString())
    if (practitionerFilter.value) query = query.eq('practitioner_id', practitionerFilter.value)
    if (clinicFilter.value) query = query.eq('clinic_id', clinicFilter.value)
    return query.range(f, t)
  })
  loading.value = false
}
onMounted(() => {
  load()
  loadFilterOptions()
})
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
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Appointment Distribution', 'Distribución de citas')" :meta="t('Volume and show-up rate by shift and time of day', 'Volumen y tasa de asistencia por turno y hora del día')">
      <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Reports', 'Informes') }}</NuxtLink>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <div class="flex flex-wrap items-center gap-2">
        <ReportsDateRangeSelect v-model="range" />
        <ReportsPractitionerClinicFilters v-model:practitioner-id="practitionerFilter" v-model:clinic-id="clinicFilter" :practitioners="practitioners" :clinics="clinics" />
      </div>

      <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div v-for="s in shiftStats" :key="s.key" class="rounded-card border border-line bg-surface p-4 shadow-card">
          <p class="text-[11px] font-medium uppercase tracking-wide text-ink-muted2">{{ s.label }}</p>
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900">{{ loading ? '—' : s.total }}</p>
          <p class="text-[12px] text-ink-faint2">
            {{ loading ? '' : s.showRate === null ? t('No completed history yet', 'Sin historial de citas completadas') : t(`${s.showRate}% show-up rate`, `${s.showRate}% de tasa de asistencia`) }}
          </p>
        </div>
      </div>

      <div class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
        <h3 class="text-[13.5px] font-semibold text-ink-800">{{ t('By shift, by outcome', 'Por turno, por resultado') }}</h3>
        <div class="mt-3 h-72">
          <Bar v-if="!loading" :data="shiftChartData" :options="shiftChartOptions" />
        </div>
      </div>

      <div class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
        <h3 class="text-[13.5px] font-semibold text-ink-800">{{ t('By hour of day', 'Por hora del día') }}</h3>
        <div class="mt-3 h-64">
          <Bar v-if="!loading" :data="hourChartData" :options="hourChartOptions" />
        </div>
      </div>
    </div>
  </div>
</template>

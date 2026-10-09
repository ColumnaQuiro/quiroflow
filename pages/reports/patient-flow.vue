<script setup lang="ts">
import { computePresetRange, rangeBounds } from '~/composables/useDateRangePresets'
import { fetchAllRows } from '~/composables/useFetchAllRows'
import { FLOW_BUCKETS, flowReport, formatFlowMinutes, type FlowStage, type FlowVisit } from '~/utils/patientFlowStats'

// Patient Flow: how long people wait, how late the clinic runs and how long
// a session lasts, from the flow stamps the front desk presses on the
// calendar (Arrived -> Into session -> Checkout). Only visits that were
// checked in count -- a clinic that does not use the flow sees "not used
// yet" rather than zeros. The arithmetic, and how a forgotten stamp is kept
// out of the averages, is utils/patientFlowStats.ts.
const supabase = useSupabaseClient()
const { practitioners, clinics, load: loadFilterOptions } = useReportFilterOptions()
const t = useT()

const range = ref(computePresetRange({ months: 1 }))
const { reportsPractitionerId } = useOwnScope()
const practitionerFilter = ref(reportsPractitionerId.value ?? '')
const clinicFilter = ref('')
const loading = ref(true)
const rows = ref<FlowVisit[]>([])
const completedTotal = ref(0)

let run = 0
async function load() {
  const mine = ++run
  loading.value = true
  const { from, to } = rangeBounds(range.value)
  const [result, completed] = await Promise.all([
    fetchAllRows<FlowVisit>((f, tt) => {
      let q = supabase
        .from('appointments')
        .select('starts_at, practitioner_id, checked_in_at, flow_with_practitioner_at, flow_checkout_at')
        .is('deleted_at', null)
        .neq('status', 'cancelled')
        .not('checked_in_at', 'is', null)
        .gte('starts_at', from.toISOString())
        .lte('starts_at', to.toISOString())
      if (practitionerFilter.value) q = q.eq('practitioner_id', practitionerFilter.value)
      if (clinicFilter.value) q = q.eq('clinic_id', clinicFilter.value)
      return q.range(f, tt)
    }),
    // The denominator for "how much of the clinic uses the flow".
    (() => {
      let q = supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null)
        .eq('status', 'completed')
        .gte('starts_at', from.toISOString())
        .lte('starts_at', to.toISOString())
      if (practitionerFilter.value) q = q.eq('practitioner_id', practitionerFilter.value)
      if (clinicFilter.value) q = q.eq('clinic_id', clinicFilter.value)
      return q
    })(),
  ])
  if (mine !== run) return
  rows.value = result
  completedTotal.value = completed.count ?? 0
  loading.value = false
}
onMounted(() => {
  load()
  loadFilterOptions()
})
watch([range, practitionerFilter, clinicFilter], load)

const report = computed(() => flowReport(rows.value))
const coverage = computed(() => (completedTotal.value ? Math.min(1, report.value.tracked / completedTotal.value) : null))

const STAGES = computed<{ key: FlowStage; title: string; hint: string }[]>(() => [
  { key: 'wait', title: t('Waiting', 'Espera'), hint: t('Checked in → with the practitioner', 'Llegada → con el profesional') },
  { key: 'delay', title: t('Running late', 'Retraso'), hint: t('Booked time → with the practitioner', 'Hora de la cita → con el profesional') },
  { key: 'session', title: t('In session', 'En consulta'), hint: t('With the practitioner → checkout', 'Con el profesional → salida') },
])
const stage = ref<FlowStage>('wait')

// Green / amber / red the way a front desk would read a wait.
function tone(m: number | null) {
  if (m === null) return 'neutral'
  return m < 10 ? 'good' : m < 20 ? 'fair' : 'poor'
}
const TONE_CLASS: Record<string, string> = {
  good: 'border-success-border bg-success-bg',
  fair: 'border-warning-border bg-warning-bg',
  poor: 'border-danger-border bg-danger-bg',
  neutral: 'border-line bg-surface',
}

const practitionerName = (id: string | null) => practitioners.value.find((p) => p.id === id)?.name ?? t('No practitioner', 'Sin profesional')
const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n * 100)}%`)
const arrivalLabel = computed(() => {
  const m = report.value.stages.arrival.median
  if (m === null) return '–'
  const r = Math.round(m)
  return r === 0 ? t('on time', 'puntuales') : r < 0 ? t(`${-r} min early`, `${-r} min antes`) : t(`${r} min late`, `${r} min tarde`)
})

const pdfRoot = ref<HTMLElement | null>(null)
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Patient Flow', 'Flujo de pacientes')" :meta="t('Waiting, delays and session times', 'Esperas, retrasos y tiempos de consulta')">
      <div class="flex items-center gap-3">
        <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Reports', 'Informes') }}</NuxtLink>
        <ReportsPdfButton :target="pdfRoot" :title="t('Patient Flow', 'Flujo de pacientes')" :range="range" :practitioner-id="practitionerFilter || null" :clinic-id="clinicFilter || null" />
      </div>
    </PageHeader>

    <div ref="pdfRoot" class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-[18px] sm:px-6" data-cy="patient-flow" :data-ready="loading ? undefined : 'true'">
      <div class="flex flex-wrap items-center gap-2">
        <ReportsDateRangeSelect v-model="range" />
        <ReportsPractitionerClinicFilters v-model:practitioner-id="practitionerFilter" :locked-to="reportsPractitionerId" v-model:clinic-id="clinicFilter" :practitioners="practitioners" :clinics="clinics" />
      </div>

      <p v-if="!loading && report.tracked === 0" class="mt-4 rounded-card border border-line bg-surface px-4 py-3 text-[13.5px] text-ink-muted" data-cy="patient-flow-empty">
        {{
          t(
            'No checked-in visits in this period. The report fills in as the front desk marks patients Arrived, Into session and Checkout on the calendar.',
            'No hay visitas con llegada marcada en este periodo. El informe se llena cuando recepción marca Llegada, Pasa a consulta y Salida en el calendario.',
          )
        }}
      </p>

      <div class="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <ReportsStat :label="t('Visits tracked', 'Visitas registradas')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="flow-tracked">{{ report.tracked }}</p>
          <p class="text-[12px] text-ink-faint2">{{ coverage === null ? '' : t(`${pct(coverage)} of completed visits`, `${pct(coverage)} de las visitas completadas`) }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Average wait', 'Espera media')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="flow-wait">{{ formatFlowMinutes(report.stages.wait.average) }}</p>
          <p class="text-[12px] text-ink-faint2">{{ t(`median ${formatFlowMinutes(report.stages.wait.median)}`, `mediana ${formatFlowMinutes(report.stages.wait.median)}`) }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Seen on time', 'Atendidos a su hora')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="flow-on-time">{{ pct(report.onTime) }}</p>
          <p class="text-[12px] text-ink-faint2">{{ t('within 5 min of the booked time', 'menos de 5 min tras la hora de la cita') }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Average session', 'Consulta media')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="flow-session">{{ formatFlowMinutes(report.stages.session.average) }}</p>
          <p class="text-[12px] text-ink-faint2">{{ t(`median ${formatFlowMinutes(report.stages.session.median)}`, `mediana ${formatFlowMinutes(report.stages.session.median)}`) }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Patients arrive', 'Los pacientes llegan')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="flow-arrival">{{ arrivalLabel }}</p>
          <p class="text-[12px] text-ink-faint2">{{ t('median, against the booked time', 'mediana, respecto a la hora de la cita') }}</p>
        </ReportsStat>
      </div>

      <div class="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <ReportsModule :title="t('The visit, stage by stage', 'La visita, etapa por etapa')" :description="t('Average minutes in each stage. Green under 10, amber under 20, red beyond.', 'Minutos medios en cada etapa. Verde por debajo de 10, ámbar por debajo de 20, rojo por encima.')" :loading="loading" chart-height="h-40">
          <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <button
              v-for="s in STAGES"
              :key="s.key"
              type="button"
              class="rounded-card border px-3 py-4 text-left transition"
              :class="[TONE_CLASS[s.key === 'session' ? 'neutral' : tone(report.stages[s.key].average)], stage === s.key ? 'ring-2 ring-brand/50' : '']"
              :aria-pressed="stage === s.key"
              :data-cy="`flow-stage-${s.key}`"
              @click="stage = s.key"
            >
              <p class="text-[12.5px] font-semibold text-ink-800">{{ s.title }}</p>
              <p class="mt-1 font-mono text-[20px] font-semibold text-ink-900">{{ formatFlowMinutes(report.stages[s.key].average) }}</p>
              <p class="mt-0.5 text-[11.5px] text-ink-muted">{{ s.hint }}</p>
              <p class="mt-1 text-[11px] text-ink-faint2">{{ t(`${report.stages[s.key].count} visits`, `${report.stages[s.key].count} visitas`) }}</p>
            </button>
          </div>
        </ReportsModule>

        <ReportsModule :title="t('How long, how often', 'Cuánto y con qué frecuencia')" :description="STAGES.find((s) => s.key === stage)?.title" :loading="loading" skeleton="list" :rows="5">
          <div class="mt-3 space-y-2.5" data-cy="flow-distribution">
            <div v-for="(b, i) in FLOW_BUCKETS" :key="b.key" class="flex items-center gap-3 text-[12.5px]">
              <span class="w-[4.5rem] shrink-0 whitespace-nowrap text-ink-muted">{{ b.key }} min</span>
              <div class="h-2 flex-1 overflow-hidden rounded-pill bg-chip-bg"><div class="h-full rounded-pill bg-brand" :style="{ width: `${Math.round(report.stages[stage].buckets[i] * 100)}%` }" /></div>
              <span class="w-10 shrink-0 text-right font-mono text-ink-700">{{ pct(report.stages[stage].count ? report.stages[stage].buckets[i] : null) }}</span>
            </div>
          </div>
        </ReportsModule>
      </div>

      <ReportsModule v-if="!reportsPractitionerId" class="mt-4" :title="t('By practitioner', 'Por profesional')" :loading="loading" skeleton="list">
        <div class="mt-2 overflow-x-auto">
          <table class="w-full min-w-[520px] text-[13px]" data-cy="flow-by-practitioner">
            <thead class="text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted2">
              <tr>
                <th class="py-2 pr-3">{{ t('Practitioner', 'Profesional') }}</th>
                <th class="py-2 pr-3 text-right">{{ t('Visits', 'Visitas') }}</th>
                <th class="py-2 pr-3 text-right">{{ t('Wait', 'Espera') }}</th>
                <th class="py-2 pr-3 text-right">{{ t('Late', 'Retraso') }}</th>
                <th class="py-2 text-right">{{ t('Session', 'Consulta') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line-divider">
              <tr v-if="!report.byPractitioner.length"><td colspan="5" class="py-4 text-center text-ink-faint">{{ t('Nothing tracked yet.', 'Aún no hay nada registrado.') }}</td></tr>
              <tr v-for="p in report.byPractitioner" :key="p.practitionerId ?? 'none'">
                <td class="py-2 pr-3 text-ink-900">{{ practitionerName(p.practitionerId) }}</td>
                <td class="py-2 pr-3 text-right font-mono text-ink-700">{{ p.visits }}</td>
                <td class="py-2 pr-3 text-right font-mono text-ink-700">{{ formatFlowMinutes(p.wait) }}</td>
                <td class="py-2 pr-3 text-right font-mono text-ink-700">{{ formatFlowMinutes(p.delay) }}</td>
                <td class="py-2 text-right font-mono text-ink-700">{{ formatFlowMinutes(p.session) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </ReportsModule>
    </div>
  </div>
</template>

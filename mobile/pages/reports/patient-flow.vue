<script setup lang="ts">
// Flujo de pacientes, on the phone: the web's pages/reports/patient-flow.vue,
// with the same reads and the same arithmetic (utils/patientFlowStats.ts),
// so a figure here is the figure there. Reshaped for a phone: the three
// stage cards stack as full-width rows (still tapping one picks the stage
// the distribution below shows), the fifth KPI tile spans both columns, and
// the by-practitioner table is one row per practitioner with wait, delay
// and session side by side beneath the name. Left out: the PDF button (no
// PDF on the app yet). Unlike the web, a failed read shows "No se ha podido
// cargar el informe" with a retry instead of a skeleton that never clears.
import { computePresetRange, rangeBounds } from '../../../composables/useDateRangePresets'
import { fetchAllRows } from '../../../composables/useFetchAllRows'
import { FLOW_BUCKETS, flowReport, formatFlowMinutes, type FlowStage, type FlowVisit } from '../../../utils/patientFlowStats'

definePageMeta({ layout: 'practitioner' })

// Patient Flow: how long people wait, how late the clinic runs and how long
// a session lasts, from the flow stamps the front desk presses on the
// calendar (Arrived -> Into session -> Checkout). Only visits that were
// checked in count -- a clinic that does not use the flow sees "not used
// yet" rather than zeros. The arithmetic, and how a forgotten stamp is kept
// out of the averages, is utils/patientFlowStats.ts.
const PATH = '/reports/patient-flow'
const supabase = useSupabaseClient()
const t = useT()
const { canOpen, context, reportsPractitionerId } = useReportAccess()
const { practitioners, clinics, load: loadFilterOptions } = useReportFilterOptions()

const range = ref(computePresetRange({ months: 1 }))
const practitionerFilter = ref('')
const clinicFilter = ref('')
const loading = ref(true)
const failed = ref(false)
const rows = ref<FlowVisit[]>([])
const completedTotal = ref(0)

let run = 0
async function load() {
  const mine = ++run
  loading.value = true
  failed.value = false
  try {
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
    if (completed.error) throw completed.error
    if (mine !== run) return
    rows.value = result
    completedTotal.value = completed.count ?? 0
  } catch (e) {
    console.error('[patient flow report]', e)
    if (mine === run) failed.value = true
  } finally {
    if (mine === run) loading.value = false
  }
}
// Only once the role is known to include it: a refused read would come back
// empty and read as "the flow is not used yet". Someone who sees only their
// own figures starts on themselves, so the first read is already theirs.
const ready = computed(() => !!context.value && canOpen(PATH))
watch(
  ready,
  (ok) => {
    if (!ok) return
    if (reportsPractitionerId.value) practitionerFilter.value = reportsPractitionerId.value
    load()
    loadFilterOptions()
  },
  { immediate: true },
)
watch([range, practitionerFilter, clinicFilter], () => { if (ready.value) load() })

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
const figureLabel = 'text-[11px] font-medium uppercase tracking-wide text-ink-muted'
const figureValue = 'font-mono text-[13.5px] font-semibold tabular-nums text-ink-900'
</script>

<template>
  <ReportScreen :title="t('Patient Flow', 'Flujo de pacientes')" :path="PATH" :description="t('Waiting, delays and session times', 'Esperas, retrasos y tiempos de consulta')">
    <template #filters>
      <ReportRangePicker v-model="range" />
      <ReportPeopleFilters v-model:practitioner-id="practitionerFilter" v-model:clinic-id="clinicFilter" :locked-to="reportsPractitionerId" :practitioners="practitioners" :clinics="clinics" />
    </template>

    <div class="flex flex-col gap-3" data-cy="patient-flow" :data-ready="loading ? undefined : 'true'">
      <p v-if="failed" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text" role="alert" data-cy="patient-flow-failed">
        {{ t('Could not load the report.', 'No se ha podido cargar el informe.') }}
        <button type="button" class="ml-1 min-h-[44px] font-semibold underline" @click="load">{{ t('Try again', 'Reintentar') }}</button>
      </p>

      <p v-else-if="!loading && report.tracked === 0" class="rounded-card border border-line bg-surface px-3.5 py-3 text-[13.5px] text-ink-muted" data-cy="patient-flow-empty">
        {{
          t(
            'No checked-in visits in this period. The report fills in as the front desk marks patients Arrived, Into session and Checkout on the calendar.',
            'No hay visitas con llegada marcada en este periodo. El informe se llena cuando recepción marca Llegada, Pasa a consulta y Salida en el calendario.',
          )
        }}
      </p>

      <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
        <ReportsStat :label="t('Visits tracked', 'Visitas registradas')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="flow-tracked">{{ report.tracked }}</p>
          <p class="text-[12px] text-ink-muted">{{ coverage === null ? '' : t(`${pct(coverage)} of completed visits`, `${pct(coverage)} de las visitas completadas`) }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Average wait', 'Espera media')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="flow-wait">{{ formatFlowMinutes(report.stages.wait.average) }}</p>
          <p class="text-[12px] text-ink-muted">{{ t(`median ${formatFlowMinutes(report.stages.wait.median)}`, `mediana ${formatFlowMinutes(report.stages.wait.median)}`) }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Seen on time', 'Atendidos a su hora')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="flow-on-time">{{ pct(report.onTime) }}</p>
          <p class="text-[12px] text-ink-muted">{{ t('within 5 min of the booked time', 'menos de 5 min tras la hora de la cita') }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Average session', 'Consulta media')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="flow-session">{{ formatFlowMinutes(report.stages.session.average) }}</p>
          <p class="text-[12px] text-ink-muted">{{ t(`median ${formatFlowMinutes(report.stages.session.median)}`, `mediana ${formatFlowMinutes(report.stages.session.median)}`) }}</p>
        </ReportsStat>
        <ReportsStat class="col-span-2" :label="t('Patients arrive', 'Los pacientes llegan')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="flow-arrival">{{ arrivalLabel }}</p>
          <p class="text-[12px] text-ink-muted">{{ t('median, against the booked time', 'mediana, respecto a la hora de la cita') }}</p>
        </ReportsStat>
      </div>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ReportsModule :title="t('The visit, stage by stage', 'La visita, etapa por etapa')" :description="t('Average minutes in each stage. Green under 10, amber under 20, red beyond. Tap one to see how it spreads.', 'Minutos medios en cada etapa. Verde por debajo de 10, ámbar por debajo de 20, rojo por encima. Toca una para ver cómo se reparte.')" :loading="loading" skeleton="list" :rows="3">
          <div class="mt-3 flex flex-col gap-2">
            <button
              v-for="s in STAGES"
              :key="s.key"
              type="button"
              class="flex min-h-[56px] items-center gap-3 rounded-card border px-3 py-2.5 text-left"
              :class="[TONE_CLASS[s.key === 'session' ? 'neutral' : tone(report.stages[s.key].average)], stage === s.key ? 'ring-2 ring-brand/50' : '']"
              :aria-pressed="stage === s.key"
              :data-cy="`flow-stage-${s.key}`"
              @click="stage = s.key"
            >
              <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="text-[14px] font-semibold text-ink-800">{{ s.title }}</span>
                <span class="text-[12px] leading-snug text-ink-muted">{{ s.hint }}</span>
              </span>
              <span class="flex shrink-0 flex-col items-end">
                <span class="font-mono text-[18px] font-semibold text-ink-900">{{ formatFlowMinutes(report.stages[s.key].average) }}</span>
                <span class="text-[11.5px] text-ink-muted">{{ t(`${report.stages[s.key].count} visits`, `${report.stages[s.key].count} visitas`) }}</span>
              </span>
            </button>
          </div>
        </ReportsModule>

        <ReportsModule :title="t('How long, how often', 'Cuánto y con qué frecuencia')" :description="STAGES.find((s) => s.key === stage)?.title" :loading="loading" skeleton="list" :rows="5">
          <div class="mt-3 space-y-3" data-cy="flow-distribution">
            <div v-for="(b, i) in FLOW_BUCKETS" :key="b.key" class="flex items-center gap-3 text-[12.5px]">
              <span class="w-[4.5rem] shrink-0 whitespace-nowrap text-ink-muted">{{ b.key }} min</span>
              <div class="h-2 flex-1 overflow-hidden rounded-pill bg-chip-bg"><div class="h-full rounded-pill bg-brand" :style="{ width: `${Math.round(report.stages[stage].buckets[i] * 100)}%` }" /></div>
              <span class="w-10 shrink-0 text-right font-mono text-ink-700">{{ pct(report.stages[stage].count ? report.stages[stage].buckets[i] : null) }}</span>
            </div>
          </div>
        </ReportsModule>
      </div>

      <ReportsModule v-if="!reportsPractitionerId" :title="t('By practitioner', 'Por profesional')" :loading="loading" skeleton="list">
        <p v-if="!report.byPractitioner.length" class="py-3 text-center text-[13.5px] text-ink-faint">{{ t('Nothing tracked yet.', 'Aún no hay nada registrado.') }}</p>
        <ul v-else class="mt-1" data-cy="flow-by-practitioner">
          <li v-for="p in report.byPractitioner" :key="p.practitionerId ?? 'none'" class="border-b border-line-divider py-2.5 last:border-b-0" data-cy="flow-practitioner-row">
            <div class="flex items-baseline justify-between gap-3">
              <span class="min-w-0 truncate text-[14.5px] font-medium text-ink-900">{{ practitionerName(p.practitionerId) }}</span>
              <span class="shrink-0 text-[12.5px] text-ink-muted"><span class="font-mono font-semibold text-ink-900">{{ p.visits }}</span> {{ t('visits', 'visitas') }}</span>
            </div>
            <dl class="mt-1.5 grid grid-cols-3 gap-2">
              <div>
                <dt :class="figureLabel">{{ t('Wait', 'Espera') }}</dt>
                <dd :class="figureValue">{{ formatFlowMinutes(p.wait) }}</dd>
              </div>
              <div>
                <dt :class="figureLabel">{{ t('Late', 'Retraso') }}</dt>
                <dd :class="figureValue">{{ formatFlowMinutes(p.delay) }}</dd>
              </div>
              <div>
                <dt :class="figureLabel">{{ t('Session', 'Consulta') }}</dt>
                <dd :class="figureValue">{{ formatFlowMinutes(p.session) }}</dd>
              </div>
            </dl>
          </li>
        </ul>
      </ReportsModule>
    </div>
  </ReportScreen>
</template>

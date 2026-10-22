<script setup lang="ts">
import { VIEW_LABELS, type Points, type PostureView, type StoredViews, type ViewMetrics } from '../../utils/posture'
import { remeasure, TREND_METRICS, trendLayout, trendSeries, trendSummary, type TrendKey } from '../../utils/postureTrend'

// "Progreso" for the patient, in the app and the portal: the posture
// assessments their practitioner shared ("Lo ve el paciente"), as a chart of
// the number they choose, their first and latest photos side by side, and
// the report for each. The same numbers and scale as the staff chart
// (utils/postureTrend.ts), in plainer words. Shared with mobile/, so its
// imports are relative.
const t = useT()
const authedFetch = useAuthedFetch()
const lang = computed(() => t('en', 'es') as 'en' | 'es')

interface View { url: string | null; width: number; height: number; points: Points; facing: 'right' | 'left' | null }
interface Assessment { id: string; takenAt: string; heightCm: number | null; metrics: Partial<Record<PostureView, ViewMetrics>>; views: Partial<Record<PostureView, View>> }
const list = ref<Assessment[]>([])
const loading = ref(true)
const loadError = ref(false)
async function load() {
  loading.value = true
  loadError.value = false
  try {
    list.value = (await authedFetch<{ assessments: Assessment[] }>('/api/portal/posture')).assessments
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}
onMounted(load)

// Measured again from the points, as the staff side and the report do.
const measured = computed(() =>
  list.value.map((a) => ({
    takenAt: a.takenAt,
    metrics: remeasure({ takenAt: a.takenAt, heightCm: Number(a.heightCm ?? 0), views: a.views as unknown as StoredViews, metrics: a.metrics }),
  })),
)

// The four that explain themselves; the knees stay with the clinic.
const WORDS: Record<Exclude<TrendKey, 'knees'>, { short: [string, string]; label: [string, string]; ideal: [string, string]; help: [string, string] }> = {
  headWeight: {
    short: ['Head weight', 'Peso de la cabeza'],
    label: ['What your neck holds', 'Peso que sostiene tu cuello'],
    ideal: ['head upright, about 5 kg', 'cabeza erguida, unos 5 kg'],
    help: ['The further the head moves forward, the more weight the neck has to hold. Upright it weighs about 5 kg.', 'Cuanto más se adelanta la cabeza, más peso tiene que sostener el cuello. Erguida pesa unos 5 kg.'],
  },
  headForward: {
    short: ['Head forward', 'Cabeza adelantada'],
    label: ['Head ahead of the shoulder', 'Cabeza por delante del hombro'],
    ideal: ['ear over the shoulder', 'oreja sobre el hombro'],
    help: ['How many centimetres your ear sits ahead of your shoulder, seen from the side.', 'Cuántos centímetros se adelanta tu oreja respecto al hombro, visto de lado.'],
  },
  shoulderTilt: {
    short: ['Shoulders', 'Hombros'],
    label: ['Difference between shoulders', 'Diferencia entre hombros'],
    ideal: ['shoulders at the same height', 'hombros a la misma altura'],
    help: ['How much lower one shoulder is than the other, seen from the front. A degree and a half is normal in anyone.', 'Cuánto más bajo está un hombro que el otro, visto de frente. Un grado y medio es normal en cualquiera.'],
  },
  hipTilt: {
    short: ['Pelvis', 'Pelvis'],
    label: ['Difference between hips', 'Diferencia entre caderas'],
    ideal: ['hips at the same height', 'caderas a la misma altura'],
    help: ['How much lower one hip is than the other, seen from the front.', 'Cuánto más baja está una cadera que la otra, visto de frente.'],
  },
}
const word = (pair: [string, string]) => t(pair[0], pair[1])
const metrics = computed(() =>
  TREND_METRICS.filter((m) => m.key !== 'knees')
    .map((m) => ({ ...m, words: WORDS[m.key as Exclude<TrendKey, 'knees'>], series: trendSeries(measured.value, m.key) }))
    .filter((m) => m.series.length > 0),
)
const key = ref<TrendKey>('headWeight')
watch(metrics, (ms) => {
  if (ms.length && !ms.some((m) => m.key === key.value)) key.value = ms[0]!.key
}, { immediate: true })
const metric = computed(() => metrics.value.find((m) => m.key === key.value) ?? null)

const W = 340
const H = 170
const chart = computed(() => {
  const m = metric.value
  if (!m || m.series.length < 2) return null
  const layout = trendLayout(m.series, m.ideal, { width: W, height: H, left: 12, right: 12, top: 14, bottom: 12 })
  const pts = layout.points
  return {
    ...layout,
    line: pts.map((p) => `${p.x},${p.y}`).join(' '),
    area: `M${pts[0]!.x},${layout.baseY} L${pts.map((p) => `${p.x},${p.y}`).join(' L')} L${pts[pts.length - 1]!.x},${layout.baseY} Z`,
  }
})
const summary = computed(() => (metric.value ? trendSummary(metric.value.series, metric.value.ideal) : null))
const latestValue = computed(() => metric.value?.series[metric.value.series.length - 1] ?? null)
const firstValue = computed(() => metric.value?.series[0] ?? null)

const num = (n: number) => (Math.round(n * 10) / 10 || 0).toLocaleString(t('en-GB', 'es-ES'), { maximumFractionDigits: 1 })
const withUnit = (n: number, unit: string) => `${num(n)}${unit === '°' ? '°' : ` ${unit}`}`
const shortDay = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short' })
const longDay = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'long' })

// The first and the latest photos, in a view both have.
const first = computed(() => list.value[0] ?? null)
const latest = computed(() => list.value[list.value.length - 1] ?? null)
const pair = computed(() => (list.value.length > 1 ? [first.value!, latest.value!] : latest.value ? [latest.value] : []))
const views = computed(() => (['right', 'left', 'front', 'back'] as PostureView[]).filter((v) => pair.value.length && pair.value.every((a) => a.views[v]?.url)))
const view = ref<PostureView>('right')
watch(views, (vs) => {
  if (vs.length && !vs.includes(view.value)) view.value = vs[0]!
}, { immediate: true })

// The report for one assessment, the same PDF the clinic hands out
// (api/portal/posture/[id]/report), opened from a link so it works in the
// app's WebView too. A failure says so: a button that silently does nothing
// is how a missing route went unnoticed.
const reporting = ref<string | null>(null)
const reportError = ref('')
function openReport(id: string) {
  reporting.value = id
  reportError.value = ''
  openWhenReady(async () => {
    try {
      return (await authedFetch<{ url: string }>(`/api/portal/posture/${id}/report`, { method: 'POST' })).url
    } catch {
      reportError.value = t('The report could not be prepared. Try again in a moment.', 'No se ha podido preparar el informe. Inténtalo de nuevo en un momento.')
      return null
    } finally {
      reporting.value = null
    }
  })
}
const history = computed(() => [...list.value].reverse())
const showAll = ref(false)
</script>

<template>
  <div class="flex flex-col gap-3" data-cy="patient-posture" :data-ready="loading ? undefined : 'true'">
    <div v-if="loading" class="space-y-3"><UiSkeleton class="h-64 w-full rounded-card" /></div>
    <PatientLoadError v-else-if="loadError" @retry="load" />
    <p v-else-if="!list.length" class="rounded-card border border-dashed border-line-control bg-surface p-6 text-center text-[13.5px] text-ink-muted" data-cy="patient-posture-empty">
      {{ t('When your chiropractor shares a posture assessment with you, you will see it here, and how it changes over time.', 'Cuando tu quiropráctico comparta contigo una valoración de postura, la verás aquí, y cómo cambia con el tiempo.') }}
    </p>
    <template v-else>
      <p class="text-[13px] text-ink-muted">
        {{ list.length === 1
          ? t(`1 posture assessment, on ${longDay(latest!.takenAt)}`, `1 valoración de postura, el ${longDay(latest!.takenAt)}`)
          : t(`${list.length} posture assessments, ${longDay(first!.takenAt)} to ${longDay(latest!.takenAt)}`, `${list.length} valoraciones de postura, del ${longDay(first!.takenAt)} al ${longDay(latest!.takenAt)}`) }}
      </p>

      <section v-if="metric && latestValue" class="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-4 shadow-card" data-cy="patient-posture-evolution">
        <div class="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5" role="group" :aria-label="t('Measurement', 'Medida')">
          <button
            v-for="m in metrics"
            :key="m.key"
            type="button"
            class="h-9 shrink-0 rounded-pill border px-3 text-[13px] font-semibold"
            :class="key === m.key ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'"
            :aria-pressed="key === m.key"
            :data-cy="`patient-posture-metric-${m.key}`"
            @click="key = m.key"
          >{{ word(m.words.short) }}</button>
        </div>
        <div class="flex flex-wrap items-baseline gap-2">
          <span class="font-mono text-[28px] font-semibold text-ink-900" :data-cy="metric.key === 'headWeight' ? 'patient-posture-weight' : undefined">{{ withUnit(latestValue.value, metric.unit) }}</span>
          <span
            v-if="summary"
            class="rounded-pill px-2.5 py-0.5 text-[13px] font-semibold"
            :class="summary.better === true ? 'bg-success-bg text-success-text' : summary.better === false ? 'bg-warning-bg text-warning-text' : 'bg-surface-subtle text-ink-700'"
            data-cy="patient-posture-delta"
            :data-better="summary.better === null ? 'same' : String(summary.better)"
          >
            {{ summary.delta > 0 ? '+' : summary.delta < 0 ? '−' : '' }}{{ num(Math.abs(summary.delta)) }}
            · {{ summary.better === true ? t("you're improving", 'vas mejor') : summary.better === false ? t('one to watch', 'a vigilar') : t('about the same', 'igual') }}
          </span>
        </div>
        <p class="-mt-1.5 text-[12.5px] text-ink-muted">
          {{ word(metric.words.label) }}<template v-if="firstValue && list.length > 1"> · {{ t(`on ${shortDay(firstValue.takenAt)}: ${withUnit(firstValue.value, metric.unit)}`, `el ${shortDay(firstValue.takenAt)}: ${withUnit(firstValue.value, metric.unit)}`) }}</template>
        </p>
        <template v-if="chart">
          <svg :viewBox="`0 0 ${W} ${H}`" class="block h-auto w-full" role="img" :aria-label="t(`${word(metric.words.label)}: from ${num(firstValue!.value)} to ${num(latestValue.value)}`, `${word(metric.words.label)}: de ${num(firstValue!.value)} a ${num(latestValue.value)}`)" data-cy="patient-posture-chart">
            <line v-for="g in chart.ticks" :key="g.value" x1="12" :x2="W - 12" :y1="g.y" :y2="g.y" class="stroke-line" stroke-width="1" />
            <path :d="chart.area" class="fill-brand" fill-opacity="0.07" />
            <line x1="12" :x2="W - 12" :y1="chart.idealY" :y2="chart.idealY" class="stroke-success-text" stroke-width="1.5" stroke-dasharray="6 5" />
            <polyline :points="chart.line" fill="none" class="stroke-brand" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
            <circle v-for="p in chart.points" :key="p.takenAt" :cx="p.x" :cy="p.y" r="5" class="fill-surface stroke-brand" stroke-width="2.5" />
          </svg>
          <div class="flex justify-between text-[11px] text-ink-muted">
            <span>{{ shortDay(chart.points[0]!.takenAt) }}</span>
            <span v-if="chart.points.length > 2">{{ shortDay(chart.points[Math.floor((chart.points.length - 1) / 2)]!.takenAt) }}</span>
            <span>{{ shortDay(chart.points[chart.points.length - 1]!.takenAt) }}</span>
          </div>
        </template>
        <p v-else class="text-[12.5px] text-ink-muted">{{ t('With your next assessment you will see here how it changes.', 'Con tu próxima valoración verás aquí cómo cambia.') }}</p>
        <p class="text-[12.5px] leading-relaxed text-ink-700">{{ word(metric.words.help) }}</p>
        <p class="text-[12px] font-semibold text-success-text">{{ t(`Green line: ${word(metric.words.ideal)}. The closer, the better.`, `Línea verde: ${word(metric.words.ideal)}. Cuanto más cerca, mejor.`) }}</p>
      </section>

      <section v-if="views.length" class="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-4 shadow-card" data-cy="patient-posture-photos">
        <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('Your photos', 'Tus fotos') }}</p>
        <div class="grid gap-2.5" :class="pair.length > 1 ? 'grid-cols-2' : 'grid-cols-1'">
          <figure v-for="a in pair" :key="a.id" class="m-0 flex flex-col gap-1">
            <PostureOverlay :src="a.views[view]!.url!" :width="a.views[view]!.width" :height="a.views[view]!.height" :view="view" :points="a.views[view]!.points" :labels="false" />
            <figcaption class="text-center text-[12px] text-ink-muted">{{ longDay(a.takenAt) }}</figcaption>
          </figure>
        </div>
        <div v-if="views.length > 1" class="flex flex-wrap gap-1.5" role="group" :aria-label="t('View', 'Vista')">
          <button v-for="v in views" :key="v" type="button" class="h-9 rounded-pill border px-3 text-[13px] font-semibold" :class="view === v ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'" :aria-pressed="view === v" @click="view = v">{{ VIEW_LABELS[v] }}</button>
        </div>
      </section>

      <section class="flex items-center gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
        <div class="min-w-0 flex-1">
          <p class="text-[14.5px] font-semibold text-ink-900">{{ t('Your posture report', 'Tu informe postural') }}</p>
          <p class="text-[12.5px] text-ink-muted">{{ t(`Assessment of ${longDay(latest!.takenAt)} · PDF`, `Valoración del ${longDay(latest!.takenAt)} · PDF`) }}</p>
        </div>
        <button type="button" class="h-11 shrink-0 rounded-ctl bg-brand px-4 text-[13.5px] font-semibold text-white disabled:opacity-60" :disabled="reporting !== null" data-cy="patient-posture-report" @click="openReport(latest!.id)">
          {{ reporting === latest!.id ? t('Preparing…', 'Preparando…') : t('Download', 'Descargar') }}
        </button>
      </section>
      <p v-if="reportError" role="alert" class="-mt-1 text-[12.5px] text-danger-text" data-cy="patient-posture-report-error">{{ reportError }}</p>

      <section v-if="list.length > 1" class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <p class="px-4 pb-1.5 pt-3.5 text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('All your assessments', 'Todas tus valoraciones') }}</p>
        <ul class="divide-y divide-line-divider">
          <li v-for="a in showAll ? history : history.slice(0, 4)" :key="a.id" class="flex items-center gap-3 px-4 py-2">
            <span class="flex-1 text-[13.5px] text-ink-900">{{ longDay(a.takenAt) }}</span>
            <button type="button" class="h-11 text-[13px] font-semibold text-brand-text disabled:opacity-60" :disabled="reporting !== null" @click="openReport(a.id)">
              {{ reporting === a.id ? t('Preparing…', 'Preparando…') : t('Report', 'Informe') }}
            </button>
          </li>
        </ul>
        <button v-if="!showAll && history.length > 4" type="button" class="h-11 w-full border-t border-line-divider text-[13px] font-semibold text-ink-muted" @click="showAll = true">
          {{ t(`Show all ${history.length}`, `Ver las ${history.length}`) }}
        </button>
      </section>

      <p class="text-center text-[11.5px] text-ink-muted">{{ t('Estimates from photos, to explain your progress. Not a diagnosis.', 'Estimaciones a partir de fotos, para explicar tu progreso. No son un diagnóstico.') }}</p>
    </template>
  </div>
</template>

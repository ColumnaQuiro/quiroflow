<script setup lang="ts">
import { VIEW_LABELS, type Points, type PostureView, type StoredViews, type ViewMetrics } from '../../utils/posture'
import { ghostPoints } from '../../utils/postureCompare'
import { remeasure, TREND_METRICS, trendLayout, trendSeries, trendSummary, type TrendKey } from '../../utils/postureTrend'

// "Progreso" for the patient, in the app and the portal: the posture
// assessments their practitioner shared ("Lo ve el paciente"), as a chart of
// the number they choose, two of them compared -- the first and the latest
// unless they pick others: photos side by side, each measure then and now
// (components/posture/Compare.vue) and that comparison as a PDF -- and the
// report for each. First of all, the comparisons their practitioner sent
// them (posture_comparisons), each with its comment: opening one shows that
// pair in the same place, whether or not its assessments are shared one by one. The same numbers and scale as the staff chart
// (utils/postureTrend.ts), in plainer words. Shared with mobile/, so its
// imports are relative.
const t = useT()
const authedFetch = useAuthedFetch()
// Whose: the family switcher's person (composables/useFamily.ts).
const { active } = useFamily()
const lang = computed(() => t('en', 'es') as 'en' | 'es')

interface View { url: string | null; width: number; height: number; points: Points; facing: 'right' | 'left' | null }
interface Assessment { id: string; takenAt: string; heightCm: number | null; metrics: Partial<Record<PostureView, ViewMetrics>>; views: Partial<Record<PostureView, View>> }
interface SentComparison { id: string; sentAt: string; note: string | null; by: string | null; before: Assessment; after: Assessment }
const list = ref<Assessment[]>([])
const sent = ref<SentComparison[]>([])
const loading = ref(true)
const loadError = ref(false)
// The sent comparison being shown, or null while they compare on their own.
const sentId = ref<string | null>(null)
const opened = computed(() => sent.value.find((c) => c.id === sentId.value) ?? null)
async function load() {
  loading.value = true
  loadError.value = false
  try {
    const res = await authedFetch<{ assessments: Assessment[]; comparisons?: SentComparison[] }>('/api/portal/posture', { query: active.value ? { patientId: active.value.patientId } : {} })
    sent.value = res.comparisons ?? []
    // The newest one the clinic sent is what they came to see.
    sentId.value = sent.value[0]?.id ?? null
    list.value = res.assessments
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

// Two of them compared, in a view both have: the first and the latest until
// the patient picks others. "Before" is always the earlier of the two, so
// each list only offers what keeps it that way.
const first = computed(() => list.value[0] ?? null)
const latest = computed(() => list.value[list.value.length - 1] ?? null)
const beforeId = ref<string | null>(null)
const afterId = ref<string | null>(null)
watch(list, (l) => {
  beforeId.value = l.length > 1 ? l[0]!.id : null
  afterId.value = l.length ? l[l.length - 1]!.id : null
})
const before = computed(() => (opened.value ? opened.value.before : (list.value.find((a) => a.id === beforeId.value) ?? null)))
const after = computed(() => (opened.value ? opened.value.after : (list.value.find((a) => a.id === afterId.value) ?? latest.value)))
const beforeChoices = computed(() => list.value.filter((a) => !after.value || a.takenAt < after.value.takenAt))
const afterChoices = computed(() => list.value.filter((a) => !before.value || a.takenAt > before.value.takenAt))
const pair = computed(() => (before.value && after.value ? [before.value, after.value] : after.value ? [after.value] : []))
const measure = (a: Assessment) => remeasure({ takenAt: a.takenAt, heightCm: Number(a.heightCm ?? 0), views: a.views as unknown as StoredViews, metrics: a.metrics })
const compared = computed(() => (before.value && after.value ? [measure(before.value), measure(after.value)] : null))
const views = computed(() => (['right', 'left', 'front', 'back'] as PostureView[]).filter((v) => pair.value.length && pair.value.every((a) => a.views[v]?.url)))
const view = ref<PostureView>('right')
watch(views, (vs) => {
  if (vs.length && !vs.includes(view.value)) view.value = vs[0]!
}, { immediate: true })

// The earlier figure, dashed, over the later photo (utils/postureCompare.ts).
const ghost = computed(() => {
  const bv = before.value?.views[view.value]
  const av = after.value?.views[view.value]
  return bv && av ? ghostPoints(view.value, bv, av) : null
})

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
// The comparison of the two chosen, as a PDF (api/portal/posture/[id]/comparison).
const comparing = ref(false)
const compareError = ref('')
function openComparison() {
  const b = before.value
  const a = after.value
  if (!a || !b) return
  comparing.value = true
  compareError.value = ''
  openWhenReady(async () => {
    try {
      // A sent one is asked for by its own id: it is what lets them read its two assessments.
      const sentOne = opened.value
      return (await (sentOne ? authedFetch<{ url: string }>(`/api/portal/posture-comparisons/${sentOne.id}/report`, { method: 'POST' }) : authedFetch<{ url: string }>(`/api/portal/posture/${a.id}/comparison`, { method: 'POST', body: { withId: b.id } }))).url
    } catch {
      compareError.value = t('The comparison could not be prepared. Try again in a moment.', 'No se ha podido preparar la comparativa. Inténtalo de nuevo en un momento.')
      return null
    } finally {
      comparing.value = false
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
    <p v-else-if="!list.length && !sent.length" class="rounded-card border border-dashed border-line-control bg-surface p-6 text-center text-[13.5px] text-ink-muted" data-cy="patient-posture-empty">
      {{ t('When your clinic shares a posture assessment with you, you will see it here, and how it changes over time.', 'Cuando tu clínica comparta contigo una valoración de postura, la verás aquí, y cómo cambia con el tiempo.') }}
    </p>
    <template v-else>
      <section v-if="sent.length" class="flex flex-col gap-2 rounded-card border border-line bg-surface p-4 shadow-card" data-cy="patient-posture-sent">
        <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('From your clinic', 'De tu clínica') }}</p>
        <button
          v-for="c in sent"
          :key="c.id"
          type="button"
          class="flex min-h-11 flex-col gap-0.5 rounded-ctl border px-3 py-2.5 text-left"
          :class="sentId === c.id ? 'border-brand bg-brand-tint' : 'border-line-control bg-surface'"
          :aria-pressed="sentId === c.id"
          data-cy="patient-posture-sent-item"
          @click="sentId = c.id"
        >
          <span class="text-[14px] font-semibold" :class="sentId === c.id ? 'text-brand-text' : 'text-ink-900'">{{ t(`Comparison: ${longDay(c.before.takenAt)} and ${longDay(c.after.takenAt)}`, `Comparativa: ${longDay(c.before.takenAt)} y ${longDay(c.after.takenAt)}`) }}</span>
          <span v-if="c.by" class="text-[12px] text-ink-muted">{{ t(`Sent by ${c.by}`, `Te la envía ${c.by}`) }}</span>
        </button>
        <p v-if="opened?.note" class="whitespace-pre-line rounded-ctl bg-surface-subtle px-3 py-2.5 text-[14px] leading-relaxed text-ink-900" data-cy="patient-posture-sent-note">{{ opened.note }}</p>
        <button v-if="opened && list.length > 1" type="button" class="h-11 self-start text-[13px] font-semibold text-brand-text" data-cy="patient-posture-own" @click="sentId = null">{{ t('Compare other dates myself', 'Comparar yo otras fechas') }}</button>
      </section>

      <p v-if="list.length" class="text-[13px] text-ink-muted">
        {{ list.length === 1
          ? t(`1 posture assessment, on ${longDay(latest!.takenAt)}`, `1 valoración de postura, el ${longDay(latest!.takenAt)}`)
          : t(`${list.length} posture assessments, ${longDay(first!.takenAt)} to ${longDay(latest!.takenAt)}`, `${list.length} valoraciones de postura, del ${longDay(first!.takenAt)} al ${longDay(latest!.takenAt)}`) }}
      </p>

      <section v-if="metric && latestValue" class="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-4 shadow-card" data-cy="patient-posture-evolution">
        <div class="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" :aria-label="t('Measurement', 'Medida')">
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
        <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ pair.length > 1 ? t('Before and now', 'Antes y ahora') : t('Your photos', 'Tus fotos') }}</p>
        <!-- With only two there is nothing to choose. -->
        <div v-if="!opened && list.length > 2" class="grid grid-cols-2 gap-2.5">
          <label class="flex min-w-0 flex-col gap-1 text-[12px] text-ink-muted">
            {{ t('Before', 'Antes') }}
            <select v-model="beforeId" class="h-11 min-w-0 rounded-ctl border border-line-control bg-surface px-2.5 text-[14px] text-ink-900" data-cy="patient-posture-before">
              <option v-for="a in beforeChoices" :key="a.id" :value="a.id">{{ longDay(a.takenAt) }}</option>
            </select>
          </label>
          <label class="flex min-w-0 flex-col gap-1 text-[12px] text-ink-muted">
            {{ t('Now', 'Ahora') }}
            <select v-model="afterId" class="h-11 min-w-0 rounded-ctl border border-line-control bg-surface px-2.5 text-[14px] text-ink-900" data-cy="patient-posture-after">
              <option v-for="a in afterChoices" :key="a.id" :value="a.id">{{ longDay(a.takenAt) }}</option>
            </select>
          </label>
        </div>
        <div class="grid gap-2.5" :class="pair.length > 1 ? 'grid-cols-2' : 'grid-cols-1'">
          <figure v-for="(a, i) in pair" :key="a.id" class="m-0 flex flex-col gap-1">
            <PostureOverlay :src="a.views[view]!.url!" :width="a.views[view]!.width" :height="a.views[view]!.height" :view="view" :points="a.views[view]!.points" :labels="false" :ghost="i === 1 ? ghost : null" />
            <figcaption class="text-center text-[12px] text-ink-muted">{{ longDay(a.takenAt) }}</figcaption>
          </figure>
        </div>
        <div v-if="views.length > 1" class="flex flex-wrap gap-1.5" role="group" :aria-label="t('View', 'Vista')">
          <button v-for="v in views" :key="v" type="button" class="h-9 rounded-pill border px-3 text-[13px] font-semibold" :class="view === v ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'" :aria-pressed="view === v" @click="view = v">{{ VIEW_LABELS[v] }}</button>
        </div>
        <p v-if="ghost" class="text-[12px] text-ink-muted">{{ t(`Dashed white line: your posture on ${longDay(before!.takenAt)}, over the later photo.`, `Línea blanca discontinua: tu postura del ${longDay(before!.takenAt)}, sobre la foto posterior.`) }}</p>
      </section>

      <section v-if="compared" class="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card" data-cy="patient-posture-comparison">
        <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('What has changed', 'Qué ha cambiado') }}</p>
        <PostureCompare :before="compared[0]!" :after="compared[1]!" :before-at="before!.takenAt" :after-at="after!.takenAt" audience="patient" />
        <button type="button" class="h-11 rounded-ctl border border-line-control bg-surface px-4 text-[13.5px] font-semibold text-ink-900 disabled:opacity-60" :disabled="comparing" data-cy="patient-posture-comparison-report" @click="openComparison">
          {{ comparing ? t('Preparing…', 'Preparando…') : t('Download the comparison (PDF)', 'Descargar la comparativa (PDF)') }}
        </button>
        <p v-if="compareError" role="alert" class="text-[12.5px] text-danger-text" data-cy="patient-posture-comparison-error">{{ compareError }}</p>
      </section>

      <section v-if="latest" class="flex items-center gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
        <div class="min-w-0 flex-1">
          <p class="text-[14.5px] font-semibold text-ink-900">{{ t('Your posture report', 'Tu informe postural') }}</p>
          <p class="text-[12.5px] text-ink-muted">{{ t(`Assessment of ${longDay(latest!.takenAt)} · PDF`, `Valoración del ${longDay(latest!.takenAt)} · PDF`) }}</p>
        </div>
        <button type="button" class="h-11 shrink-0 rounded-ctl bg-brand px-4 text-[13.5px] font-semibold text-brand-on disabled:opacity-60" :disabled="reporting !== null" data-cy="patient-posture-report" @click="openReport(latest!.id)">
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

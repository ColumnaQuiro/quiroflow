<script setup lang="ts">
import { Bar, Doughnut, Line } from 'vue-chartjs'
import { computePresetRange, rangeBounds, type DateRange } from '~/composables/useDateRangePresets'
import { REPORT_DATA_KEY } from '~/composables/useReportData'
import type { Compare, OwnPeriod, ReportBlock } from '~/utils/reportBlocks'
import { comparisonRange, computeMetric, computePivot, formatDelta, formatMetric, METRIC_BY_KEY, SPLIT_LABELS, TIME_SPLITS, type Ctx, type MetricResult, type PivotResult } from '~/utils/reportMetrics'

// One block of a report page: a metric, split some way, drawn some way, for
// the page's period (or its own). Its data comes from the page's shared
// loader, so blocks reading the same thing do not each fetch it.
const props = defineProps<{
  block: ReportBlock
  range: DateRange
  compare: Compare
  /** The page's practitioner: the viewer themselves when they see only their own figures. */
  practitionerId: string | null
  clinicId: string | null
  /** The viewer sees only their own figures (reports_own_only). */
  ownOnly: boolean
  editing?: boolean
}>()
const emit = defineEmits<{ edit: []; remove: []; duplicate: []; resize: [span: ReportBlock['span']]; move: [by: -1 | 1] }>()

const t = useT()
const store = useAccountStore()
const hub = inject(REPORT_DATA_KEY)!
const def = computed(() => METRIC_BY_KEY.get(props.block.config.metric) ?? null)
const menuOpen = ref(false)

function ownPeriod(preset: OwnPeriod): { from: Date; to: Date } {
  const now = new Date()
  if (preset === 'this_year') return { from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999) }
  if (preset === 'last_year') return { from: new Date(now.getFullYear() - 1, 0, 1), to: new Date(now.getFullYear(), 0, 1, 0, 0, 0, -1) }
  const months = preset === 'last_3_months' ? 3 : preset === 'last_6_months' ? 6 : 12
  return rangeBounds(computePresetRange({ months }))
}

const period = computed(() => (props.block.config.period?.mode === 'own' ? ownPeriod(props.block.config.period.preset) : rangeBounds(props.range)))

// Why this block cannot show its figure to this person, if it cannot.
const unavailable = computed<string | null>(() => {
  const d = def.value
  if (!d) return t('This figure is no longer available.', 'Esta cifra ya no está disponible.')
  if (d.clinicWide && props.ownOnly) return t('Not available with your role: this figure is about the whole clinic.', 'No disponible con tu rol: esta cifra es de toda la clínica.')
  if (d.permission === 'billing' && !(store.permissions.billing_config || store.permissions.packages_edit || store.isOwner))
    return t('Needs access to billing settings or bonos.', 'Necesita acceso a la configuración de facturación o a bonos.')
  if (d.permission === 'inbox' && !(store.permissions.inbox_access || store.isOwner)) return t('Needs Inbox access.', 'Necesita acceso a la Bandeja de entrada.')
  if (d.permission === 'growth' && !store.hasGrowthAddon) return t('Part of Growth, which this clinic does not have.', 'Forma parte de Crecimiento, que esta clínica no tiene.')
  return null
})

// The page's practitioner wins over the block's own: a block cannot widen
// what an own-only viewer sees.
const practitioner = computed(() => props.practitionerId || props.block.config.filters?.practitionerId || null)
const clinic = computed(() => props.clinicId || props.block.config.filters?.clinicId || null)
// A clinic-wide figure under a practitioner filter shows the whole clinic, and says so.
const wholeClinicDespiteFilter = computed(() => !!def.value?.clinicWide && !!practitioner.value)

function ctxFor(r: { from: Date; to: Date }): Ctx {
  return {
    from: r.from,
    to: r.to,
    practitionerId: def.value?.clinicWide ? null : practitioner.value,
    clinicId: def.value?.clinicWide ? null : clinic.value,
    method: props.block.config.filters?.method ?? null,
    now: new Date(),
    t,
  }
}

const previousPeriod = computed(() => {
  if (!def.value || def.value.snapshot || props.block.config.chart !== 'number') return null
  return comparisonRange(period.value.from, period.value.to, props.compare)
})

const loading = ref(true)
const error = ref('')
let run = 0
// Keyed on the dates, not the objects: the page setting the same period
// again (as it does when its saved settings arrive) must not reload anything.
const loadKey = computed(() =>
  [def.value?.key, period.value.from.getTime(), period.value.to.getTime(), previousPeriod.value?.from.getTime(), previousPeriod.value?.to.getTime(), unavailable.value, hub.generation.value].join('|'),
)
watch(
  loadKey,
  async () => {
    if (!def.value || unavailable.value) {
      loading.value = false
      return
    }
    const mine = ++run
    loading.value = true
    error.value = ''
    try {
      await hub.ensure(def.value.needs, [period.value, ...(previousPeriod.value ? [previousPeriod.value] : [])])
    } catch (e) {
      if (mine === run) error.value = (e as { message?: string })?.message ?? String(e)
    }
    if (mine === run) loading.value = false
  },
  { immediate: true },
)

const result = computed<MetricResult | null>(() => {
  void hub.version.value
  if (loading.value || error.value || !def.value || unavailable.value) return null
  return computeMetric(def.value, props.block.config.split, hub.data, ctxFor(period.value))
})
// A table split two ways, when the block asks for one and the metric can be cut into cells.
const pivot = computed<PivotResult | null>(() => {
  void hub.version.value
  const columns = props.block.config.columns
  if (!columns || chart.value !== 'table' || loading.value || error.value || !def.value || unavailable.value) return null
  return computePivot(def.value, props.block.config.split, columns, hub.data, ctxFor(period.value))
})
const previous = computed<number | null>(() => {
  void hub.version.value
  if (loading.value || !def.value || !previousPeriod.value || unavailable.value) return null
  return computeMetric(def.value, 'none', hub.data, ctxFor(previousPeriod.value)).value
})

const unit = computed(() => def.value?.unit ?? 'count')
const fmt = (v: number | null) => formatMetric(v, unit.value)
const delta = computed(() => (props.compare === 'none' ? null : formatDelta(result.value?.value ?? null, previous.value, unit.value)))
const compareLabel = computed(() => (props.compare === 'previous_year' ? t('vs a year before', 'vs hace un año') : t('vs previous period', 'vs periodo anterior')))

// A split with nothing to split is a number.
const chart = computed(() => {
  const c = props.block.config.chart
  if (def.value?.steps) return 'funnel'
  if (props.block.config.split === 'none' || c === 'number') return 'number'
  return c
})
const isTime = computed(() => TIME_SPLITS.includes(props.block.config.split))

const PALETTE = ['#4f46e5', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6', '#64748b', '#0ea5e9', '#84cc16', '#ef4444', '#a855f7']
// Money is stored in cents; the charts speak euros.
const scale = (v: number | null) => (v === null ? null : unit.value === 'eur' ? v / 100 : v)
const rows = computed(() => result.value?.rows ?? [])
const chartData = computed(() => ({
  labels: rows.value.map((r) => r.label),
  datasets: [
    {
      label: props.block.title,
      data: rows.value.map((r) => scale(r.value)),
      backgroundColor: chart.value === 'donut' ? rows.value.map((_, i) => PALETTE[i % PALETTE.length]) : '#4f46e5',
      borderColor: chart.value === 'donut' ? '#ffffff' : '#4f46e5',
      tension: 0.3,
      spanGaps: true,
    },
  ],
}))
// A doughnut has no gaps: an empty slice is zero.
const donutData = computed(() => ({
  labels: rows.value.map((r) => r.label),
  datasets: [{ data: rows.value.map((r) => scale(r.value) ?? 0), backgroundColor: rows.value.map((_, i) => PALETTE[i % PALETTE.length]!), borderColor: '#ffffff' }],
}))
const tooltip = { callbacks: { label: (c: { raw: unknown }) => fmt(unit.value === 'eur' ? Number(c.raw) * 100 : Number(c.raw)) } }
const horizontal = computed(() => chart.value === 'bar' && !isTime.value)
const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false as const,
  indexAxis: horizontal.value ? ('y' as const) : ('x' as const),
  scales: { [horizontal.value ? 'x' : 'y']: { beginAtZero: true } },
  plugins: { legend: { display: false }, tooltip },
}))
const donutOptions = { responsive: true, maintainAspectRatio: false, animation: false as const, cutout: '62%', plugins: { legend: { display: false }, tooltip } }
const chartHeight = computed(() => (horizontal.value ? `${Math.max(160, rows.value.length * 30 + 40)}px` : '240px'))

const funnelMax = computed(() => Math.max(1, ...(result.value?.steps ?? []).map((s) => s.value)))

const periodTag = computed(() => {
  const p = props.block.config.period
  if (def.value?.snapshot) return t('Now', 'Ahora')
  if (p?.mode !== 'own') return null
  return {
    last_3_months: t('Last 3 months', 'Últimos 3 meses'),
    last_6_months: t('Last 6 months', 'Últimos 6 meses'),
    last_12_months: t('Last 12 months', 'Últimos 12 meses'),
    this_year: t('This year', 'Este año'),
    last_year: t('Last year', 'Año pasado'),
  }[p.preset]
})
// A total row only where the rows add up to it: not for patients (one
// patient can be in two rows), rates, or "by service" (invoice lines, not
// the payments the total counts).
const tableTotal = computed(() => (def.value?.reduce === undefined && !def.value?.value && props.block.config.split !== 'service' ? result.value?.value : null))

function closeMenuSoon() {
  setTimeout(() => (menuOpen.value = false), 150)
}
</script>

<template>
  <section
    class="relative flex min-h-[132px] flex-col gap-2.5 rounded-card border bg-surface p-4 shadow-card"
    :class="editing ? 'border-dashed border-brand-tintBorder ring-2 ring-brand-tint' : 'border-line'"
    data-cy="report-block"
    :data-metric="block.config.metric"
    :data-pdf-block="chart === 'number' ? undefined : chart === 'table' ? 'table' : 'image'"
    :data-pdf-title="block.title"
    :data-pdf-kpi="chart === 'number' ? '' : undefined"
    :aria-busy="loading || undefined"
  >
    <div class="flex items-start gap-2">
      <svg v-if="editing" class="mt-0.5 h-4 w-4 shrink-0 cursor-grab text-ink-faint2" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-pdf-skip>
        <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
      </svg>
      <h3 class="min-w-0 flex-1 text-[13.5px] font-semibold leading-snug text-ink-800" :class="chart === 'number' && 'text-[11px] font-medium uppercase tracking-wide text-ink-muted2'" data-pdf-label>
        {{ block.title }}
      </h3>
      <span v-if="periodTag" class="shrink-0 rounded-ctlSm bg-warning-bg px-1.5 py-0.5 text-[10.5px] font-semibold text-warning-text">{{ periodTag }}</span>
      <span v-if="block.origin && !editing && chart !== 'number'" class="hidden shrink-0 rounded-ctlSm bg-chip-bg px-1.5 py-0.5 text-[10.5px] font-semibold text-chip-text sm:inline" data-pdf-skip>{{ block.origin }}</span>
      <div v-if="editing" class="relative -mr-1.5 -mt-1 shrink-0" data-pdf-skip>
        <button type="button" class="flex h-7 w-7 items-center justify-center rounded-ctlSm text-ink-muted2 hover:bg-surface-subtle" data-cy="report-block-menu" :aria-label="t('Block options', 'Opciones del bloque')" @click="menuOpen = !menuOpen" @blur="closeMenuSoon">
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
        </button>
        <div v-if="menuOpen" class="absolute right-0 z-20 mt-1 w-52 rounded-ctl border border-line bg-surface p-1 text-[13px] shadow-popover">
          <button type="button" class="block w-full rounded-ctlSm px-2.5 py-1.5 text-left hover:bg-surface-subtle" data-cy="report-block-edit" @mousedown.prevent="emit('edit'); menuOpen = false">{{ t('Edit…', 'Editar…') }}</button>
          <div class="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint2">{{ t('Width', 'Ancho') }}</div>
          <div class="flex gap-1 px-2 pb-1.5">
            <button
              v-for="s in ([3, 4, 6, 8, 12] as const)"
              :key="s"
              type="button"
              class="h-7 flex-1 rounded-ctlSm border text-[11.5px]"
              :class="block.span === s ? 'border-brand bg-brand-tint font-semibold text-brand-text' : 'border-line-control text-ink-600 hover:bg-surface-subtle'"
              :data-cy="`report-block-span-${s}`"
              @mousedown.prevent="emit('resize', s)"
            >
              {{ { 3: '¼', 4: '⅓', 6: '½', 8: '⅔', 12: '1' }[s] }}
            </button>
          </div>
          <button type="button" class="block w-full rounded-ctlSm px-2.5 py-1.5 text-left hover:bg-surface-subtle" @mousedown.prevent="emit('move', -1); menuOpen = false">{{ t('Move earlier', 'Mover antes') }}</button>
          <button type="button" class="block w-full rounded-ctlSm px-2.5 py-1.5 text-left hover:bg-surface-subtle" @mousedown.prevent="emit('move', 1); menuOpen = false">{{ t('Move later', 'Mover después') }}</button>
          <button type="button" class="block w-full rounded-ctlSm px-2.5 py-1.5 text-left hover:bg-surface-subtle" @mousedown.prevent="emit('duplicate'); menuOpen = false">{{ t('Duplicate', 'Duplicar') }}</button>
          <button type="button" class="block w-full rounded-ctlSm px-2.5 py-1.5 text-left text-danger-text hover:bg-danger-bg" data-cy="report-block-remove" @mousedown.prevent="emit('remove'); menuOpen = false">{{ t('Remove', 'Quitar') }}</button>
        </div>
      </div>
    </div>

    <p v-if="unavailable" class="text-[12.5px] leading-snug text-ink-muted2" data-cy="report-block-unavailable">{{ unavailable }}</p>
    <p v-else-if="error" class="text-[12.5px] leading-snug text-danger-text">{{ t('Could not load: ', 'No se ha podido cargar: ') }}{{ error }}</p>
    <template v-else-if="loading || !result">
      <UiSkeleton v-if="chart === 'number'" class="h-[28px] w-24 rounded-ctlSm" />
      <UiSkeleton v-else class="h-40 w-full rounded-ctl" />
    </template>

    <template v-else-if="chart === 'number'">
      <p class="font-mono text-[26px] font-semibold leading-none tracking-tight text-ink-900" data-cy="report-block-value" data-pdf-value>{{ fmt(result.value) }}</p>
      <p class="text-[12px] text-ink-muted2" data-pdf-note>
        <template v-if="delta">
          <b :class="delta.up ? 'text-success-text' : 'text-danger-text'" class="font-semibold"><span aria-hidden="true" data-pdf-skip>{{ delta.up ? '▲' : '▼' }} </span>{{ delta.text }}</b>
          {{ compareLabel }}
        </template>
        <template v-if="wholeClinicDespiteFilter">{{ t('Whole clinic', 'Toda la clínica') }}</template>
      </p>
    </template>

    <div v-else-if="chart === 'funnel'" class="grid gap-3" :style="{ gridTemplateColumns: `repeat(${result.steps?.length ?? 1}, minmax(0, 1fr))` }" data-cy="report-block-funnel">
      <div v-for="(s, i) in result.steps" :key="s.label" class="flex min-w-0 flex-col gap-1.5">
        <span class="truncate text-[12px] text-ink-muted2">{{ s.label }}</span>
        <span class="relative h-11 overflow-hidden rounded-ctlSm bg-brand-tint">
          <span class="absolute inset-y-0 left-0 bg-brand" :style="{ width: `${(s.value / funnelMax) * 100}%`, opacity: 0.35 + 0.65 * (s.value / funnelMax) }" />
        </span>
        <span class="font-mono text-[12px]">
          <b class="text-[15px] text-ink-900">{{ s.value }}</b>
          <span v-if="i > 0 && result.steps![0]!.value" class="ml-1.5 text-ink-faint2">{{ Math.round((s.value / result.steps![0]!.value) * 100) }}%</span>
        </span>
      </div>
    </div>

    <p v-else-if="rows.length === 0" class="py-6 text-center text-[13px] text-ink-faint2">{{ t('Nothing in this period.', 'Nada en este periodo.') }}</p>

    <div v-else-if="chart === 'bar'" :style="{ height: chartHeight }"><Bar :data="chartData" :options="chartOptions" /></div>
    <div v-else-if="chart === 'line'" class="h-60"><Line :data="chartData" :options="chartOptions" /></div>
    <div v-else-if="chart === 'donut'" class="flex flex-wrap items-center gap-5">
      <div class="h-40 w-40 shrink-0"><Doughnut :data="donutData" :options="donutOptions" /></div>
      <ul class="min-w-[160px] flex-1 space-y-1.5 text-[12.5px]">
        <li v-for="(r, i) in rows" :key="r.key" class="flex items-center gap-2">
          <span class="h-2.5 w-2.5 shrink-0 rounded-sm" :style="{ background: PALETTE[i % PALETTE.length] }" />
          <span class="min-w-0 flex-1 truncate text-ink-600">{{ r.label }}</span>
          <span class="font-mono font-semibold text-ink-900">{{ fmt(r.value) }}</span>
        </li>
      </ul>
    </div>
    <div v-else-if="pivot" class="-mx-4 -mb-4 overflow-x-auto" data-cy="report-block-pivot">
      <table class="w-full text-[13px]">
        <thead class="border-b border-line text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted2">
          <tr>
            <th class="whitespace-nowrap px-4 py-1.5">{{ t(...SPLIT_LABELS[block.config.split]) }}</th>
            <th v-for="c in pivot.columns" :key="c.key" class="whitespace-nowrap px-3 py-1.5 text-right">{{ c.label }}</th>
            <th class="whitespace-nowrap px-4 py-1.5 text-right">{{ t('Total', 'Total') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line-row">
          <tr v-for="r in pivot.rows" :key="r.key">
            <td class="whitespace-nowrap px-4 py-1.5 text-ink-600">{{ r.label }}</td>
            <td v-for="c in pivot.columns" :key="c.key" class="px-3 py-1.5 text-right font-mono" :class="r.cells[c.key] ? 'font-medium text-ink-900' : 'text-ink-faint2'">{{ fmt(r.cells[c.key] ?? null) }}</td>
            <td class="px-4 py-1.5 text-right font-mono font-semibold text-ink-900">{{ fmt(r.value) }}</td>
          </tr>
          <tr v-if="pivot.rows.length > 1 && !isTime" class="bg-surface-subtle">
            <td class="px-4 py-1.5 font-semibold text-ink-800">{{ t('Total', 'Total') }}</td>
            <td v-for="c in pivot.columns" :key="c.key" class="px-3 py-1.5 text-right font-mono font-semibold text-ink-900">{{ fmt(pivot.columnTotals[c.key] ?? null) }}</td>
            <td class="px-4 py-1.5 text-right font-mono font-semibold text-ink-900">{{ fmt(pivot.value) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="-mx-4 -mb-4 overflow-x-auto">
      <table class="w-full text-[13px]">
        <thead class="border-b border-line text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted2">
          <tr>
            <th class="px-4 py-1.5">{{ t(...SPLIT_LABELS[block.config.split]) }}</th>
            <th class="px-4 py-1.5 text-right">{{ def ? t(...def.label) : '' }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line-row">
          <tr v-for="r in rows" :key="r.key">
            <td class="px-4 py-1.5 text-ink-600">{{ r.label }}</td>
            <td class="px-4 py-1.5 text-right font-mono font-medium text-ink-900">{{ fmt(r.value) }}</td>
          </tr>
          <tr v-if="tableTotal !== null && tableTotal !== undefined && !isTime" class="bg-surface-subtle">
            <td class="px-4 py-1.5 font-semibold text-ink-800">{{ t('Total', 'Total') }}</td>
            <td class="px-4 py-1.5 text-right font-mono font-semibold text-ink-900">{{ fmt(tableTotal) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

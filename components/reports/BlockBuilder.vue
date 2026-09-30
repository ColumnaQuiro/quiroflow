<script setup lang="ts">
import type { DateRange } from '~/composables/useDateRangePresets'
import { newBlockId, type ChartKind, type Compare, type OwnPeriod, type ReportBlock, type SplitKey } from '~/utils/reportBlocks'
import { AREAS, METRICS, METRIC_BY_KEY, SPLIT_LABELS, type Area } from '~/utils/reportMetrics'

// New report / Edit block: pick a metric from the catalogue, how to split it,
// how to draw it, and for which period -- with the block itself as the
// preview, on the page's own filters, so what you see is what you get.
const props = defineProps<{
  initial: ReportBlock | null
  range: DateRange
  compare: Compare
  practitionerId: string | null
  clinicId: string | null
  ownOnly: boolean
}>()
const emit = defineEmits<{ save: [block: ReportBlock, alsoSaveToLibrary: boolean]; cancel: [] }>()

const t = useT()
const { practitioners, clinics, load: loadFilterOptions } = useReportFilterOptions()
const { methods, ensureLoaded: ensureMethods } = usePaymentMethods()
onMounted(() => {
  loadFilterOptions()
  ensureMethods()
})

const metric = ref(props.initial?.config.metric ?? 'income_paid')
const split = ref<SplitKey>(props.initial?.config.split ?? 'none')
const chart = ref<ChartKind>(props.initial?.config.chart ?? 'number')
const practitionerFilter = ref(props.initial?.config.filters?.practitionerId ?? '')
const clinicFilter = ref(props.initial?.config.filters?.clinicId ?? '')
const methodFilter = ref(props.initial?.config.filters?.method ?? '')
const periodMode = ref<'page' | 'own'>(props.initial?.config.period?.mode ?? 'page')
const ownPreset = ref<OwnPeriod>(props.initial?.config.period?.mode === 'own' ? props.initial.config.period.preset : 'last_12_months')
const title = ref(props.initial?.title ?? '')
const titleTouched = ref(!!props.initial)
const alsoSave = ref(!props.initial)
const search = ref('')
const area = ref<Area>(METRIC_BY_KEY.get(metric.value)?.area ?? 'money')

const def = computed(() => METRIC_BY_KEY.get(metric.value)!)
const visibleMetrics = computed(() => {
  const q = search.value.trim().toLowerCase()
  const list = q ? METRICS.filter((m) => [...m.label, ...m.description].some((s) => s.toLowerCase().includes(q))) : METRICS.filter((m) => m.area === area.value)
  // Someone who sees only their own figures is not offered the clinic-wide ones.
  return props.ownOnly ? list.filter((m) => !m.clinicWide) : list
})

const charts = computed<{ key: ChartKind; label: string }[]>(() => {
  if (def.value.steps) return [{ key: 'funnel', label: t('Funnel', 'Embudo') }]
  if (split.value === 'none') return [{ key: 'number', label: t('Number', 'Número') }]
  return [
    { key: 'bar', label: t('Bar', 'Barras') },
    { key: 'line', label: t('Line', 'Líneas') },
    { key: 'donut', label: t('Donut', 'Anillo') },
    { key: 'table', label: t('Table', 'Tabla') },
  ]
})

// Keep the choices valid as the metric and split change.
watch(metric, () => {
  if (!def.value.splits.includes(split.value)) split.value = 'none'
  if (!def.value.permission && def.value.area !== 'money') methodFilter.value = ''
})
watch(
  [split, metric],
  () => {
    if (!charts.value.some((c) => c.key === chart.value)) chart.value = charts.value[0]!.key
    if (split.value !== 'none' && chart.value === 'number') chart.value = 'bar'
  },
  { immediate: true },
)
// The title follows the choices until someone types one.
const suggestedTitle = computed(() => {
  const m = t(...def.value.label)
  return split.value === 'none' ? m : `${m} ${t('by', 'por')} ${t(...SPLIT_LABELS[split.value]).toLowerCase()}`
})
watch(suggestedTitle, (v) => {
  if (!titleTouched.value) title.value = v
}, { immediate: true })

const draft = computed<ReportBlock>(() => ({
  id: props.initial?.id ?? 'preview',
  title: title.value.trim() || suggestedTitle.value,
  span: props.initial?.span ?? (split.value === 'none' || def.value.steps ? (def.value.steps ? 12 : 3) : 6),
  origin: props.initial?.origin ?? null,
  config: {
    metric: metric.value,
    split: split.value,
    chart: chart.value,
    filters:
      practitionerFilter.value || clinicFilter.value || methodFilter.value
        ? { practitionerId: practitionerFilter.value || null, clinicId: clinicFilter.value || null, method: methodFilter.value || null }
        : undefined,
    period: periodMode.value === 'own' ? { mode: 'own', preset: ownPreset.value } : { mode: 'page' },
  },
}))

function save() {
  emit('save', { ...draft.value, id: props.initial?.id ?? newBlockId() }, alsoSave.value)
}

const OWN_PERIODS = computed<{ key: OwnPeriod; label: string }[]>(() => [
  { key: 'last_3_months', label: t('Last 3 months', 'Últimos 3 meses') },
  { key: 'last_6_months', label: t('Last 6 months', 'Últimos 6 meses') },
  { key: 'last_12_months', label: t('Last 12 months', 'Últimos 12 meses') },
  { key: 'this_year', label: t('This year', 'Este año') },
  { key: 'last_year', label: t('Last year', 'Año pasado') },
])

const dialog = ref<HTMLElement | null>(null)
useFocusTrap(dialog, () => emit('cancel'))

const optionClass = (on: boolean) =>
  on ? 'border-brand-tintBorder bg-brand-tint font-semibold text-brand-text' : 'border-line-control bg-surface text-ink-600 hover:border-line-controlHover'
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" @click.self="emit('cancel')">
    <div ref="dialog" role="dialog" aria-modal="true" :aria-label="initial ? t('Edit block', 'Editar bloque') : t('New report', 'Nuevo informe')" class="flex max-h-[92vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-card bg-surface shadow-popover" data-cy="report-builder">
      <div class="flex h-14 shrink-0 items-center justify-between border-b border-line px-5">
        <h2 class="text-[16px] font-semibold text-ink-900">{{ initial ? t('Edit block', 'Editar bloque') : t('New report', 'Nuevo informe') }}</h2>
        <button type="button" class="flex h-8 w-8 items-center justify-center rounded-ctlSm text-[18px] text-ink-muted2 hover:bg-surface-subtle" :aria-label="t('Close', 'Cerrar')" @click="emit('cancel')">×</button>
      </div>

      <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div class="space-y-5 overflow-y-auto border-line p-5 lg:w-[460px] lg:shrink-0 lg:border-r">
          <div class="space-y-2">
            <p class="text-[11px] font-semibold uppercase tracking-wide text-ink-muted2">1 · {{ t('What to measure', 'Qué medir') }}</p>
            <input v-model="search" type="search" data-cy="report-builder-search" :placeholder="t(`Search ${METRICS.length} metrics…`, `Buscar entre ${METRICS.length} métricas…`)" class="h-9 w-full rounded-ctl border border-line-control px-3 text-[13px] focus:border-brand focus:outline-none" />
            <div v-if="!search" class="flex flex-wrap gap-1.5">
              <button v-for="a in AREAS" :key="a.key" type="button" class="h-8 rounded-ctl border px-2.5 text-[12.5px]" :class="optionClass(area === a.key)" @click="area = a.key">{{ t(...a.label) }}</button>
            </div>
            <div class="max-h-56 overflow-y-auto rounded-ctl border border-line p-1">
              <button
                v-for="m in visibleMetrics"
                :key="m.key"
                type="button"
                class="block w-full rounded-ctlSm px-2.5 py-1.5 text-left text-[13px]"
                :class="metric === m.key ? 'bg-brand-tint font-semibold text-brand-text' : 'text-ink-700 hover:bg-surface-subtle'"
                :data-cy="`report-metric-${m.key}`"
                @click="metric = m.key"
              >
                {{ t(...m.label) }}
              </button>
              <p v-if="visibleMetrics.length === 0" class="px-2.5 py-2 text-[12.5px] text-ink-faint2">{{ t('No metric matches.', 'Ninguna métrica coincide.') }}</p>
            </div>
            <p class="text-[12px] leading-snug text-ink-muted2">{{ t(...def.description) }}<template v-if="def.snapshot"> · {{ t('As of now: the period does not apply.', 'A día de hoy: el periodo no aplica.') }}</template></p>
          </div>

          <div v-if="def.splits.length > 1" class="space-y-2">
            <p class="text-[11px] font-semibold uppercase tracking-wide text-ink-muted2">2 · {{ t('Split by', 'Dividir por') }}</p>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="s in def.splits" :key="s" type="button" class="h-8 rounded-ctl border px-2.5 text-[12.5px]" :class="optionClass(split === s)" :data-cy="`report-split-${s}`" @click="split = s">
                {{ t(...SPLIT_LABELS[s]) }}
              </button>
            </div>
          </div>

          <div class="space-y-2">
            <p class="text-[11px] font-semibold uppercase tracking-wide text-ink-muted2">3 · {{ t('Show as', 'Mostrar como') }}</p>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="c in charts" :key="c.key" type="button" class="h-8 rounded-ctl border px-2.5 text-[12.5px]" :class="optionClass(chart === c.key)" :data-cy="`report-chart-${c.key}`" @click="chart = c.key">{{ c.label }}</button>
            </div>
          </div>

          <div v-if="!def.clinicWide" class="space-y-2">
            <p class="text-[11px] font-semibold uppercase tracking-wide text-ink-muted2">4 · {{ t('Only include', 'Incluir solo') }}</p>
            <div class="flex flex-wrap gap-2">
              <select v-if="!ownOnly" v-model="practitionerFilter" class="h-8 rounded-ctl border border-line-control bg-surface px-2.5 text-[12.5px]" :aria-label="t('Practitioner', 'Profesional')">
                <option value="">{{ t('Every practitioner on the page', 'Todos los profesionales de la página') }}</option>
                <option v-for="p in practitioners" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
              <select v-if="clinics.length > 1" v-model="clinicFilter" class="h-8 rounded-ctl border border-line-control bg-surface px-2.5 text-[12.5px]" :aria-label="t('Clinic', 'Clínica')">
                <option value="">{{ t('Every clinic on the page', 'Todas las clínicas de la página') }}</option>
                <option v-for="c in clinics" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
              <select v-if="def.area === 'money'" v-model="methodFilter" class="h-8 rounded-ctl border border-line-control bg-surface px-2.5 text-[12.5px]" :aria-label="t('Payment method', 'Método de pago')">
                <option value="">{{ t('Every payment method', 'Todos los métodos de pago') }}</option>
                <option v-for="m in methods" :key="m.key" :value="m.key">{{ m.name }}</option>
              </select>
            </div>
            <p class="text-[12px] text-ink-faint2">{{ t("The page's own filters still apply on top.", 'Los filtros de la página se siguen aplicando encima.') }}</p>
          </div>

          <div v-if="!def.snapshot" class="space-y-2">
            <p class="text-[11px] font-semibold uppercase tracking-wide text-ink-muted2">5 · {{ t('Period', 'Periodo') }}</p>
            <label class="flex items-center gap-2 text-[13px] text-ink-700"><input v-model="periodMode" type="radio" value="page" class="accent-brand" /> {{ t("Follow the page", 'Seguir la página') }}</label>
            <label class="flex items-center gap-2 text-[13px] text-ink-700">
              <input v-model="periodMode" type="radio" value="own" class="accent-brand" data-cy="report-period-own" /> {{ t('Its own:', 'El suyo:') }}
              <select v-model="ownPreset" class="h-8 rounded-ctl border border-line-control bg-surface px-2.5 text-[12.5px]" :disabled="periodMode !== 'own'" data-cy="report-period-preset">
                <option v-for="p in OWN_PERIODS" :key="p.key" :value="p.key">{{ p.label }}</option>
              </select>
            </label>
          </div>
        </div>

        <div class="min-h-[280px] flex-1 space-y-3 overflow-y-auto bg-surface-page p-5">
          <p class="text-[11px] font-semibold uppercase tracking-wide text-ink-muted2">{{ t('Preview', 'Vista previa') }}</p>
          <ReportsBlock :block="draft" :range="range" :compare="compare" :practitioner-id="practitionerId" :clinic-id="clinicId" :own-only="ownOnly" />
          <p class="text-[12px] text-ink-faint2">{{ t("The preview uses this page's filters, so this is what the block will show.", 'La vista previa usa los filtros de esta página: es lo que mostrará el bloque.') }}</p>
        </div>
      </div>

      <div class="flex shrink-0 flex-wrap items-center gap-3 border-t border-line px-5 py-3.5">
        <input
          v-model="title"
          type="text"
          maxlength="120"
          data-cy="report-builder-title"
          class="h-9 w-72 rounded-ctl border border-line-control px-3 text-[13px] focus:border-brand focus:outline-none"
          :aria-label="t('Title', 'Título')"
          @input="titleTouched = true"
        />
        <label v-if="!initial" class="flex items-center gap-2 text-[13px] text-ink-600">
          <input v-model="alsoSave" type="checkbox" class="accent-brand" data-cy="report-builder-save-to-library" />
          {{ t('Also save to Saved reports, to use on other pages', 'Guardar también en Informes guardados, para usarlo en otras páginas') }}
        </label>
        <span class="flex-1" />
        <UiBtn @click="emit('cancel')">{{ t('Cancel', 'Cancelar') }}</UiBtn>
        <UiBtn variant="primary" data-cy="report-builder-add" @click="save">{{ initial ? t('Save', 'Guardar') : t('Add to page', 'Añadir a la página') }}</UiBtn>
      </div>
    </div>
  </div>
</template>

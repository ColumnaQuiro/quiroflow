<script setup lang="ts">
import type { DateRange } from '~/composables/useDateRangePresets'
import { newBlockId, type ChartKind, type Compare, type OwnPeriod, type ReportBlock, type SplitKey } from '~/utils/reportBlocks'
import { AREAS, labelFor, metricLabel, METRICS, METRIC_BY_KEY, pivotColumnsFor, SPLIT_LABELS, type Area, type BookedVia } from '~/utils/reportMetrics'

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
const supabase = useSupabaseClient()
const appointmentTypes = ref<{ id: string; name: string; stage: string | null }[]>([])
const referralSources = ref<string[]>([])
onMounted(async () => {
  loadFilterOptions()
  ensureMethods()
  const [types, sources] = await Promise.all([
    // Archived types too: past visits were of them, and a filter on last year's offer has to find it.
    supabase.from('appointment_types').select('id, name, stage, archived_at').order('name'),
    supabase.from('referral_sources').select('name').order('name'),
  ])
  appointmentTypes.value = ((types.data ?? []) as { id: string; name: string; stage: string | null; archived_at: string | null }[]).sort((a, b) => Number(!!a.archived_at) - Number(!!b.archived_at))
  referralSources.value = ((sources.data ?? []) as { name: string }[]).map((r) => r.name)
})

const metric = ref(props.initial?.config.metric ?? 'income_paid')
const split = ref<SplitKey>(props.initial?.config.split ?? 'none')
const chart = ref<ChartKind>(props.initial?.config.chart ?? 'number')
// A second split across the top of a table ('' = none).
const columns = ref<SplitKey | ''>(props.initial?.config.columns ?? '')
const practitionerFilter = ref(props.initial?.config.filters?.practitionerId ?? '')
const clinicFilter = ref(props.initial?.config.filters?.clinicId ?? '')
const methodFilter = ref(props.initial?.config.filters?.method ?? '')
const typeFilter = ref<string[]>([...(props.initial?.config.filters?.typeIds ?? [])])
const stageFilter = ref<string[]>([...(props.initial?.config.filters?.stages ?? [])])
const referralFilter = ref(props.initial?.config.filters?.referralSource ?? '')
const bookedViaFilter = ref<BookedVia | ''>(props.initial?.config.filters?.bookedVia ?? '')
const visitNumber = ref<number>(props.initial?.config.params?.visitNumber ?? 3)
// '' = no limit, for a metric where that is allowed.
const withinDays = ref<number | ''>(props.initial?.config.params?.withinDays ?? '')
const periodMode = ref<'page' | 'own'>(props.initial?.config.period?.mode ?? 'page')
const ownPreset = ref<OwnPeriod>(props.initial?.config.period?.mode === 'own' ? props.initial.config.period.preset : 'last_12_months')
const title = ref(props.initial?.title ?? '')
const titleTouched = ref(!!props.initial)
const alsoSave = ref(!props.initial)
const search = ref('')
const area = ref<Area>(METRIC_BY_KEY.get(metric.value)?.area ?? 'money')

const def = computed(() => METRIC_BY_KEY.get(metric.value)!)
const honours = computed(() => new Set(def.value.filters ?? []))
const paramSpec = (key: 'visitNumber' | 'withinDays') => def.value.params?.find((p) => p.key === key) ?? null
const withinSpec = computed(() => paramSpec('withinDays'))
const params = computed(() => {
  if (!def.value.params) return undefined
  const out: { visitNumber?: number | null; withinDays?: number | null } = {}
  const n = paramSpec('visitNumber')
  if (n) out.visitNumber = Math.min(n.max, Math.max(n.min, Math.round(Number(visitNumber.value) || n.default || n.min)))
  const w = withinSpec.value
  if (w) out.withinDays = withinDays.value === '' ? w.default : Math.min(w.max, Math.max(w.min, Math.round(Number(withinDays.value))))
  return out
})
const STAGES = ['first_visit', 'first_visit_offer', 'report', 'adjustment', 'revision', 'maintenance', 'other']
const stageLabel = (s: string) => labelFor('stage', s, { member: new Map(), clinic: new Map(), type: new Map(), service: new Map(), package: new Map(), method: (k) => k }, t)
function toggle(list: string[], v: string) {
  const i = list.indexOf(v)
  if (i >= 0) list.splice(i, 1)
  else list.push(v)
}
// A metric that follows new patients filters the first visit they start from.
const followsNewPatients = computed(() => ['conversion_to_visit', 'first_visit_dropouts', 'income_per_new_patient'].includes(def.value.key))
const extraFilterCount = computed(() => typeFilter.value.length + stageFilter.value.length + (referralFilter.value ? 1 : 0) + (bookedViaFilter.value ? 1 : 0))
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

const columnChoices = computed(() => (chart.value === 'table' ? pivotColumnsFor(def.value, split.value) : []))

// Keep the choices valid as the metric and split change.
watch(metric, () => {
  if (!def.value.splits.includes(split.value)) split.value = 'none'
  if (!def.value.permission && def.value.area !== 'money') methodFilter.value = ''
  if (!honours.value.has('appointment_type')) typeFilter.value = []
  if (!honours.value.has('stage')) stageFilter.value = []
  if (!honours.value.has('referral_source')) referralFilter.value = ''
  if (!honours.value.has('booked_via')) bookedViaFilter.value = ''
  // Each metric's own default: no limit for conversion, 90 days for income.
  withinDays.value = props.initial?.config.metric === metric.value ? (props.initial.config.params?.withinDays ?? '') : (withinSpec.value?.default ?? '')
})
watch(
  [split, metric],
  () => {
    if (!charts.value.some((c) => c.key === chart.value)) chart.value = charts.value[0]!.key
    if (split.value !== 'none' && chart.value === 'number') chart.value = 'bar'
  },
  { immediate: true },
)
watch(columnChoices, (choices) => {
  if (columns.value && !choices.includes(columns.value)) columns.value = ''
})
// The title follows the choices until someone types one.
const suggestedTitle = computed(() => {
  const m = metricLabel(def.value, params.value, t)
  if (split.value === 'none') return m
  const by = `${m} ${t('by', 'por')} ${t(...SPLIT_LABELS[split.value]).toLowerCase()}`
  return columns.value ? `${by} ${t('and', 'y')} ${t(...SPLIT_LABELS[columns.value]).toLowerCase()}` : by
})
watch(suggestedTitle, (v) => {
  if (!titleTouched.value) title.value = v
}, { immediate: true })

const draft = computed<ReportBlock>(() => ({
  id: props.initial?.id ?? 'preview',
  title: title.value.trim() || suggestedTitle.value,
  span: props.initial?.span ?? (split.value === 'none' || def.value.steps ? (def.value.steps ? 12 : 3) : columns.value ? 12 : 6),
  origin: props.initial?.origin ?? null,
  config: {
    metric: metric.value,
    split: split.value,
    ...(columns.value ? { columns: columns.value } : {}),
    chart: chart.value,
    filters:
      practitionerFilter.value || clinicFilter.value || methodFilter.value || extraFilterCount.value
        ? {
            practitionerId: practitionerFilter.value || null,
            clinicId: clinicFilter.value || null,
            method: methodFilter.value || null,
            ...(typeFilter.value.length ? { typeIds: [...typeFilter.value] } : {}),
            ...(stageFilter.value.length ? { stages: [...stageFilter.value] } : {}),
            ...(referralFilter.value ? { referralSource: referralFilter.value } : {}),
            ...(bookedViaFilter.value ? { bookedVia: bookedViaFilter.value } : {}),
          }
        : undefined,
    ...(params.value ? { params: params.value } : {}),
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
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-scrim/40 sm:items-center sm:p-4" @click.self="emit('cancel')">
    <div ref="dialog" role="dialog" aria-modal="true" :aria-label="initial ? t('Edit block', 'Editar bloque') : t('New report', 'Nuevo informe')" class="flex max-h-[92vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-t-card bg-surface shadow-popover sm:rounded-card" data-cy="report-builder">
      <div class="flex h-14 shrink-0 items-center justify-between border-b border-line px-5">
        <h2 class="text-[16px] font-semibold text-ink-900">{{ initial ? t('Edit block', 'Editar bloque') : t('New report', 'Nuevo informe') }}</h2>
        <button type="button" class="flex h-8 w-8 items-center justify-center rounded-ctlSm text-ink-muted2 hover:bg-surface-subtle touch:h-11 touch:w-11" :aria-label="t('Close', 'Cerrar')" @click="emit('cancel')"><UiCloseIcon /></button>
      </div>

      <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div class="space-y-5 overflow-y-auto border-line p-5 lg:w-[460px] lg:shrink-0 lg:border-r">
          <div class="space-y-2">
            <p class="text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted2">1 · {{ t('What to measure', 'Qué medir') }}</p>
            <input v-model="search" type="search" data-cy="report-builder-search" :placeholder="t(`Search ${METRICS.length} metrics…`, `Buscar entre ${METRICS.length} métricas…`)" class="h-9 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] focus:border-brand focus:outline-none touch:h-11" />
            <div v-if="!search" class="flex flex-wrap gap-1.5">
              <button v-for="a in AREAS" :key="a.key" type="button" class="h-8 rounded-ctl border px-2.5 text-[12.5px] touch:h-11" :class="optionClass(area === a.key)" @click="area = a.key">{{ t(...a.label) }}</button>
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
            <div v-if="def.params" class="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-[13px] text-ink-700">
              <label v-if="paramSpec('visitNumber')" class="flex items-center gap-2">
                {{ t('Visit number', 'Visita número') }}
                <input
                  v-model.number="visitNumber"
                  type="number"
                  inputmode="numeric"
                  :min="paramSpec('visitNumber')!.min"
                  :max="paramSpec('visitNumber')!.max"
                  class="h-8 w-16 rounded-ctl border border-line-control bg-surface px-2 text-[13px] touch:h-11"
                  data-cy="report-builder-visit-number"
                />
              </label>
              <label v-if="withinSpec" class="flex items-center gap-2">
                {{ t('Within', 'En') }}
                <input
                  v-model.number="withinDays"
                  type="number"
                  inputmode="numeric"
                  :min="withinSpec.min"
                  :max="withinSpec.max"
                  :placeholder="withinSpec.default === null ? t('any', 'sin límite') : String(withinSpec.default)"
                  class="h-8 w-20 rounded-ctl border border-line-control bg-surface px-2 text-[13px] touch:h-11"
                  data-cy="report-builder-within-days"
                />
                {{ t('days of the first visit', 'días desde la primera visita') }}
              </label>
            </div>
          </div>

          <div v-if="def.splits.length > 1" class="space-y-2">
            <p class="text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted2">2 · {{ t('Split by', 'Dividir por') }}</p>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="s in def.splits" :key="s" type="button" class="h-8 rounded-ctl border px-2.5 text-[12.5px] touch:h-11" :class="optionClass(split === s)" :data-cy="`report-split-${s}`" @click="split = s">
                {{ t(...SPLIT_LABELS[s]) }}
              </button>
            </div>
          </div>

          <div class="space-y-2">
            <p class="text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted2">3 · {{ t('Show as', 'Mostrar como') }}</p>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="c in charts" :key="c.key" type="button" class="h-8 rounded-ctl border px-2.5 text-[12.5px] touch:h-11" :class="optionClass(chart === c.key)" :data-cy="`report-chart-${c.key}`" @click="chart = c.key">{{ c.label }}</button>
            </div>
            <label v-if="columnChoices.length" class="flex flex-wrap items-center gap-2 pt-1 text-[13px] text-ink-700">
              {{ t('Columns', 'Columnas') }}
              <select v-model="columns" class="h-8 rounded-ctl border border-line-control bg-surface px-2.5 text-[12.5px] touch:h-11" data-cy="report-builder-columns">
                <option value="">{{ t('None: one figure per row', 'Ninguna: una cifra por fila') }}</option>
                <option v-for="c in columnChoices" :key="c" :value="c">{{ t(...SPLIT_LABELS[c]) }}</option>
              </select>
            </label>
          </div>

          <div v-if="!def.clinicWide" class="space-y-2">
            <p class="text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted2">4 · {{ t('Only include', 'Incluir solo') }}</p>
            <div class="flex flex-wrap gap-2">
              <select v-if="!ownOnly" v-model="practitionerFilter" class="h-8 rounded-ctl border border-line-control bg-surface px-2.5 text-[12.5px] touch:h-11" :aria-label="t('Practitioner', 'Profesional')">
                <option value="">{{ t('Every practitioner on the page', 'Todos los profesionales de la página') }}</option>
                <option v-for="p in practitioners" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
              <select v-if="clinics.length > 1" v-model="clinicFilter" class="h-8 rounded-ctl border border-line-control bg-surface px-2.5 text-[12.5px] touch:h-11" :aria-label="t('Clinic', 'Clínica')">
                <option value="">{{ t('Every clinic on the page', 'Todas las clínicas de la página') }}</option>
                <option v-for="c in clinics" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
              <select v-if="def.area === 'money'" v-model="methodFilter" class="h-8 rounded-ctl border border-line-control bg-surface px-2.5 text-[12.5px] touch:h-11" :aria-label="t('Payment method', 'Método de pago')">
                <option value="">{{ t('Every payment method', 'Todos los métodos de pago') }}</option>
                <option v-for="m in methods" :key="m.key" :value="m.key">{{ m.name }}</option>
              </select>
            </div>
            <div v-if="honours.size" class="space-y-2.5 pt-1">
              <p v-if="followsNewPatients" class="text-[12px] text-ink-muted2">{{ t('These choose the first visit each new patient starts from; every later visit counts.', 'Eligen la primera visita de la que parte cada paciente nuevo; todas las visitas siguientes cuentan.') }}</p>
              <div v-if="honours.has('stage')" class="space-y-1.5">
                <p class="text-[12px] font-semibold text-ink-600">{{ followsNewPatients ? t('First visit', 'Primera visita') : t('Stage', 'Etapa') }}</p>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="s in followsNewPatients ? ['first_visit', 'first_visit_offer'] : STAGES"
                    :key="s"
                    type="button"
                    class="h-8 rounded-ctl border px-2.5 text-[12.5px] touch:h-11"
                    :class="optionClass(stageFilter.includes(s))"
                    :aria-pressed="stageFilter.includes(s)"
                    :data-cy="`report-filter-stage-${s}`"
                    @click="toggle(stageFilter, s)"
                  >
                    {{ followsNewPatients ? (s === 'first_visit' ? t('Without the offer', 'Sin oferta') : t('With the offer', 'Con oferta')) : stageLabel(s) }}
                  </button>
                </div>
              </div>
              <div v-if="honours.has('appointment_type') && appointmentTypes.length" class="space-y-1.5">
                <p class="text-[12px] font-semibold text-ink-600">{{ followsNewPatients ? t('Type of the first visit', 'Tipo de la primera visita') : t('Appointment type', 'Tipo de cita') }}</p>
                <div class="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                  <button
                    v-for="ty in followsNewPatients ? appointmentTypes.filter((x) => x.stage === 'first_visit' || x.stage === 'first_visit_offer') : appointmentTypes"
                    :key="ty.id"
                    type="button"
                    class="h-8 rounded-ctl border px-2.5 text-[12.5px] touch:h-11"
                    :class="optionClass(typeFilter.includes(ty.id))"
                    :aria-pressed="typeFilter.includes(ty.id)"
                    data-cy="report-filter-type"
                    @click="toggle(typeFilter, ty.id)"
                  >
                    {{ ty.name }}
                  </button>
                </div>
              </div>
              <div class="flex flex-wrap gap-2">
                <select v-if="honours.has('referral_source') && referralSources.length" v-model="referralFilter" class="h-8 rounded-ctl border border-line-control bg-surface px-2.5 text-[12.5px] touch:h-11" :aria-label="t('Referral source', 'Origen')" data-cy="report-filter-referral">
                  <option value="">{{ t('Every referral source', 'Todos los orígenes') }}</option>
                  <option v-for="r in referralSources" :key="r" :value="r">{{ r }}</option>
                </select>
                <select v-if="honours.has('booked_via')" v-model="bookedViaFilter" class="h-8 rounded-ctl border border-line-control bg-surface px-2.5 text-[12.5px] touch:h-11" :aria-label="t('Booked by', 'Reservada por')" data-cy="report-filter-booked-via">
                  <option value="">{{ t('Booked by anyone', 'Reservada por cualquiera') }}</option>
                  <option value="staff">{{ t('Booked by reception', 'Reservada por recepción') }}</option>
                  <option value="patient">{{ t('Booked online by the patient', 'Reservada online por el paciente') }}</option>
                </select>
              </div>
            </div>
            <p class="text-[12px] text-ink-faint2">{{ t("The page's own filters still apply on top.", 'Los filtros de la página se siguen aplicando encima.') }}</p>
          </div>

          <div v-if="!def.snapshot" class="space-y-2">
            <p class="text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted2">5 · {{ t('Period', 'Periodo') }}</p>
            <label class="flex items-center gap-2 text-[13px] text-ink-700"><input v-model="periodMode" type="radio" value="page" class="accent-brand" /> {{ t("Follow the page", 'Seguir la página') }}</label>
            <label class="flex items-center gap-2 text-[13px] text-ink-700">
              <input v-model="periodMode" type="radio" value="own" class="accent-brand" data-cy="report-period-own" /> {{ t('Its own:', 'El suyo:') }}
              <select v-model="ownPreset" class="h-8 rounded-ctl border border-line-control bg-surface px-2.5 text-[12.5px] touch:h-11" :disabled="periodMode !== 'own'" data-cy="report-period-preset">
                <option v-for="p in OWN_PERIODS" :key="p.key" :value="p.key">{{ p.label }}</option>
              </select>
            </label>
          </div>
        </div>

        <div class="min-h-[280px] flex-1 space-y-3 overflow-y-auto bg-surface-page p-5">
          <p class="text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted2">{{ t('Preview', 'Vista previa') }}</p>
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
          class="h-9 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] focus:border-brand focus:outline-none touch:h-11 sm:w-72"
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

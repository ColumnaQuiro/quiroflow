<script setup lang="ts">
// A report page on the phone: the viewing side of the web's
// pages/reports/pages/[id].vue -- the clinic's own dashboard, its blocks
// sharing one period, one comparison and one set of filters, opening on the
// period and comparison the page was saved with. The blocks are the web's own
// (components/reports/Block.vue) fed by the web's own loader
// (composables/useReportData.ts), so a figure here is the figure there; both
// would read the account store, which the app does not have, so this page
// provides a report viewer built from the practitioner context instead
// (utils/reportViewer.ts). The 12-column grid becomes one block per row, with
// the narrow ones (single figures, quarter and third widths) two to a row from
// md up. Read-only on purpose: editing, adding blocks, renaming, sharing,
// duplicating, deleting and the PDF stay on the web, where the page is built.
import { computePresetRange, type DateRange, type DateRangePreset } from '../../../../composables/useDateRangePresets'
import { REPORT_DATA_KEY, useReportDataHub } from '../../../../composables/useReportData'
import { normaliseBlocks, type Compare, type PagePeriod, type PageSettings, type ReportBlock } from '../../../../utils/reportBlocks'
import { METRIC_BY_KEY } from '../../../../utils/reportMetrics'
import { REPORT_VIEWER_KEY, type ReportViewer } from '../../../../utils/reportViewer'

definePageMeta({ layout: 'practitioner' })

const route = useRoute()
const supabase = useSupabaseClient()
const t = useT()
const { context, canOpen, reportsPractitionerId } = useReportAccess()
const { practitioners, clinics, load: loadFilterOptions } = useReportFilterOptions()

// What the blocks and the loader would have read from the store. Getters, so
// a block's "can I show this?" follows the context when it changes.
const viewer: ReportViewer = {
  get accountId() {
    return context.value?.accountId ?? null
  },
  get isOwner() {
    return context.value?.isOwner ?? false
  },
  get permissions() {
    return context.value?.permissions ?? {}
  },
  get hasGrowthAddon() {
    return context.value?.hasGrowth ?? false
  },
}
provide(REPORT_VIEWER_KEY, viewer)
const hub = useReportDataHub(viewer)
provide(REPORT_DATA_KEY, hub)

interface PageRow {
  id: string
  name: string
  visibility: string
  blocks: unknown
  settings: unknown
  created_by: string | null
  updated_at: string
}
const page = ref<PageRow | null>(null)
const author = ref('')
const notFound = ref(false)
const failed = ref(false)
const loading = ref(true)
const blocks = ref<ReportBlock[]>([])

const PERIODS = computed<{ key: Exclude<PagePeriod, 'custom'>; preset: DateRangePreset }[]>(() => [
  { key: 'last_7_days', preset: { label: t('Last 7 days', 'Últimos 7 días'), days: 7 } },
  { key: 'last_30_days', preset: { label: t('Last 30 days', 'Últimos 30 días'), days: 30 } },
  { key: 'this_month', preset: { label: t('This month', 'Este mes'), months: 1 } },
  { key: 'last_month', preset: { label: t('Last month', 'Mes pasado'), lastMonth: true } },
  { key: 'last_3_months', preset: { label: t('Last 3 months', 'Últimos 3 meses'), months: 3 } },
  { key: 'last_12_months', preset: { label: t('Last 12 months', 'Últimos 12 meses'), months: 12 } },
])
const range = ref<DateRange>(computePresetRange({ months: 1 }))
const compare = ref<Compare>('previous_period')
const practitionerFilter = ref(reportsPractitionerId.value ?? '')
const clinicFilter = ref('')
// "Only their own figures" pins the practitioner, as the web's useOwnScope
// does at setup -- here the context may arrive after setup, so it is pinned
// when it does, and the blocks get the locked id whatever the chip says.
watch(reportsPractitionerId, (id) => { if (id) practitionerFilter.value = id }, { immediate: true })
const pagePractitioner = computed(() => reportsPractitionerId.value || practitionerFilter.value || null)

const COMPARE_OPTIONS = computed(() => [
  { id: 'previous_period', name: t('Compare: previous period', 'Comparar: periodo anterior') },
  { id: 'previous_year', name: t('Compare: a year before', 'Comparar: un año antes') },
  { id: 'none', name: t('No comparison', 'Sin comparación') },
])
function setCompare(v: string) {
  if (v === 'none' || v === 'previous_period' || v === 'previous_year') compare.value = v
}

// The web's: the period and comparison the page was left on are what it opens with.
function applySettings(raw: unknown) {
  const s = (raw ?? {}) as PageSettings
  const preset = PERIODS.value.find((p) => p.key === s.period)
  if (preset) range.value = computePresetRange(preset.preset)
  else if (s.period === 'custom' && s.from && s.to) range.value = { from: s.from, to: s.to }
  if (s.compare === 'none' || s.compare === 'previous_period' || s.compare === 'previous_year') compare.value = s.compare
}

async function load() {
  loading.value = true
  failed.value = false
  notFound.value = false
  // The web reads "no row" as "not there, or not shared with you" -- RLS hides
  // someone else's private page. A failed read is not that: it says so and
  // offers to try again, rather than calling a page that exists missing.
  const { data, error } = await supabase.from('report_pages').select('id, name, visibility, blocks, settings, created_by, updated_at').eq('id', route.params.id as string).maybeSingle()
  if (error) {
    failed.value = true
    loading.value = false
    return
  }
  if (!data) {
    notFound.value = true
    loading.value = false
    return
  }
  page.value = data as PageRow
  blocks.value = normaliseBlocks(data.blocks)
  applySettings(data.settings)
  loading.value = false
  if (data.created_by) {
    const { data: member } = await supabase.from('team_members').select('full_name').eq('id', data.created_by).maybeSingle()
    author.value = member?.full_name ?? ''
  }
}
let started = false
// Only once the role is known to include reports, as debtors.vue: a refused
// read would come back empty and read as "this page does not exist".
watch(
  () => !!context.value && canOpen('/reports'),
  (ok) => {
    if (!ok || started) return
    started = true
    load()
    loadFilterOptions()
  },
  { immediate: true },
)

const updatedAt = ref(new Date())
function refresh() {
  hub.reset()
  updatedAt.value = new Date()
}
function retry() {
  if (page.value) refresh()
  else load()
}

const locale = computed(() => t('en-GB', 'es-ES'))
const meta = computed(() => {
  if (!page.value) return ''
  const who = page.value.visibility === 'clinic' ? t('Whole clinic', 'Toda la clínica') : t('Only me', 'Solo yo')
  const n = blocks.value.length
  const updated = `${t('Updated', 'Actualizado')} ${updatedAt.value.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })}`
  return [who, t(`${n} block${n === 1 ? '' : 's'}`, `${n} bloque${n === 1 ? '' : 's'}`), author.value && t(`by ${author.value}`, `de ${author.value}`), updated].filter(Boolean).join(' · ')
})

// Two to a row from md up only for what is narrow anyway: a single figure
// (Block.vue's own "a split with nothing to split is a number", funnels
// aside), or a block the web gives a quarter or a third of its width.
function narrow(b: ReportBlock): boolean {
  const def = METRIC_BY_KEY.get(b.config.metric)
  const isNumber = !def?.steps && (b.config.split === 'none' || b.config.chart === 'number')
  return isNumber || b.span <= 4
}
</script>

<template>
  <ReportScreen :title="page?.name ?? t('Report page', 'Página de informes')" path="/reports" :description="meta || undefined">
    <template v-if="page" #actions>
      <button
        type="button"
        class="-mr-1 flex h-11 w-11 shrink-0 items-center justify-center text-brand-text"
        :aria-label="t('Refresh', 'Actualizar')"
        data-cy="report-page-refresh"
        @click="refresh"
      >
        <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" /></svg>
      </button>
    </template>

    <template v-if="page" #filters>
      <ReportRangePicker v-model="range" :presets="PERIODS.map((p) => p.preset)" />
      <ReportSelect :model-value="compare" :options="COMPARE_OPTIONS" :label="t('Compare with', 'Comparar con')" data-cy="report-page-compare" @update:model-value="setCompare" />
      <ReportPeopleFilters v-model:practitioner-id="practitionerFilter" v-model:clinic-id="clinicFilter" :practitioners="practitioners" :clinics="clinics" :locked-to="reportsPractitionerId" />
    </template>

    <p v-if="failed" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text" role="alert" data-cy="report-page-failed">
      {{ t('Could not load the report.', 'No se ha podido cargar el informe.') }}
      <button type="button" class="ml-1 font-semibold underline" @click="retry">{{ t('Try again', 'Reintentar') }}</button>
    </p>
    <p v-else-if="notFound" class="rounded-card border border-line bg-surface px-3.5 py-3 text-[13.5px] text-ink-muted" data-cy="report-page-not-found">
      {{ t('This report page does not exist, or it is not shared with you.', 'Esta página de informes no existe o no está compartida contigo.') }}
    </p>
    <ReportsModule v-else-if="loading" :title="t('Report page', 'Página de informes')" loading skeleton="list" :rows="4" />
    <template v-else-if="page">
      <p v-if="blocks.length === 0" class="rounded-card border border-dashed border-line-control px-4 py-8 text-center text-[13.5px] text-ink-muted" data-cy="report-page-empty">
        {{ t('This page has no blocks yet.', 'Esta página todavía no tiene bloques.') }}
        {{ t('Blocks are added on the web.', 'Los bloques se añaden desde la web.') }}
      </p>
      <div v-else class="grid grid-cols-1 gap-3 md:grid-cols-2" data-cy="report-page-grid">
        <ReportsBlock
          v-for="b in blocks"
          :key="b.id"
          :data-block-id="b.id"
          class="min-w-0"
          :class="narrow(b) ? 'md:col-span-1' : 'md:col-span-2'"
          :block="b"
          :range="range"
          :compare="compare"
          :practitioner-id="pagePractitioner"
          :clinic-id="clinicFilter || null"
          :own-only="!!reportsPractitionerId"
        />
      </div>
    </template>
  </ReportScreen>
</template>

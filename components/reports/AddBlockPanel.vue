<script setup lang="ts">
import { newBlockId, reportLibrary, savedReportConfig, type ReportBlock } from '~/utils/reportBlocks'
import { METRIC_BY_KEY } from '~/utils/reportMetrics'

// "Add a block": a section of one of the standard reports, a report the
// clinic saved, or a new one built from the catalogue.
const props = defineProps<{ blocks: ReportBlock[]; ownOnly: boolean }>()
const emit = defineEmits<{ add: [block: ReportBlock]; build: []; close: [] }>()

const t = useT()
const supabase = useSupabaseClient()
const tab = ref<'reports' | 'saved'>('reports')
const search = ref('')

// See pages/reports/custom.vue's history: the Json type of `config` is
// recursive, so the rows are read as this narrower shape.
interface Saved {
  id: string
  name: string
  config: unknown
}
const saved = ref<Saved[]>([])
const savedLoading = ref(true)
async function loadSaved() {
  const { data } = await supabase.from('custom_reports').select('id, name, config').order('created_at', { ascending: false })
  saved.value = (data ?? []) as Saved[]
  savedLoading.value = false
}
onMounted(loadSaved)
defineExpose({ reload: loadSaved })

const onPage = (metric: string, split: string, chart: string) => props.blocks.some((b) => b.config.metric === metric && b.config.split === split && b.config.chart === chart)
const hidden = (metric: string) => props.ownOnly && !!METRIC_BY_KEY.get(metric)?.clinicWide

const q = computed(() => search.value.trim().toLowerCase())
const library = computed(() =>
  reportLibrary(t)
    .map((g) => ({ ...g, blocks: g.blocks.filter((b) => !hidden(b.config.metric) && (!q.value || b.title.toLowerCase().includes(q.value) || g.report.toLowerCase().includes(q.value))) }))
    .filter((g) => g.blocks.length > 0),
)
const savedBlocks = computed(() =>
  saved.value
    .map((s) => ({ saved: s, config: savedReportConfig(s.config) }))
    .filter((s): s is { saved: Saved; config: NonNullable<ReturnType<typeof savedReportConfig>> } => !!s.config && !hidden(s.config.metric))
    .filter((s) => !q.value || s.saved.name.toLowerCase().includes(q.value)),
)

const KIND: Record<string, [string, string]> = {
  number: ['Number', 'Número'],
  bar: ['Bar', 'Barras'],
  line: ['Line', 'Líneas'],
  donut: ['Donut', 'Anillo'],
  table: ['Table', 'Tabla'],
  funnel: ['Funnel', 'Embudo'],
}

function addPreset(p: Omit<ReportBlock, 'id'>) {
  emit('add', { ...p, id: newBlockId() })
}
function addSaved(s: { saved: Saved; config: NonNullable<ReturnType<typeof savedReportConfig>> }) {
  emit('add', { id: newBlockId(), title: s.saved.name, span: s.config.split === 'none' ? 3 : 6, config: s.config, origin: t('Saved report', 'Informe guardado') })
}

// Deleting a saved report takes it out of the list only; blocks already made
// from it are copies and stay on their pages.
const removing = ref<Saved | null>(null)
async function confirmRemove() {
  const r = removing.value
  if (!r) return
  const { error } = await supabase.from('custom_reports').delete().eq('id', r.id)
  removing.value = null
  if (!error) saved.value = saved.value.filter((s) => s.id !== r.id)
}
</script>

<template>
  <aside class="flex h-full w-full flex-col border-l border-line bg-surface sm:w-[380px]" data-cy="report-add-panel">
    <div class="space-y-3 border-b border-line p-4">
      <div class="flex items-center justify-between">
        <h2 class="text-[15px] font-semibold text-ink-900">{{ t('Add a block', 'Añadir un bloque') }}</h2>
        <button type="button" class="flex h-8 w-8 items-center justify-center rounded-ctlSm text-[18px] text-ink-muted2 hover:bg-surface-subtle" :aria-label="t('Close', 'Cerrar')" @click="emit('close')">×</button>
      </div>
      <div class="flex gap-1 rounded-ctl bg-surface-subtle p-1 text-[12.5px]">
        <button type="button" class="h-8 flex-1 rounded-ctlSm" :class="tab === 'reports' ? 'bg-surface font-semibold text-ink-900 shadow-card' : 'text-ink-muted2'" data-cy="report-add-tab-reports" @click="tab = 'reports'">{{ t('From reports', 'De los informes') }}</button>
        <button type="button" class="h-8 flex-1 rounded-ctlSm" :class="tab === 'saved' ? 'bg-surface font-semibold text-ink-900 shadow-card' : 'text-ink-muted2'" data-cy="report-add-tab-saved" @click="tab = 'saved'">
          {{ t('Saved', 'Guardados') }}<template v-if="!savedLoading"> · {{ savedBlocks.length }}</template>
        </button>
        <button type="button" class="h-8 flex-1 rounded-ctlSm text-ink-muted2 hover:text-ink-900" data-cy="report-add-new" @click="emit('build')">{{ t('New report', 'Nuevo informe') }}</button>
      </div>
      <input v-model="search" type="search" :placeholder="t('Search: income, retention, no-show…', 'Buscar: ingresos, retención, no presentados…')" class="h-9 w-full rounded-ctl border border-line-control px-3 text-[13px] focus:border-brand focus:outline-none" />
    </div>

    <div class="flex-1 space-y-4 overflow-y-auto p-4">
      <template v-if="tab === 'reports'">
        <div v-for="g in library" :key="g.report" class="space-y-0.5">
          <p class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint2">{{ g.report }}</p>
          <div v-for="b in g.blocks" :key="b.title" class="flex items-center gap-2.5 rounded-ctlSm px-2 py-1.5 hover:bg-surface-subtle">
            <span class="w-14 shrink-0 rounded-ctlSm bg-chip-bg px-1.5 py-0.5 text-center text-[10.5px] font-semibold text-chip-text">{{ t(...KIND[b.config.chart]!) }}</span>
            <span class="min-w-0 flex-1 truncate text-[13px] text-ink-800">{{ b.title }}</span>
            <span v-if="onPage(b.config.metric, b.config.split, b.config.chart)" class="shrink-0 rounded-ctlSm bg-success-bg px-1.5 py-0.5 text-[10.5px] font-semibold text-success-text">{{ t('On page', 'En la página') }}</span>
            <UiBtn size="sm" class="shrink-0" :data-cy="`report-add-${b.config.metric}-${b.config.split}`" @click="addPreset(b)">+ {{ t('Add', 'Añadir') }}</UiBtn>
          </div>
        </div>
        <p v-if="library.length === 0" class="text-[13px] text-ink-faint2">{{ t('Nothing matches.', 'Nada coincide.') }}</p>
      </template>

      <template v-else>
        <UiSkeleton v-if="savedLoading" class="h-24 w-full rounded-ctl" />
        <p v-else-if="savedBlocks.length === 0" class="text-[13px] leading-snug text-ink-faint2">
          {{ t('No saved reports yet. Build one with New report and tick "Also save to Saved reports".', 'Todavía no hay informes guardados. Crea uno con Nuevo informe y marca "Guardar también en Informes guardados".') }}
        </p>
        <div v-for="s in savedBlocks" :key="s.saved.id" class="flex items-center gap-2.5 rounded-ctlSm px-2 py-1.5 hover:bg-surface-subtle" data-cy="report-saved-row">
          <span class="w-14 shrink-0 rounded-ctlSm bg-chip-bg px-1.5 py-0.5 text-center text-[10.5px] font-semibold text-chip-text">{{ t(...KIND[s.config.split === 'none' ? 'number' : s.config.chart]!) }}</span>
          <span class="min-w-0 flex-1 truncate text-[13px] text-ink-800">{{ s.saved.name }}</span>
          <button type="button" class="shrink-0 rounded-ctlSm px-1.5 text-[12px] text-ink-faint2 hover:text-danger-text" :aria-label="t('Delete saved report', 'Eliminar informe guardado')" @click="removing = s.saved">✕</button>
          <UiBtn size="sm" class="shrink-0" data-cy="report-add-saved" @click="addSaved(s)">+ {{ t('Add', 'Añadir') }}</UiBtn>
        </div>
      </template>
    </div>

    <UiConfirmDialog
      v-if="removing"
      :title="t(`Delete the saved report “${removing.name}”?`, `¿Eliminar el informe guardado «${removing.name}»?`)"
      :confirm-label="t('Delete', 'Eliminar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      tone="danger"
      @confirm="confirmRemove"
      @cancel="removing = null"
    >
      {{ t('It goes from Saved reports for everyone in the clinic. Blocks already made from it stay on their pages.', 'Desaparece de Informes guardados para toda la clínica. Los bloques ya creados a partir de él se quedan en sus páginas.') }}
    </UiConfirmDialog>
  </aside>
</template>

<script setup lang="ts">
import { computePresetRange, type DateRange, type DateRangePreset } from '~/composables/useDateRangePresets'
import { REPORT_DATA_KEY, useReportDataHub } from '~/composables/useReportData'
import { newBlockId, normaliseBlocks, SPAN_CLASS, type Compare, type PagePeriod, type PageSettings, type ReportBlock } from '~/utils/reportBlocks'

// A report page: the clinic's own dashboard, a grid of blocks sharing one
// period and one set of filters, downloadable as a PDF. Editing saves as it
// goes, so nothing is lost to a closed tab.
const route = useRoute()
const router = useRouter()
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const toast = useToast()
const { reportsPractitionerId } = useOwnScope()
const { practitioners, clinics, load: loadFilterOptions } = useReportFilterOptions()

const hub = useReportDataHub()
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

function applySettings(raw: unknown) {
  const s = (raw ?? {}) as PageSettings
  const preset = PERIODS.value.find((p) => p.key === s.period)
  if (preset) range.value = computePresetRange(preset.preset)
  else if (s.period === 'custom' && s.from && s.to) range.value = { from: s.from, to: s.to }
  if (s.compare === 'none' || s.compare === 'previous_period' || s.compare === 'previous_year') compare.value = s.compare
}
function currentSettings(): PageSettings {
  const preset = PERIODS.value.find((p) => {
    const r = computePresetRange(p.preset)
    return r.from === range.value.from && r.to === range.value.to
  })
  return preset ? { period: preset.key, compare: compare.value } : { period: 'custom', from: range.value.from, to: range.value.to, compare: compare.value }
}

async function load() {
  const { data } = await supabase.from('report_pages').select('id, name, visibility, blocks, settings, created_by, updated_at').eq('id', route.params.id as string).maybeSingle()
  if (!data) {
    notFound.value = true
    return
  }
  page.value = data as PageRow
  blocks.value = normaliseBlocks(data.blocks)
  applySettings(data.settings)
  if (data.created_by) {
    const { data: member } = await supabase.from('team_members').select('full_name').eq('id', data.created_by).maybeSingle()
    author.value = member?.full_name ?? ''
  }
  if (route.query.edit === '1' && canEdit.value) editing.value = true
}
onMounted(() => {
  load()
  loadFilterOptions()
})

const canEdit = computed(() => !!page.value && (store.isOwner || (!!page.value.created_by && page.value.created_by === store.teamMember?.id)))

// ---- Editing: saved as it goes ----------------------------------------------
const editing = ref(false)
const saveState = ref<'idle' | 'saving' | 'saved' | 'failed'>('idle')
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saving: Promise<void> = Promise.resolve()

async function persist(patch: Partial<Pick<PageRow, 'name' | 'visibility'>> & { blocks?: ReportBlock[]; settings?: PageSettings }) {
  if (!page.value) return
  saveState.value = 'saving'
  const { data, error } = await supabase
    .from('report_pages')
    .update(patch as never)
    .eq('id', page.value.id)
    .select('id')
  if (error || !data?.length) {
    saveState.value = 'failed'
    toast.showToast(t('The page was not saved: ', 'La página no se ha guardado: ') + (error?.message ?? t('you cannot change it.', 'no puedes modificarla.')), 'error')
    return
  }
  saveState.value = 'saved'
}
function scheduleSave() {
  if (!editing.value) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    saving = saving.then(() => persist({ blocks: blocks.value }))
  }, 500)
}
watch(blocks, scheduleSave, { deep: true })

async function finishEditing() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  // The period and comparison it is left on become what it opens with.
  saving = saving.then(() => persist({ blocks: blocks.value, settings: currentSettings(), name: nameDraft.value.trim() || page.value!.name }))
  await saving
  if (saveState.value !== 'failed') {
    page.value!.name = nameDraft.value.trim() || page.value!.name
    editing.value = false
    showPanel.value = false
    if (route.query.edit) router.replace({ query: {} })
  }
}
const nameDraft = ref('')
watch(editing, (on) => {
  if (on) nameDraft.value = page.value?.name ?? ''
})
onBeforeRouteLeave(() => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    persist({ blocks: blocks.value })
  }
})

// ---- Blocks -----------------------------------------------------------------
const showPanel = ref(false)
const builderFor = ref<ReportBlock | 'new' | null>(null)

function addBlock(b: ReportBlock) {
  blocks.value.push(b)
  nextTick(() => document.querySelector(`[data-block-id="${b.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
}
async function onBuilt(b: ReportBlock, alsoSave: boolean) {
  const existing = blocks.value.findIndex((x) => x.id === b.id)
  if (existing >= 0) blocks.value.splice(existing, 1, b)
  else addBlock(b)
  builderFor.value = null
  if (alsoSave && store.accountId) {
    const { error } = await supabase.from('custom_reports').insert({ account_id: store.accountId, name: b.title, config: { v: 2, ...b.config } as never, created_by: store.teamMember?.id ?? null })
    if (error) toast.showToast(t('Added to the page, but not to Saved reports: ', 'Añadido a la página, pero no a Informes guardados: ') + error.message, 'error')
  }
}
function removeBlock(i: number) {
  blocks.value.splice(i, 1)
}
function duplicateBlock(i: number) {
  const b = blocks.value[i]!
  blocks.value.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(b)), id: newBlockId() })
}
function moveBlock(i: number, by: -1 | 1) {
  const j = i + by
  if (j < 0 || j >= blocks.value.length) return
  const [b] = blocks.value.splice(i, 1)
  blocks.value.splice(j, 0, b!)
}

// Drag to reorder: dropped onto a block, it takes that block's place.
const dragging = ref<number | null>(null)
function onDrop(target: number) {
  const from = dragging.value
  dragging.value = null
  if (from === null || from === target) return
  const [b] = blocks.value.splice(from, 1)
  blocks.value.splice(target, 0, b!)
}

// ---- Page menu --------------------------------------------------------------
const menuOpen = ref(false)
const confirmingDelete = ref(false)
async function toggleVisibility() {
  if (!page.value) return
  const next = page.value.visibility === 'clinic' ? 'private' : 'clinic'
  await persist({ visibility: next })
  if (saveState.value !== 'failed') page.value.visibility = next
  menuOpen.value = false
}
async function duplicatePage() {
  if (!page.value || !store.accountId) return
  menuOpen.value = false
  const { data, error } = await supabase
    .from('report_pages')
    .insert({
      account_id: store.accountId,
      name: t(`${page.value.name} (copy)`, `${page.value.name} (copia)`),
      visibility: 'private',
      blocks: blocks.value as never,
      settings: currentSettings() as never,
      created_by: store.teamMember?.id ?? null,
    })
    .select('id')
    .single()
  if (error || !data) {
    toast.showToast(t('Could not duplicate the page: ', 'No se ha podido duplicar la página: ') + (error?.message ?? ''), 'error')
    return
  }
  router.push(`/reports/pages/${data.id}`)
}
async function deletePage() {
  if (!page.value) return
  const { data, error } = await supabase.from('report_pages').delete().eq('id', page.value.id).select('id')
  confirmingDelete.value = false
  if (error || !data?.length) {
    toast.showToast(t('The page was not deleted.', 'La página no se ha eliminado.'), 'error')
    return
  }
  router.push('/reports')
}

// ---- Around the grid --------------------------------------------------------
const gridRoot = ref<HTMLElement | null>(null)
// The page is photographed as it stands; editing it halfway through would
// put half an edit in the file.
const pdfBusy = ref(false)
const updatedAt = ref(new Date())
function refresh() {
  hub.reset()
  updatedAt.value = new Date()
}
const compareText = computed(
  () => ({ none: '', previous_period: t('Compared with the previous period', 'Comparado con el periodo anterior'), previous_year: t('Compared with a year before', 'Comparado con un año antes') })[compare.value],
)
const meta = computed(() => {
  if (!page.value) return ''
  const who = page.value.visibility === 'clinic' ? t('Whole clinic', 'Toda la clínica') : t('Only me', 'Solo yo')
  const n = blocks.value.length
  return [who, t(`${n} block${n === 1 ? '' : 's'}`, `${n} bloque${n === 1 ? '' : 's'}`), author.value && t(`by ${author.value}`, `de ${author.value}`)].filter(Boolean).join(' · ')
})
</script>

<template>
  <div class="flex h-full flex-col">
    <div v-if="notFound" class="p-6">
      <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Reports', 'Informes') }}</NuxtLink>
      <p class="mt-4 text-[14px] text-ink-700" data-cy="report-page-not-found">{{ t('This report page does not exist, or it is not shared with you.', 'Esta página de informes no existe o no está compartida contigo.') }}</p>
    </div>

    <template v-else>
      <header class="flex shrink-0 flex-col gap-2.5 border-b border-line bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div class="min-w-0">
          <NuxtLink to="/reports" class="text-[12.5px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Reports', 'Informes') }}</NuxtLink>
          <div class="flex flex-wrap items-baseline gap-x-2.5">
            <input
              v-if="editing"
              v-model="nameDraft"
              type="text"
              maxlength="120"
              data-cy="report-page-name"
              class="-ml-1.5 h-8 min-w-[240px] rounded-ctl border border-line-control px-1.5 text-[18px] font-[640] text-ink-900 focus:border-brand focus:outline-none"
              :aria-label="t('Page name', 'Nombre de la página')"
            />
            <h1 v-else class="truncate text-[18px] font-[640] tracking-tightTitle text-ink-900" data-cy="report-page-title">
              <UiSkeleton v-if="!page" class="inline-block h-5 w-48 rounded-ctlSm align-middle" />
              <template v-else>{{ page.name }}</template>
            </h1>
            <p class="text-[12.5px] text-ink-muted2">{{ editing ? t('Editing', 'Editando') : meta }}</p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <template v-if="editing">
            <span class="text-[12px] text-ink-faint2" data-cy="report-page-save-state">
              {{ { idle: t('Drag a block to move it', 'Arrastra un bloque para moverlo'), saving: t('Saving…', 'Guardando…'), saved: t('Saved', 'Guardado'), failed: t('Not saved', 'Sin guardar') }[saveState] }}
            </span>
            <UiBtn data-cy="report-page-add" @click="showPanel = true">+ {{ t('Add a block', 'Añadir un bloque') }}</UiBtn>
            <UiBtn variant="primary" data-cy="report-page-done" @click="finishEditing">{{ t('Done', 'Hecho') }}</UiBtn>
          </template>
          <template v-else-if="page">
            <UiBtn v-if="canEdit" data-cy="report-page-edit" :disabled="pdfBusy" @click="editing = true">{{ t('Edit page', 'Editar página') }}</UiBtn>
            <ReportsPdfButton
              :target="gridRoot"
              :title="page.name"
              :range="range"
              :practitioner-id="practitionerFilter || null"
              :clinic-id="clinicFilter || null"
              :extra="compareText ? [compareText] : []"
              @busy="(on: boolean) => (pdfBusy = on)"
            />
            <div class="relative">
              <UiBtn :aria-label="t('More', 'Más')" data-cy="report-page-menu" @click="menuOpen = !menuOpen">⋯</UiBtn>
              <div v-if="menuOpen" class="absolute right-0 z-30 mt-1 w-56 rounded-ctl border border-line bg-surface p-1 text-[13px] shadow-popover">
                <button type="button" class="block w-full rounded-ctlSm px-2.5 py-1.5 text-left hover:bg-surface-subtle" data-cy="report-page-duplicate" @click="duplicatePage">{{ t('Duplicate', 'Duplicar') }}</button>
                <button v-if="canEdit" type="button" class="block w-full rounded-ctlSm px-2.5 py-1.5 text-left hover:bg-surface-subtle" data-cy="report-page-visibility" @click="toggleVisibility">
                  {{ page.visibility === 'clinic' ? t('Make it only mine', 'Que sea solo mía') : t('Share with the whole clinic', 'Compartir con toda la clínica') }}
                </button>
                <button v-if="canEdit" type="button" class="block w-full rounded-ctlSm px-2.5 py-1.5 text-left text-danger-text hover:bg-danger-bg" data-cy="report-page-delete" @click="confirmingDelete = true; menuOpen = false">{{ t('Delete page', 'Eliminar página') }}</button>
              </div>
            </div>
          </template>
        </div>
      </header>

      <div class="flex min-h-0 flex-1">
        <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-[18px] sm:px-6">
          <div class="flex flex-wrap items-center gap-2">
            <ReportsDateRangeSelect v-model="range" :presets="PERIODS.map((p) => p.preset)" />
            <select v-model="compare" data-cy="report-page-compare" class="h-8 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-500 focus:border-brand focus:outline-none" :aria-label="t('Compare with', 'Comparar con')">
              <option value="previous_period">{{ t('Compare: previous period', 'Comparar: periodo anterior') }}</option>
              <option value="previous_year">{{ t('Compare: a year before', 'Comparar: un año antes') }}</option>
              <option value="none">{{ t('No comparison', 'Sin comparación') }}</option>
            </select>
            <ReportsPractitionerClinicFilters v-model:practitioner-id="practitionerFilter" v-model:clinic-id="clinicFilter" :practitioners="practitioners" :clinics="clinics" :locked-to="reportsPractitionerId" />
            <span class="flex-1" />
            <button type="button" class="text-[12px] text-ink-faint2 hover:text-ink-600" data-cy="report-page-refresh" @click="refresh">
              {{ t('Updated', 'Actualizado') }} {{ updatedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }} · {{ t('Refresh', 'Actualizar') }}
            </button>
          </div>

          <div ref="gridRoot" class="mt-4 grid grid-cols-12 gap-3.5" data-cy="report-page-grid">
            <ReportsBlock
              v-for="(b, i) in blocks"
              :key="b.id"
              :data-block-id="b.id"
              :class="[SPAN_CLASS[b.span], dragging === i && 'opacity-40']"
              :block="b"
              :range="range"
              :compare="compare"
              :practitioner-id="practitionerFilter || null"
              :clinic-id="clinicFilter || null"
              :own-only="!!reportsPractitionerId"
              :editing="editing"
              :draggable="editing"
              @dragstart="dragging = i"
              @dragend="dragging = null"
              @dragover.prevent
              @drop.prevent="onDrop(i)"
              @edit="builderFor = b"
              @remove="removeBlock(i)"
              @duplicate="duplicateBlock(i)"
              @resize="(s: ReportBlock['span']) => (b.span = s)"
              @move="(by: -1 | 1) => moveBlock(i, by)"
            />
            <button
              v-if="editing"
              type="button"
              class="col-span-12 flex min-h-[120px] items-center justify-center gap-1.5 rounded-card border-2 border-dashed border-line-control text-[13px] text-ink-muted2 hover:border-brand-tintBorder hover:text-brand-text lg:col-span-6"
              data-pdf-skip
              @click="showPanel = true"
            >
              + {{ t('Add a block here', 'Añadir un bloque aquí') }}
            </button>
            <div v-else-if="page && blocks.length === 0" class="col-span-12 rounded-card border border-dashed border-line-control p-10 text-center text-[13px] text-ink-muted2">
              {{ t('This page has no blocks yet.', 'Esta página todavía no tiene bloques.') }}
              <UiBtn v-if="canEdit" class="ml-2" size="sm" @click="editing = true; showPanel = true">+ {{ t('Add a block', 'Añadir un bloque') }}</UiBtn>
            </div>
          </div>
        </div>

        <ReportsAddBlockPanel
          v-if="editing && showPanel"
          class="fixed inset-y-0 right-0 z-40 shadow-popover sm:static sm:z-auto sm:shadow-none"
          :blocks="blocks"
          :own-only="!!reportsPractitionerId"
          @add="addBlock"
          @build="builderFor = 'new'"
          @close="showPanel = false"
        />
      </div>
    </template>

    <ReportsBlockBuilder
      v-if="builderFor"
      :initial="builderFor === 'new' ? null : builderFor"
      :range="range"
      :compare="compare"
      :practitioner-id="practitionerFilter || null"
      :clinic-id="clinicFilter || null"
      :own-only="!!reportsPractitionerId"
      @save="onBuilt"
      @cancel="builderFor = null"
    />

    <UiConfirmDialog
      v-if="confirmingDelete && page"
      :title="t(`Delete “${page.name}”?`, `¿Eliminar «${page.name}»?`)"
      :confirm-label="t('Delete page', 'Eliminar página')"
      :cancel-label="t('Cancel', 'Cancelar')"
      tone="danger"
      @confirm="deletePage"
      @cancel="confirmingDelete = false"
    >
      {{
        page.visibility === 'clinic'
          ? t('It goes for everyone in the clinic. The figures themselves are not affected.', 'Desaparece para toda la clínica. Las cifras en sí no se ven afectadas.')
          : t('The figures themselves are not affected.', 'Las cifras en sí no se ven afectadas.')
      }}
    </UiConfirmDialog>
  </div>
</template>

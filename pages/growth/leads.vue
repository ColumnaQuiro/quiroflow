<script setup lang="ts">
import type { GrowthLead, GrowthLeadColumn } from '~/composables/useGrowthLeads'

const t = useT()
const route = useRoute()
const { can } = usePermission()
const { hasGrowth, resolved } = useGrowthTier()
const { columns, summary, loading, error, moveLead } = useGrowthLeads()
const { lead: openLead, loading: leadLoading, loadLead, close: closeLead } = useGrowthLeadDetail()

// Same key that gates the Growth dashboard and Campaigns -- see
// pages/growth/index.vue for why this reuses communication_config.
const allowed = computed(() => can('communication_config'))

// ?state=empty and ?state=loading render artboards 1j and 1k against the same
// page rather than as separate routes, so the three states cannot drift apart
// and the empty state is reachable without emptying an account.
const forcedState = computed(() => route.query.state)
const showEmpty = computed(() => forcedState.value === 'empty' || (!loading.value && columns.value.every((c) => !c.cards.length)))
const showLoading = computed(() => forcedState.value === 'loading' || !resolved.value || loading.value)

const search = ref('')
const view = ref<'board' | 'table'>('board')

const visibleColumns = computed<GrowthLeadColumn[]>(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return columns.value
  // Filters the cards but leaves count and value alone: those describe the
  // stage, not the search, and rewriting them would make a search look like
  // the pipeline had shrunk.
  return columns.value.map((c) => ({ ...c, cards: c.cards.filter((l) => l.name.toLowerCase().includes(term)) }))
})

const draggingId = ref<string | null>(null)
const dropTargetKey = ref<string | null>(null)

function onDragStart(lead: GrowthLead) {
  draggingId.value = lead.id
}
function onDragEnd() {
  draggingId.value = null
  dropTargetKey.value = null
}
function onDragEnter(key: string) {
  if (draggingId.value) dropTargetKey.value = key
}
function onDrop(key: string) {
  if (draggingId.value) moveLead(draggingId.value, key)
  onDragEnd()
}

function onOpen(lead: GrowthLead) {
  loadLead(lead.id)
}
</script>

<template>
  <PageHeader
    :title="t('Leads', 'Contactos')"
    :meta="summary && !showEmpty && !showLoading
      ? `${summary.openLeads} ${t('open leads', 'contactos abiertos')} · ${summary.estimatedValue} ${t('estimated value', 'de valor estimado')}`
      : undefined"
  >
    <div v-if="!showEmpty" class="flex h-8 items-center rounded-ctl border border-line-control bg-surface p-0.5">
      <button
        v-for="opt in (['board', 'table'] as const)"
        :key="opt"
        type="button"
        class="h-7 rounded-ctlSm px-2.5 text-[12px] font-medium"
        :class="view === opt ? 'bg-brand-tint text-brand-text' : 'text-ink-muted hover:text-ink-700'"
        @click="view = opt"
      >{{ opt === 'board' ? t('Board', 'Tablero') : t('Table', 'Tabla') }}</button>
    </div>
    <button
      type="button"
      class="flex h-8 items-center rounded-ctl bg-brand px-3.5 text-[12.5px] font-semibold text-white hover:bg-brand-hover"
    >{{ t('Add lead', 'Añadir contacto') }}</button>
  </PageHeader>

  <div class="flex flex-1 flex-col overflow-hidden">
    <div v-if="!allowed" class="mx-auto max-w-sm py-16 text-center">
      <p class="text-[13px] text-ink-muted">{{ t("You don't have access to Growth.", 'No tienes acceso a Crecimiento.') }}</p>
    </div>

    <!-- Without the tier there is no pipeline to show, so this points at the
    upgrade screen rather than repeating it. -->
    <div v-else-if="resolved && !hasGrowth" class="mx-auto max-w-sm py-16 text-center">
      <p class="text-[13px] text-ink-muted">{{ t('Leads are part of the Growth tier.', 'Los contactos forman parte del plan Growth.') }}</p>
      <NuxtLink to="/growth" class="mt-3 inline-flex h-9 items-center rounded-ctl bg-brand px-4 text-[12.5px] font-semibold text-white hover:bg-brand-hover">
        {{ t('See what Growth adds', 'Ver qué añade Growth') }}
      </NuxtLink>
    </div>

    <GrowthLeadsEmptyState v-else-if="showEmpty" />

    <template v-else>
      <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2.5 sm:px-6">
        <label class="relative flex h-8 min-w-[210px] flex-1 items-center sm:max-w-[280px] sm:flex-none">
          <span class="sr-only">{{ t('Search leads', 'Buscar contactos') }}</span>
          <!-- Disabled until the board is real. The filter bar is server-
          rendered, so without this there is a window where the box accepts
          typing that goes nowhere: v-model is not bound yet, hydration then
          binds an empty ref, and the text the user entered is silently
          discarded. Cheaper to refuse the keystroke than to swallow it. -->
          <input
            v-model="search"
            type="search"
            :disabled="showLoading"
            class="h-8 w-full rounded-ctl border border-line-control bg-surface px-2.5 text-[12px] text-ink-700 placeholder:text-ink-faint focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            :placeholder="t('Search name, phone or email', 'Buscar nombre, teléfono o email')"
          >
        </label>

        <!-- Presentational until the API lands: rendered as text, not as
        buttons or selects, so nothing here invites a click that does
        nothing. They become real filters alongside the leads endpoint. -->
        <span class="rounded-pill border border-brand-tintBorder bg-brand-tint px-2.5 py-1 text-[11px] text-brand-text">
          {{ t('Source', 'Origen') }}: Meta Ads, Google Ads
        </span>
        <span class="rounded-pill border border-chip-border bg-chip-bg px-2.5 py-1 text-[11px] text-ink-muted">
          {{ t('Owner', 'Responsable') }}: {{ t('All', 'Todos') }}
        </span>
        <span class="rounded-pill border border-chip-border bg-chip-bg px-2.5 py-1 text-[11px] text-ink-muted">
          {{ t('Created', 'Creado') }}: {{ t('Last 30 days', 'Últimos 30 días') }}
        </span>

        <span v-if="summary" class="ml-auto flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span class="h-1.5 w-1.5 rounded-full bg-brand" />
          {{ summary.handledByAi }} {{ t('handled by AI right now', 'gestionados por la IA ahora mismo') }}
        </span>
      </div>

      <p v-if="error" class="px-4 py-10 text-center text-[13px] text-danger-text sm:px-6" data-test="leads-error">{{ error }}</p>

      <GrowthLeadsBoardSkeleton v-else-if="showLoading" class="pt-4" />

      <div v-else-if="view === 'board'" class="flex flex-1 gap-3 overflow-x-auto px-4 pb-4 pt-4 sm:px-6">
        <GrowthLeadColumn
          v-for="column in visibleColumns"
          :key="column.key"
          :column="column"
          :dragging-id="draggingId"
          :drop-target="dropTargetKey === column.key && draggingId !== null"
          @open="onOpen"
          @dragstart="onDragStart"
          @dragend="onDragEnd"
          @dragenter="onDragEnter(column.key)"
          @drop="onDrop(column.key)"
        />
      </div>

      <!-- The board is the designed view; the toggle exists in the artboard so
      it is wired, and the table is the plain list behind it. -->
      <div v-else class="flex-1 overflow-auto px-4 pb-4 pt-4 sm:px-6">
        <table class="w-full min-w-[640px] border-collapse text-[12px]">
          <thead>
            <tr class="border-b border-line text-[10px] uppercase tracking-[.06em] text-ink-faint">
              <th class="px-2 pb-2 text-left font-normal">{{ t('Name', 'Nombre') }}</th>
              <th class="px-2 pb-2 text-left font-normal">{{ t('Stage', 'Etapa') }}</th>
              <th class="px-2 pb-2 text-left font-normal">{{ t('Source', 'Origen') }}</th>
              <th class="px-2 pb-2 text-left font-normal">{{ t('Time in stage', 'Tiempo en etapa') }}</th>
              <th class="px-2 pb-2 text-right font-normal">{{ t('Value', 'Valor') }}</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="column in visibleColumns" :key="column.key">
              <tr
                v-for="lead in column.cards"
                :key="lead.id"
                class="cursor-pointer border-b border-line-divider text-ink-700 hover:bg-surface-subtle"
                @click="onOpen(lead)"
              >
                <td class="px-2 py-2 font-medium text-ink-900">{{ lead.name }}</td>
                <td class="px-2 py-2">{{ column.title }}</td>
                <td class="px-2 py-2">{{ lead.source }}</td>
                <td class="px-2 py-2 text-ink-muted">{{ lead.timeInStage }}</td>
                <td class="px-2 py-2 text-right font-mono">{{ lead.value }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </template>
  </div>

  <GrowthLeadDrawer v-if="openLead" :lead="openLead" @close="closeLead" />
  <!-- The drawer opens on click and fills in when the fetch lands, rather
  than the row staying inert until it does. -->
  <div v-else-if="leadLoading" class="fixed inset-0 z-50 flex justify-end" data-test="lead-drawer-loading">
    <div class="absolute inset-0 bg-ink-900/20" @click="closeLead" />
    <aside class="relative flex h-full w-full max-w-[720px] flex-col gap-3 bg-surface p-5 shadow-drawer">
      <UiSkeleton class="h-9 w-48 rounded-ctl" />
      <UiSkeleton class="h-4 w-64 rounded-ctlSm" />
      <UiSkeleton class="mt-4 h-24 w-full rounded-card" />
      <UiSkeleton class="h-24 w-full rounded-card" />
    </aside>
  </div>
</template>

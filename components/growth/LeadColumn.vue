<script setup lang="ts">
import type { GrowthLead, GrowthLeadColumn } from '~/composables/useGrowthLeads'

defineProps<{
  column: GrowthLeadColumn
  draggingId: string | null
  /** True while a card is hovering this column, to show the drop slot. */
  dropTarget: boolean
}>()

const emit = defineEmits<{
  open: [lead: GrowthLead]
  dragstart: [lead: GrowthLead]
  dragend: []
  dragenter: []
  drop: []
}>()

// dragover must be prevented on every move or the browser refuses the drop --
// the default action for a dragover is "this is not a drop target".
function onDragOver(e: DragEvent) {
  e.preventDefault()
  emit('dragenter')
}
</script>

<template>
  <section
    class="flex w-[200px] shrink-0 flex-col gap-2"
    :data-test="`lead-column-${column.key}`"
    @dragover="onDragOver"
    @drop.prevent="emit('drop')"
  >
    <header class="flex items-baseline justify-between gap-2 px-0.5">
      <div class="flex items-center gap-1.5">
        <h2 class="text-[11.5px] font-semibold tracking-tightTitle text-ink-900">{{ column.title }}</h2>
        <span data-test="lead-count" class="rounded-pill border border-chip-border bg-chip-bg px-1.5 py-px text-[9.5px] font-medium text-ink-muted">{{ column.count }}</span>
      </div>
      <span class="font-mono text-[9.5px] text-ink-faint">{{ column.value }}</span>
    </header>

    <div class="flex min-h-[80px] flex-col gap-2">
      <div
        v-if="column.emptyTitle && !column.cards.length"
        class="flex flex-col gap-1 rounded-card border border-dashed border-line-control px-2.5 py-4 text-center"
      >
        <span class="text-[10.5px] font-semibold text-ink-muted">{{ column.emptyTitle }}</span>
        <span class="text-[9.5px] text-ink-faint">{{ column.emptyDetail }}</span>
      </div>

      <!-- The slot a dropped card will land in. Only while something is
      actually over this column, so the board isn't full of dashed boxes. -->
      <div v-if="dropTarget" class="h-[76px] rounded-card border border-dashed border-brand bg-brand-tint" />

      <GrowthLeadCard
        v-for="lead in column.cards"
        :key="lead.id"
        :lead="lead"
        :dragging="draggingId === lead.id"
        @open="emit('open', lead)"
        @dragstart="emit('dragstart', lead)"
        @dragend="emit('dragend')"
      />

      <span v-if="column.more" class="px-0.5 py-1 text-[9.5px] font-medium text-ink-faint">{{ column.more }}</span>
    </div>
  </section>
</template>

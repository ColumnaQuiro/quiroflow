<script setup lang="ts">
import type { WidgetSize } from '~/utils/dashboardWidgets'
import { SIZE_COL_SPAN } from '~/utils/dashboardWidgets'

const props = defineProps<{ title: string; meta?: string; size: WidgetSize; editing: boolean; index: number }>()
const emit = defineEmits<{
  remove: []
  cycleSize: []
  dragStart: [index: number]
  dragOver: [index: number]
}>()
</script>

<template>
  <div
    class="relative rounded-card border bg-surface p-4 shadow-card"
    :class="[SIZE_COL_SPAN[props.size], editing ? 'border-chart-projected' : 'border-line']"
    :draggable="editing"
    @dragstart="emit('dragStart', index)"
    @dragover.prevent="emit('dragOver', index)"
  >
    <div class="flex items-center justify-between gap-2">
      <div class="flex min-w-0 items-center gap-1.5">
        <span v-if="editing" class="shrink-0 cursor-move select-none text-[13px] leading-none text-ink-faint2" title="Drag to reorder">⠿</span>
        <h3 class="truncate text-[13px] font-semibold text-ink-900">{{ title }}</h3>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <span v-if="meta && !editing" class="text-[11.5px] text-ink-muted2">{{ meta }}</span>
        <template v-if="editing">
          <button
            type="button"
            class="rounded-ctlSm border border-line-control px-1.5 py-0.5 text-[10.5px] font-medium text-ink-muted2 hover:border-line-controlHover hover:text-ink-600"
            title="Cycle widget width"
            @click="emit('cycleSize')"
          >
            {{ size }}
          </button>
          <button type="button" class="text-ink-faint2 hover:text-danger-text" title="Remove widget" @click="emit('remove')">✕</button>
        </template>
      </div>
    </div>
    <div class="mt-3" :class="{ 'pointer-events-none opacity-60': editing }">
      <slot />
    </div>
  </div>
</template>

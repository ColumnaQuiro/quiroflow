<script setup lang="ts">
import type { WidgetSize } from '~/utils/dashboardWidgets'
import { SIZE_COL_SPAN } from '~/utils/dashboardWidgets'

const props = defineProps<{ title: string; size: WidgetSize; editing: boolean; index: number }>()
const emit = defineEmits<{
  remove: []
  cycleSize: []
  dragStart: [index: number]
  dragOver: [index: number]
}>()
</script>

<template>
  <div
    class="relative rounded-lg border border-gray-200 bg-white p-4"
    :class="SIZE_COL_SPAN[props.size]"
    :draggable="editing"
    @dragstart="emit('dragStart', index)"
    @dragover.prevent="emit('dragOver', index)"
  >
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-semibold text-gray-900">{{ title }}</h3>
      <div v-if="editing" class="flex items-center gap-2">
        <button type="button" class="cursor-move text-xs text-gray-400" title="Drag to reorder">⠿</button>
        <button type="button" class="rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-50" @click="emit('cycleSize')">
          {{ size }}
        </button>
        <button type="button" class="text-gray-400 hover:text-red-600" @click="emit('remove')">✕</button>
      </div>
    </div>
    <div class="mt-2" :class="{ 'pointer-events-none opacity-60': editing }">
      <slot />
    </div>
  </div>
</template>

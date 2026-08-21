<script setup lang="ts">
import { WIDGET_REGISTRY } from '~/utils/dashboardWidgets'

const props = defineProps<{ existingTypes: string[] }>()
const emit = defineEmits<{ add: [type: string] }>()

const available = computed(() => WIDGET_REGISTRY.filter((w) => !props.existingTypes.includes(w.type)))
</script>

<template>
  <div class="mb-3 rounded-card border border-dashed border-line-control bg-surface-subtle px-4 py-3">
    <p class="mb-2 text-[11px] font-semibold uppercase tracking-[.06em] text-ink-muted2">Add a widget</p>
    <p v-if="available.length === 0" class="text-[13px] text-ink-faint">All widgets are already on your dashboard.</p>
    <div v-else class="flex flex-wrap gap-2">
      <button
        v-for="w in available"
        :key="w.type"
        type="button"
        class="flex h-7 items-center rounded-pill border border-line-control bg-surface px-3 text-[12.5px] font-medium text-ink-500 hover:border-brand-tintBorder hover:bg-brand-tint hover:text-brand-text"
        @click="emit('add', w.type)"
      >
        + {{ w.label }}
      </button>
    </div>
  </div>
</template>

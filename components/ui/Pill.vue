<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'brand' | 'success' | 'warning' | 'danger' | 'neutral'; dot?: boolean }>(), {
  tone: 'neutral',
})

const TONE_CLASSES: Record<string, string> = {
  brand: 'bg-brand-tint text-brand-text',
  success: 'bg-success-bg text-success-text',
  warning: 'bg-warning-bg text-warning-text',
  danger: 'bg-danger-bg text-danger-text',
  neutral: 'bg-chip-bg text-chip-text',
}
const DOT_CLASSES: Record<string, string> = {
  brand: 'bg-brand',
  success: 'bg-success-accent',
  warning: 'bg-warning-accent',
  danger: 'bg-danger-text',
  neutral: 'bg-ink-faint3',
}
</script>

<template>
  <span class="inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-[11px] font-semibold" :class="TONE_CLASSES[tone]">
    <span v-if="dot" class="h-[6px] w-[6px] shrink-0 rounded-full" :class="DOT_CLASSES[tone]" />
    <slot />
  </span>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'info' | 'warning' | 'success' }>(), { tone: 'info' })

const TONE: Record<string, string> = {
  info: 'border-info-border bg-info-bg text-info-text',
  warning: 'border-warning-border bg-warning-bg text-warning-text',
  success: 'border-success-border bg-success-bg text-success-text',
}
</script>

<template>
  <div class="my-4 rounded-card border p-3.5 text-[13px] leading-relaxed" :class="TONE[tone]">
    <slot />
  </div>
</template>

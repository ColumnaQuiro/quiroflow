<script setup lang="ts">
// The surface every block on this page sits on.
withDefaults(defineProps<{ tone?: 'default' | 'subtle' | 'danger'; padded?: boolean }>(), {
  tone: 'default',
  padded: true,
})

const TONE = {
  default: 'bg-surface border-line',
  subtle: 'bg-surface-subtle border-line',
  danger: 'bg-danger-bg border-danger-border',
}
</script>

<template>
  <div class="rounded-card border shadow-card" :class="[TONE[tone], padded && 'p-[18px]']">
    <slot />
  </div>
</template>

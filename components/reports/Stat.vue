<script setup lang="ts">
// A headline figure on a report: the label is shown straight away, and only
// the number waits for its data. The default slot is the value itself (and
// anything under it), rendered once `loading` clears.
defineProps<{ label: string; loading?: boolean }>()
</script>

<template>
  <div class="rounded-card border border-line bg-surface p-4 shadow-card" :aria-busy="loading || undefined">
    <p class="text-[11px] font-medium uppercase tracking-wide text-ink-muted2">{{ label }}</p>
    <!-- Same font size as the value, so the line box -- and the tile -- is the
    same height with the placeholder as with the number. -->
    <div v-if="loading" class="mt-1.5 flex items-center font-mono text-[23px]" aria-hidden="true">
      &#8203;<UiSkeleton class="h-[23px] w-20 rounded-ctlSm" />
    </div>
    <slot v-else />
  </div>
</template>

<script setup lang="ts">
// A care plan's re-exam visit (utils/carePlanVisitMarkers.ts): a clipboard
// with a tick. One shape everywhere it is drawn -- the calendar block, the
// panels, the plan summary -- so it reads as the same thing.
withDefaults(defineProps<{ size?: number }>(), { size: 12 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0">
    <path d="M9 4h6v3H9z" />
    <path d="M15 5h3v16H6V5h3" />
    <path d="m9 14 2 2 4-4" />
  </svg>
</template>

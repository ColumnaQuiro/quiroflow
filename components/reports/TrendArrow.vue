<script setup lang="ts">
// The up/down mark beside a change against the previous period.
//
// It was the text triangles ▲ and ▼, which every font draws differently (in
// JetBrains Mono they sit high and heavy, in Instrument Sans they fall back
// to a system glyph). A small stroked arrow in currentColor, so it takes the
// green or red of the figure beside it.
defineProps<{ up: boolean }>()
</script>

<template>
  <svg class="inline-block h-3 w-3 shrink-0 align-[-1px]" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path v-if="up" d="M6 10V2M2.5 5.5 6 2l3.5 3.5" />
    <path v-else d="M6 2v8M2.5 6.5 6 10l3.5-3.5" />
  </svg>
</template>

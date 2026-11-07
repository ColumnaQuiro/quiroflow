<script setup lang="ts">
// The cross for close and remove buttons.
//
// Those buttons used the text character ✕, drawn at whatever font size and
// weight the button around it happened to have, so the same "close" was a
// different size in every panel. As with UiChevron, an icon has a size of its
// own: Heroicons outline, stroked in currentColor so it takes the button's
// colour and hover. The button keeps the accessible name.
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" class="h-4 w-4 shrink-0">
    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
</template>

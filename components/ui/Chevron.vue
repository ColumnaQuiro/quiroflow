<script setup lang="ts">
// A chevron for previous/next and back buttons.
//
// These used to be the text characters ‹ and ›, which are drawn at the font
// size of the button around them: 13px of glyph, most of it whitespace, lost
// in a 36px button. An icon has a size of its own. Heroicons outline, stroked
// in currentColor, so it takes the button's colour and hover.
withDefaults(defineProps<{ dir?: 'left' | 'right' }>(), { dir: 'left' })
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" class="h-4 w-4 shrink-0">
    <path v-if="dir === 'left'" stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
    <path v-else stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
  </svg>
</template>

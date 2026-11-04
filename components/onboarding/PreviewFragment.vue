<script setup lang="ts">
// One product surface inside the right panel: a card built from the app's
// own tokens, as wide as the panel allows (see Preview.vue for why it no
// longer runs off the right edge).
</script>

<template>
  <div class="min-w-0 overflow-hidden rounded-card border border-line bg-surface shadow-card">
    <slot />
  </div>
</template>

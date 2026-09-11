<script setup lang="ts">
// The header every patient tab opens with. The old home screen had one
// "Hi, Raul" and then unlabelled sections, so nothing on screen said what
// you were looking at.
defineProps<{ title: string; lead?: string }>()
</script>

<template>
  <div class="p-4">
    <header class="mb-4">
      <h1 class="text-[19px] font-[640] tracking-tightTitle text-ink-900">{{ title }}</h1>
      <p v-if="lead" class="mt-1 text-[13px] text-ink-muted">{{ lead }}</p>
    </header>
    <slot />
  </div>
</template>

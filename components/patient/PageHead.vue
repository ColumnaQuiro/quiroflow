<script setup lang="ts">
// Every portal page opens the same way, so a patient always knows which
// one they're on -- the old portal had a single "Hi Raul" and then six
// unlabelled boxes.
defineProps<{ title: string; lead?: string }>()
</script>

<template>
  <header class="mb-5">
    <h1 class="text-[21px] font-[640] tracking-tightTitle text-ink-900">{{ title }}</h1>
    <p v-if="lead" class="mt-1 text-[13.5px] text-ink-muted">{{ lead }}</p>
  </header>
</template>

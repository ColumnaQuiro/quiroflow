<script setup lang="ts">
defineProps<{ label: string }>()
</script>

<template>
  <div class="rounded-lg border border-dashed border-line-control bg-surface p-8 text-center text-sm text-ink-faint">
    {{ label }} import isn't built yet.
  </div>
</template>

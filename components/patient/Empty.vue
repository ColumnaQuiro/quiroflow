<script setup lang="ts">
defineProps<{ text: string }>()
</script>

<template>
  <p class="px-4 py-8 text-center text-[13px] text-ink-faint">{{ text }}</p>
</template>

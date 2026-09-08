<script setup lang="ts">
defineProps<{ title: string; meta?: string }>()
</script>

<template>
  <header class="flex shrink-0 flex-col gap-2.5 border-b border-line bg-surface px-4 py-3 sm:h-14 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-0">
    <div class="flex items-baseline gap-2.5">
      <h1 class="text-[18px] font-[640] tracking-tightTitle text-ink-900">{{ title }}</h1>
      <p v-if="meta" class="text-[12.5px] text-ink-muted2">{{ meta }}</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <slot />
    </div>
  </header>
</template>

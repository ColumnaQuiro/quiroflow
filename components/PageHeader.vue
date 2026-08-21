<script setup lang="ts">
defineProps<{ title: string; meta?: string }>()
</script>

<template>
  <header class="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-6">
    <div class="flex items-baseline gap-2.5">
      <h1 class="text-[18px] font-[640] tracking-tightTitle text-ink-900">{{ title }}</h1>
      <p v-if="meta" class="text-[12.5px] text-ink-muted2">{{ meta }}</p>
    </div>
    <div class="flex items-center gap-2">
      <slot />
    </div>
  </header>
</template>

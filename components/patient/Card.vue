<script setup lang="ts">
// The portal's one box. Sections used to differ in border, padding and
// radius depending on which card had been written most recently.
withDefaults(defineProps<{ title?: string; flush?: boolean }>(), { flush: false })
</script>

<template>
  <section class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
    <header v-if="title || $slots.action" class="flex items-center justify-between gap-3 border-b border-line-divider px-4 py-3">
      <h2 class="text-[13px] font-[640] uppercase tracking-[.05em] text-ink-faint">{{ title }}</h2>
      <slot name="action" />
    </header>
    <div :class="flush ? '' : 'p-4'">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
// The receptionist config is a dozen small panels that differ only in what
// they hold, so they share one frame rather than each re-declaring the same
// border, radius and heading.
defineProps<{ title: string; action?: string }>()
defineEmits<{ action: [] }>()
</script>

<template>
  <section class="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
    <div class="flex items-baseline justify-between gap-3">
      <h2 class="text-[12.5px] font-semibold tracking-tightTitle text-ink-900">{{ title }}</h2>
      <button
        v-if="action"
        type="button"
        class="shrink-0 text-[11px] font-semibold text-brand-text hover:underline"
        @click="$emit('action')"
      >{{ action }}</button>
    </div>
    <slot />
  </section>
</template>

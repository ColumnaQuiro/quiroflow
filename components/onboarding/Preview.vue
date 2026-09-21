<script setup lang="ts">
// The right panel's heading block. Each step supplies its own copy and its
// own product fragment(s) in the default slot; the fragments position
// themselves against the panel, which is the nearest positioned ancestor.
defineProps<{ eyebrow: string; title: string; body: string }>()
</script>

<template>
  <div>
    <div class="absolute left-[72px] top-[76px] w-[520px]">
      <p class="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{{ eyebrow }}</p>
      <h2 class="mt-3 text-[22px] font-semibold leading-[1.3] tracking-tightTitle text-ink-900">{{ title }}</h2>
      <p class="mt-[9px] text-[14px] leading-[1.55] text-ink-muted">{{ body }}</p>
    </div>
    <slot />
  </div>
</template>

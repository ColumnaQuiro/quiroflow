<script setup lang="ts">
// The right panel's heading block, with the step's product fragment(s) in the
// default slot stacked beneath it.
//
// Laid out in flow, inside a box pinned to the panel. The fragments used to be
// positioned absolutely at fixed tops and drawn wider than the panel, so
// their right edge ran off under it on purpose; on a laptop that cut the
// patient's status pills, the Copy link button and half of every chat bubble,
// and read as broken rather than as a crop. They now fit the panel's width,
// and only the bottom is cropped, under the layout's fade. Pinned (absolute
// inset-0) so a tall fragment never makes the page itself taller than the
// form beside it.
defineProps<{ eyebrow: string; title: string; body: string }>()
</script>

<template>
  <div class="absolute inset-0 overflow-hidden px-10 pt-14 xl:px-[72px] xl:pt-[76px]">
    <div class="max-w-[680px]">
      <div class="max-w-[520px]">
        <p class="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{{ eyebrow }}</p>
        <h2 class="mt-3 text-[22px] font-semibold leading-[1.3] tracking-tightTitle text-ink-900">{{ title }}</h2>
        <p class="mt-[9px] text-[14px] leading-[1.55] text-ink-muted">{{ body }}</p>
      </div>
      <div class="mt-9 flex flex-col gap-5 xl:mt-11 xl:gap-6">
        <slot />
      </div>
    </div>
  </div>
</template>

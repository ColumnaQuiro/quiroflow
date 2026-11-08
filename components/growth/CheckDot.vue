<script setup lang="ts">
// The round tick in Growth's set-up checklists (Leads' empty state, the
// receptionist's "Getting it ready"). It used to be the text character ✓,
// drawn at whatever size and weight the font gave it -- off-centre in its
// 16px circle, and a different glyph again on each platform's fallback.
defineProps<{ done: boolean }>()
</script>

<template>
  <span
    class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
    :class="done ? 'bg-success-bg text-success-text' : 'border border-line-control bg-surface'"
    aria-hidden="true"
  >
    <svg v-if="done" viewBox="0 0 12 12" fill="none" class="h-2.5 w-2.5">
      <path d="M2.4 6.3L4.8 8.7L9.6 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </span>
</template>

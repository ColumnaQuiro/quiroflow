<script setup lang="ts">
// Outbound message status, WhatsApp-style: clock while pending, single
// check once sent, double check once delivered, blue double check once
// read, warning triangle if it failed. Always sits on its own light circle
// rather than directly on the bubble color -- the bubble is brand-purple,
// not WhatsApp's pale green, so a red/blue icon drawn straight onto it had
// no usable contrast. The circle makes contrast independent of whatever the
// bubble color is. The two check icons are hand-drawn paths (not two "✓"
// characters) specifically so their overlap/spacing is under our control
// instead of varying by platform font rendering.
defineProps<{ status: string }>()
</script>

<template>
  <span class="inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.04)]">
    <svg v-if="status === 'pending'" viewBox="0 0 16 16" class="h-[9px] w-[9px] text-ink-faint" fill="none" stroke="currentColor" stroke-width="1.3">
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 4.6V8.2L10.3 9.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <svg v-else-if="status === 'failed'" viewBox="0 0 16 16" class="h-[10px] w-[10px] text-danger-text" fill="currentColor">
      <path d="M8 1.5c.34 0 .65.18.82.48l6.5 11.25a.95.95 0 0 1-.82 1.42H1.5a.95.95 0 0 1-.82-1.42L7.18 1.98c.17-.3.48-.48.82-.48Z" opacity=".15" />
      <path d="M8 5.2a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3A.75.75 0 0 1 8 5.2Zm0 6.1a.85.85 0 1 1 0 1.7.85.85 0 0 1 0-1.7Z" />
    </svg>
    <svg v-else-if="status === 'sent'" viewBox="0 0 16 12" class="h-[8px] w-[11px] text-ink-muted" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M1 6.5 4.5 10 14 1" />
    </svg>
    <svg v-else viewBox="0 0 20 12" class="h-[8px] w-[14px]" :class="status === 'read' ? 'text-[#34B7F1]' : 'text-ink-muted'" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M1 6.5 4.5 10 11 2" />
      <path d="M7 6.5 10.5 10 19 1" />
    </svg>
  </span>
</template>

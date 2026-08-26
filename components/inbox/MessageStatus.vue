<script setup lang="ts">
// Outbound message status, WhatsApp-style: clock while pending, single
// check once sent, double check once delivered, a distinct blue double
// check once read, an amber warning triangle if it failed. Drawn directly
// on the bubble (brand indigo, #4F46E5) rather than behind a light circle
// badge -- the earlier badge fixed contrast but looked wrong against the
// bubble color, so instead each status color was picked to already read
// clearly on indigo specifically: red failed straight to near-invisible
// there, so failed uses amber instead of red; the read tick uses a light
// sky blue rather than WhatsApp's exact blue, which sits too close to the
// bubble's own hue to stand out. The two check icons are hand-drawn paths
// (not two "✓" characters) so their overlap/spacing is under our control
// instead of varying by platform font rendering.
defineProps<{ status: string }>()
</script>

<template>
  <span class="inline-flex h-[13px] w-[13px] shrink-0 items-center justify-center">
    <svg v-if="status === 'pending'" viewBox="0 0 16 16" class="h-[11px] w-[11px] text-white/60" fill="none" stroke="currentColor" stroke-width="1.4">
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 4.6V8.2L10.3 9.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <svg v-else-if="status === 'failed'" viewBox="0 0 16 16" class="h-[12px] w-[12px] text-[#FCD34D]" fill="currentColor">
      <path d="M8 1.5c.34 0 .65.18.82.48l6.5 11.25a.95.95 0 0 1-.82 1.42H1.5a.95.95 0 0 1-.82-1.42L7.18 1.98c.17-.3.48-.48.82-.48Z" />
      <rect x="7.3" y="5.5" width="1.4" height="4" rx="0.7" fill="#4F46E5" />
      <rect x="7.3" y="10.2" width="1.4" height="1.4" rx="0.7" fill="#4F46E5" />
    </svg>
    <svg v-else-if="status === 'sent'" viewBox="0 0 16 12" class="h-[9px] w-[12px] text-white/75" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M1 6.5 4.5 10 14 1" />
    </svg>
    <svg v-else viewBox="0 0 20 12" class="h-[9px] w-[15px]" :class="status === 'read' ? 'text-[#7DD3FC]' : 'text-white/75'" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M1 6.5 4.5 10 11 2" />
      <path d="M7 6.5 10.5 10 19 1" />
    </svg>
  </span>
</template>

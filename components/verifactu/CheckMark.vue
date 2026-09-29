<script setup lang="ts">
// The mark in front of each certificate check on Settings > VeriFactu: a
// tick, a cross, a warning or a dot for "cannot tell yet". Drawn rather than
// typed as ✓/✕ so it sits on the text's line at any size.
defineProps<{ state: 'good' | 'bad' | 'warn' | 'unknown' }>()
</script>

<template>
  <span class="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center" aria-hidden="true">
    <svg v-if="state === 'good'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" class="stroke-success-text"><path d="M5 12l5 5L20 7" /></svg>
    <svg v-else-if="state === 'bad'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
    <svg v-else-if="state === 'warn'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 6v8M12 18h.01" /></svg>
    <span v-else class="h-1.5 w-1.5 rounded-full bg-ink-faint3" />
  </span>
</template>

<script setup lang="ts">
import type { BonoTone } from '~/utils/bonoStatus'

defineProps<{ tone: BonoTone; label: string }>()

function colorClass(tone: BonoTone) {
  if (tone === 'success') return 'text-success-accent bg-success-bg'
  if (tone === 'danger') return 'text-danger-text bg-danger-bg'
  if (tone === 'warning') return 'text-warning-accent bg-warning-bg'
  return ''
}
</script>

<template>
  <div v-if="tone" class="flex items-start gap-2 rounded-ctl px-2.5 py-2" :class="colorClass(tone)">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" class="mt-0.5 shrink-0">
      <path d="M3 10h18M7 15h1m4 0h1m-7 4h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <p class="text-[12.5px] font-medium leading-snug">{{ label }}</p>
  </div>
</template>

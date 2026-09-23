<script setup lang="ts">
import type { AppointmentStage } from '~/utils/appointmentStage'

// One small glyph per stage, so a stage still reads where its label does not
// fit (week view, narrow day columns). Drawn in currentColor: the pill it sits
// in decides the colour.
withDefaults(defineProps<{ stage: AppointmentStage; size?: number }>(), { size: 11 })
</script>

<template>
  <svg v-if="stage === 'arrived'" :width="size - 2" :height="size - 2" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" /></svg>
  <svg v-else :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="stage === 'pending'"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></template>
    <template v-else-if="stage === 'online'"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></template>
    <path v-else-if="stage === 'resched'" d="M4 8h14l-4-4M20 16H6l4 4" />
    <path v-else-if="stage === 'confirmed' || stage === 'completed'" d="M5 12l5 5 9-10" />
    <template v-else-if="stage === 'withp'"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-5.5 8-5.5s6.5 1.5 8 5.5" /></template>
    <path v-else-if="stage === 'checkout'" d="M17.5 6.5a7 7 0 1 0 0 11M4 10h9M4 14h9" />
    <path v-else d="M6 6l12 12M18 6L6 18" />
  </svg>
</template>

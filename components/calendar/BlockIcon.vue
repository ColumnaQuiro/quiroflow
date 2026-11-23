<script setup lang="ts">
// The small icons an appointment block draws beside the patient's name or in
// its detail line. One component so the block and the calendar's legend draw
// the same shapes: a key that described a slightly different icon would be
// worse than none.
//
// - forms:  a clipboard with "!" -- forms sent and not completed
// - note:   a page with lines -- a sticky clinical note
// - moved:  a circular arrow -- the visit was moved before
// - noNext: a calendar struck through -- nothing booked after this visit
//
// The re-exam marker (VisitMarkerIcon) and red flags (RedFlagIcon) have their
// own components; colour is the caller's, via currentColor.
withDefaults(defineProps<{ kind: 'forms' | 'note' | 'moved' | 'noNext'; size?: number }>(), { size: 12 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0">
    <template v-if="kind === 'forms'"><path d="M9 4h6v3H9z" /><path d="M9 5.5H6v15h12v-15h-3" /><path d="M12 11v3.5M12 17.5h.01" /></template>
    <template v-else-if="kind === 'note'"><path d="M5 4h10l4 4v12H5z" /><path d="M9 12h6M9 16h4" /></template>
    <template v-else-if="kind === 'moved'"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></template>
    <template v-else><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M8 3v4M16 3v4" /><path d="m3 3 18 18" /></template>
  </svg>
</template>

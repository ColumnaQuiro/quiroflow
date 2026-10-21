<script setup lang="ts">
// The patient has red flags on their record (patients.red_flags): a
// contraindication the practitioner must see before treating -- "no cervical
// manipulation", say. One icon for every place a visit is drawn, so it reads
// the same on the calendar, the hover card and My Day.
withDefaults(defineProps<{ size?: number; label: string }>(), { size: 12 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" :aria-label="label" role="img">
    <path d="M12 3 2.5 20h19z" /><path d="M12 10v4.5M12 17.5h.01" />
  </svg>
</template>

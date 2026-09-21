<script setup lang="ts">
// The one pill in the subscription screens. Every tone is a semantic token
// pair, never a raw Tailwind colour -- bg-blue-50/bg-green-50/bg-red-50 on the
// old status pills are exactly why they stayed light-coloured in dark mode.
withDefaults(
  defineProps<{ tone?: 'info' | 'success' | 'danger' | 'dangerFilled' | 'chip' | 'brand' | 'warning' }>(),
  { tone: 'chip' },
)

const TONES = {
  info: 'text-info-text bg-info-bg border-info-border',
  success: 'text-success-text bg-success-bg border-success-border',
  danger: 'text-danger-text bg-danger-bg border-danger-border',
  // The only filled pill in the set: locked is the one state where the clinic
  // has actually lost something, so it stops being a tint.
  dangerFilled: 'text-white bg-danger-text border-danger-text',
  chip: 'text-chip-text bg-chip-bg border-chip-border',
  brand: 'text-brand-text bg-brand-tint border-brand-tintBorder',
  warning: 'text-warning-text bg-warning-bg border-warning-border',
}
</script>

<template>
  <span
    class="inline-flex items-center gap-[5px] rounded-pill border px-2.5 py-[3px] text-[11.5px] font-semibold"
    :class="TONES[tone]"
  >
    <slot />
  </span>
</template>

<script setup lang="ts">
// One option inside an OnboardingTileGroup.
//
// It is a real <button> carrying role="radio" rather than the aria-pressed the
// artboard shows: inside a radiogroup, a child that reports "pressed" is
// announced as a toggle rather than as one of N choices, and the group's
// position ("2 of 3") is lost. Visually identical either way.
defineProps<{ selected: boolean; layout: 'stacked' | 'inline' }>()
</script>

<template>
  <button
    type="button"
    role="radio"
    data-onboarding-tile
    :aria-checked="selected"
    :tabindex="selected ? 0 : -1"
    class="box-border rounded-card border bg-surface text-left outline-none"
    :class="[
      layout === 'stacked' ? 'flex flex-col gap-[9px] p-[9px]' : 'flex items-center gap-2.5 p-3',
      selected ? 'border-brand shadow-focusTile' : 'border-line-control hover:border-line-controlHover',
      'focus-visible:border-brand focus-visible:shadow-focusTile',
    ]"
  >
    <slot />
  </button>
</template>

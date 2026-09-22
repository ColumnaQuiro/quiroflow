<script setup lang="ts">
// One of the patient list's filter dropdowns.
//
// It exists because there were five of these written out longhand, each with
// its own copy of the same pill styling and the same hand-drawn chevron, and
// they had already drifted: two of them were missing the focus ring. A
// <select> rather than a custom popup, because the native control is already
// keyboard-operable, announces its own value, and on a phone opens the
// platform's own picker.
defineProps<{
  /** Announced to screen readers; the visible text comes from the options. */
  label: string
  options: { value: string; label: string }[]
}>()

const model = defineModel<string>({ required: true })
</script>

<template>
  <div class="relative">
    <select
      v-model="model"
      :aria-label="label"
      class="h-8 appearance-none rounded-pill border border-line-control bg-surface px-2.5 pr-6 text-[12.5px] font-medium text-ink-500 outline-none hover:border-line-controlHover focus:border-brand focus-visible:shadow-focus"
    >
      <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>
    <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true" class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint">
      <path d="M2 4l3 3 3-3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" />
    </svg>
  </div>
</template>

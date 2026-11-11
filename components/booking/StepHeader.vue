<script setup lang="ts">
// The title of a booking step and where it sits among the three. It was a
// centred "PASO 1 DE 3" above three dots, which said how far along a patient
// was but not what was left; three labelled bars say both, and the title
// beside them is the page's largest line of text, as it is on the
// appointment-booking pages patients already know.
defineProps<{
  title: string
  step: 1 | 2 | 3
  // One label per step, in order.
  labels: [string, string, string]
  // The "back" link's text; no link when absent (the first step).
  back?: string
}>()
defineEmits<{ back: [] }>()
const { say } = useBookingLang()
</script>

<template>
  <div class="mt-8">
    <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <h2 class="text-[26px] font-semibold leading-tight tracking-[-.015em] text-ink-900 sm:text-[32px]">{{ title }}</h2>
      <button
        v-if="back"
        type="button"
        class="inline-flex items-center gap-1 rounded-ctlSm pb-1 text-sm font-medium text-brand-text hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand touch:min-h-[44px]"
        data-cy="booking-back"
        @click="$emit('back')"
      >
        <UiChevron dir="left" />{{ back }}
      </button>
    </div>
    <ol
      class="mt-4 grid max-w-lg grid-cols-3 gap-2.5"
      :aria-label="say({ es: `Paso ${step} de 3`, en: `Step ${step} of 3`, fr: `Étape ${step} sur 3` })"
      data-cy="booking-steps"
    >
      <li v-for="(label, i) in labels" :key="i" :aria-current="i + 1 === step ? 'step' : undefined">
        <span class="block h-1 rounded-full" :class="i + 1 <= step ? 'bg-brand' : 'bg-ink-faint3'" aria-hidden="true"></span>
        <span
          class="mt-2 block truncate text-xs sm:text-[13px]"
          :class="i + 1 === step ? 'font-semibold text-ink-900' : i + 1 < step ? 'text-brand-text' : 'text-ink-faint'"
        >{{ i + 1 }} · {{ label }}</span>
      </li>
    </ol>
  </div>
</template>

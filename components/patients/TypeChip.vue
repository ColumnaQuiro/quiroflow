<script setup lang="ts">
import { PATIENT_TYPE_DOT, type PatientTypeColor } from '~/composables/usePatientTypes'

// A patient type as it shows wherever a patient's types do: a coloured dot
// and the name, on the neutral chip, so it reads the same in both themes.
defineProps<{ name: string; color: PatientTypeColor | string; removable?: boolean }>()
const emit = defineEmits<{ remove: [] }>()
const t = useT()
</script>

<template>
  <span class="inline-flex max-w-full items-center gap-1.5 rounded-pill border border-chip-border bg-chip-bg py-0.5 pl-2 text-[12px] font-medium text-ink-700" :class="removable ? 'pr-0.5' : 'pr-2'" data-cy="patient-type-chip">
    <span class="h-2 w-2 shrink-0 rounded-full" :style="{ background: PATIENT_TYPE_DOT[color as PatientTypeColor] ?? PATIENT_TYPE_DOT.slate }" aria-hidden="true" />
    <span class="truncate">{{ name }}</span>
    <button
      v-if="removable"
      type="button"
      class="flex h-5 w-5 items-center justify-center rounded-full text-ink-faint hover:bg-surface hover:text-ink-700 touch:h-7 touch:w-7"
      :aria-label="t(`Remove ${name}`, `Quitar ${name}`)"
      data-cy="patient-type-chip-remove"
      @click="emit('remove')"
    >
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
    </button>
  </span>
</template>

<script setup lang="ts">
import type { NoteSection } from '~/utils/visitNote'

// The heading of one part of a visit note: its SOAP letter in a small tile and
// its name beside it, set in ink rather than as a faint uppercase eyebrow, so
// the four parts of a note can be found by eye. The letters are the
// convention's own (S, O, A, P) whatever the interface language; "Note" is
// text that sits outside the four sections.
const props = defineProps<{ section: NoteSection | 'Note'; for?: string }>()
const t = useT()
const LETTER: Record<NoteSection | 'Note', string> = { Subjective: 'S', Objective: 'O', Action: 'A', Plan: 'P', Note: 'N' }
const name = computed(
  () =>
    ({
      Subjective: t('Subjective', 'Subjetivo'),
      Objective: t('Objective', 'Objetivo'),
      Action: t('Action', 'Acción'),
      Plan: t('Plan', 'Plan'),
      Note: t('Note', 'Nota'),
    })[props.section],
)
</script>

<template>
  <component :is="props.for ? 'label' : 'span'" :for="props.for" class="flex items-center gap-2">
    <span
      class="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-ctlSm border border-chip-border bg-chip-bg text-[12px] font-[640] leading-none text-ink-900"
      aria-hidden="true"
    >{{ LETTER[props.section] }}</span>
    <span class="text-[12.5px] font-semibold text-ink-900">{{ name }}</span>
  </component>
</template>

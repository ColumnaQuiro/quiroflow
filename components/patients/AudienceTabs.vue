<script setup lang="ts">
// All patients, Lists, Segments: the three ways into the patient list. A list
// or a segment, once opened, is the patient list again -- filtered to it --
// so "All patients" stays the tab while one is open.
export type AudienceView = 'patients' | 'lists' | 'segments'

defineProps<{
  view: AudienceView
  listCount: number | null
  segmentCount: number | null
}>()
const emit = defineEmits<{ 'update:view': [view: AudienceView] }>()
const t = useT()
</script>

<template>
  <!-- Scrolls sideways rather than wrapping a label onto two lines on a
  phone. The rule under the tabs is an inset shadow, not a border, because
  a scrolling box clips the -1px overlap the active underline used to sit on. -->
  <div role="tablist" :aria-label="t('Patients, lists and segments', 'Pacientes, listas y segmentos')" data-cy="audience-tabs" class="flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_rgb(var(--color-line))] [scrollbar-width:none]">
    <button
      v-for="tab in ([
        { key: 'patients', label: t('All patients', 'Todos los pacientes'), count: null },
        { key: 'lists', label: t('Lists', 'Listas'), count: listCount },
        { key: 'segments', label: t('Segments', 'Segmentos'), count: segmentCount },
      ] as const)"
      :key="tab.key"
      type="button"
      role="tab"
      :data-cy="`audience-tab-${tab.key}`"
      :aria-selected="view === tab.key"
      class="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 touch:h-11 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40"
      :class="view === tab.key ? 'border-brand text-brand-text' : 'border-transparent text-ink-muted hover:text-ink-700'"
      @click="emit('update:view', tab.key)"
    >
      {{ tab.label }}
      <span v-if="tab.count !== null" class="rounded-pill bg-chip-bg2 px-1.5 font-mono text-[11px] text-ink-muted">{{ tab.count }}</span>
    </button>
  </div>
</template>

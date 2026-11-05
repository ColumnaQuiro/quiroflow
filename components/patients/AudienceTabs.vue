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
  <div role="tablist" :aria-label="t('Patients, lists and segments', 'Pacientes, listas y segmentos')" data-cy="audience-tabs" class="flex gap-1 border-b border-line">
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
      class="-mb-px flex h-9 items-center gap-1.5 border-b-2 px-3 text-[13px] font-medium outline-none focus-visible:shadow-focus"
      :class="view === tab.key ? 'border-brand text-brand-text' : 'border-transparent text-ink-muted hover:text-ink-700'"
      @click="emit('update:view', tab.key)"
    >
      {{ tab.label }}
      <span v-if="tab.count !== null" class="rounded-pill bg-chip-bg2 px-1.5 font-mono text-[11px] text-ink-muted">{{ tab.count }}</span>
    </button>
  </div>
</template>

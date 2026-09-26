<script setup lang="ts">
// One box on the canvas: the trigger, a step, or the end of a chain. What it
// is (eyebrow), what it does (title), the detail that matters, and what it
// has done in the last 30 days -- so the flow can be read without opening
// anything.

const props = defineProps<{
  kind: 'trigger' | 'message' | 'wait' | 'condition' | 'action' | 'end'
  eyebrow: string
  title: string
  detail?: string
  stats?: string
  selected?: boolean
  growth?: boolean
  locked?: boolean
  problem?: boolean
  testId?: string
}>()
defineEmits<{ select: [] }>()

const t = useT()

// Tone carries the kind, so the shape of a flow reads before its words do.
const ICON_TONE: Record<string, string> = {
  trigger: 'bg-brand-tint text-brand-text',
  message: 'bg-success-bg text-success-text',
  wait: 'bg-warning-bg text-warning-text',
  condition: 'bg-info-bg text-info-text',
  action: 'bg-chip-bg text-chip-text',
  end: 'bg-chip-bg text-chip-text',
}
const ICON_PATH: Record<string, string> = {
  trigger: 'M8.9 1 3 9.2h3.6L6.2 15 13 6.4H9.3z',
  message: 'M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z',
  wait: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5v3.3l2.2 1.3',
  condition: 'M4 2.5v11M4 7.5c4 0 5-3.5 8-3.5M4 7.5c4 0 5 3.5 8 3.5',
  action: 'M3 8.5l3 3 7-7',
  end: 'M5 5h6v6H5z',
}
const isEnd = computed(() => props.kind === 'end')
</script>

<template>
  <button
    v-if="isEnd"
    type="button"
    class="flex h-full w-full items-center justify-center gap-1.5 rounded-pill border border-line bg-surface text-[12.5px] font-semibold text-ink-muted shadow-card"
    :data-test="testId"
    @click="$emit('select')"
  >
    <span class="h-2 w-2 rounded-[2px] bg-ink-faint3" />
    {{ t('End', 'Fin') }}
  </button>
  <button
    v-else
    type="button"
    class="flex h-full w-full flex-col gap-1 overflow-hidden rounded-card border bg-surface px-3.5 py-2.5 text-left shadow-card transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    :class="[
      selected ? 'border-brand ring-2 ring-brand/30' : 'border-line hover:border-line-controlHover',
      locked ? 'opacity-70' : '',
    ]"
    :aria-pressed="selected"
    :data-test="testId"
    @click="$emit('select')"
  >
    <span class="flex items-center gap-1.5">
      <span class="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]" :class="ICON_TONE[kind]">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path :d="ICON_PATH[kind]" />
        </svg>
      </span>
      <span class="truncate text-[10.5px] font-bold uppercase tracking-[.06em] text-ink-muted2">{{ eyebrow }}</span>
      <span v-if="growth" class="ml-auto shrink-0 rounded-pill bg-brand-tint px-1.5 py-px text-[9.5px] font-bold tracking-[.04em] text-brand-text">GROWTH</span>
      <span
        v-if="problem"
        class="shrink-0 rounded-full bg-warning-accent"
        :class="growth ? 'h-2 w-2' : 'ml-auto h-2 w-2'"
        :title="t('Something is missing here', 'Falta algo aquí')"
        data-test="node-problem"
      />
    </span>
    <span class="line-clamp-1 text-[13.5px] font-semibold leading-snug text-ink-900">{{ title }}</span>
    <span v-if="detail" class="line-clamp-2 text-[11.5px] leading-snug text-ink-muted">{{ detail }}</span>
    <span v-if="stats" class="mt-auto truncate font-mono text-[10.5px] text-ink-muted2" data-test="node-stats">{{ stats }}</span>
  </button>
</template>

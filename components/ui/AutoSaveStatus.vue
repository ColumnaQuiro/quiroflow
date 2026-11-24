<script setup lang="ts">
import type { AutoSaveState } from '~/composables/useAutoSave'

// Where an auto-saved editor stands (useAutoSave): "Saving…", "Saved", or
// what stopped it -- with Retry for a failed save, and the editor's own way
// out (the default slot) for a save it held back or a conflict.

const props = defineProps<{
  state: AutoSaveState
  message?: string
  /** What "saved" says: "Saved 3 min ago", or nothing for a draft never saved. */
  savedLabel?: string
}>()
const emit = defineEmits<{ retry: [] }>()
const t = useT()

const label = computed(() => {
  switch (props.state) {
    case 'pending':
    case 'saving':
      return t('Saving…', 'Guardando…')
    case 'error':
      return props.message ? t(`Not saved: ${props.message}`, `No guardado: ${props.message}`) : t('Not saved', 'No guardado')
    case 'held':
    case 'conflict':
      return props.message || t('Not saved', 'No guardado')
    default:
      return props.savedLabel ?? t('Saved', 'Guardado')
  }
})
const tone = computed(() => (props.state === 'error' || props.state === 'conflict' ? 'text-danger-text' : props.state === 'held' ? 'text-warning-text' : 'text-ink-muted'))
const dot = computed(() =>
  props.state === 'error' || props.state === 'conflict'
    ? 'bg-danger-text'
    : props.state === 'held'
      ? 'bg-warning-accent'
      : props.state === 'saved'
        ? 'bg-success-accent'
        : 'animate-pulse bg-ink-faint3',
)
</script>

<template>
  <div class="flex min-w-0 items-center gap-2 text-[12px]" data-test="save-status" :data-state="state">
    <!-- "Saving…" and "Saved" are not worth interrupting anyone for; a
    failure is, and is announced as an alert. -->
    <span :role="state === 'error' || state === 'conflict' ? 'alert' : 'status'" class="flex min-w-0 items-center gap-1.5" :class="tone" :title="label">
      <span v-if="label" class="h-[7px] w-[7px] shrink-0 rounded-full" :class="dot" aria-hidden="true" />
      <span class="truncate" data-test="save-status-label">{{ label }}</span>
    </span>
    <button
      v-if="state === 'error'"
      type="button"
      class="shrink-0 rounded-ctl border border-line-control px-2 py-0.5 font-semibold text-ink-700 hover:bg-surface-subtle touch:min-h-11"
      data-test="save-retry"
      @click="emit('retry')"
    >{{ t('Retry', 'Reintentar') }}</button>
    <slot />
  </div>
</template>

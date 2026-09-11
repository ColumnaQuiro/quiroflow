<script setup lang="ts">
// A button whose only content is an icon.
//
// "Delete" and "Edit" appeared as words in 23 files, at whatever size and
// colour each one happened to pick. An icon is faster to find in a dense
// row and stops a destructive action reading with the same weight as the
// text beside it -- but it also removes the button's accessible name, so
// `label` is required and becomes both aria-label and the hover tooltip.
// That is the whole reason this is a component rather than an inline svg:
// it is the one place that cannot be forgotten.
const props = withDefaults(
  defineProps<{
    icon: 'trash' | 'pencil'
    /** Required: what a screen reader announces, and the tooltip. */
    label: string
    /** 'danger' tints it red -- for actions that destroy something. */
    tone?: 'default' | 'danger'
    disabled?: boolean
  }>(),
  { tone: 'default', disabled: false },
)

// Heroicons outline, 24x24, stroke-based so they inherit currentColor.
const PATHS: Record<string, string> = {
  trash:
    'M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0',
  pencil:
    'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125',
}
</script>

<template>
  <button
    type="button"
    :aria-label="props.label"
    :title="props.label"
    :disabled="props.disabled"
    class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-ctlSm transition-colors disabled:cursor-not-allowed disabled:opacity-40"
    :class="
      props.tone === 'danger'
        ? 'text-ink-faint hover:bg-danger-bg hover:text-danger-text'
        : 'text-ink-faint hover:bg-surface-subtle hover:text-ink-700'
    "
  >
    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" :d="PATHS[props.icon]" />
    </svg>
  </button>
</template>

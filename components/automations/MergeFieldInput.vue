<script setup lang="ts">
import { FIELD } from '~/utils/automationUi'
import type { PickerVariable } from './VariablePicker.vue'

// A one-line field that takes merge fields: the { } button at its end opens
// the picker, and typing "{{" opens it filtered by what follows. Either way
// the field ends up holding plain {{key}} text, exactly as typing it by hand
// would, so nothing downstream changes.

defineProps<{ modelValue: string; variables: PickerVariable[]; placeholder?: string; testId?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const t = useT()

const input = ref<HTMLInputElement | null>(null)
const button = ref<HTMLButtonElement | null>(null)
const picker = ref<{ handleKey: (e: KeyboardEvent) => boolean } | null>(null)
const open = ref<null | { at: { x: number; y: number }; typed: boolean; query: string }>(null)

// "{{" and the word being typed after it, right before the caret.
function typedQuery(): string | null {
  const el = input.value
  if (!el || el.selectionStart !== el.selectionEnd) return null
  const m = /\{\{(\w*)$/.exec(el.value.slice(0, el.selectionStart ?? 0))
  return m ? m[1]! : null
}
function caretPoint() {
  const r = input.value!.getBoundingClientRect()
  // Close enough for a one-line field: under the field, near where the text ends.
  const chars = input.value!.selectionStart ?? 0
  return { x: r.left + Math.min(r.width - 40, 10 + chars * 6.6), y: r.bottom }
}

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
  const q = typedQuery()
  if (q !== null) open.value = { at: caretPoint(), typed: true, query: q }
  else if (open.value?.typed) open.value = null
}
function onKeydown(e: KeyboardEvent) {
  if (open.value?.typed) picker.value?.handleKey(e)
}
function openFromButton() {
  if (open.value) return (open.value = null)
  const r = button.value!.getBoundingClientRect()
  open.value = { at: { x: r.right - 300, y: r.bottom }, typed: false, query: '' }
}

function pick(key: string) {
  const el = input.value!
  const value = el.value
  let start = el.selectionStart ?? value.length
  const end = el.selectionEnd ?? start
  // Typed: replace the "{{word" already there. From the button: insert at the caret.
  if (open.value?.typed) start -= 2 + (open.value.query.length ?? 0)
  const token = `{{${key}}}`
  const next = value.slice(0, start) + token + value.slice(end)
  emit('update:modelValue', next)
  open.value = null
  nextTick(() => {
    el.focus()
    el.setSelectionRange(start + token.length, start + token.length)
  })
}
</script>

<template>
  <div class="relative">
    <input
      ref="input"
      :class="[FIELD, 'pr-10']"
      :value="modelValue"
      :placeholder="placeholder"
      :data-test="testId"
      @input="onInput"
      @keydown="onKeydown"
      @blur="open?.typed && (open = null)"
    />
    <button
      ref="button"
      type="button"
      class="absolute right-1 top-1/2 flex h-7 w-8 -translate-y-1/2 items-center justify-center rounded-ctlSm font-mono text-[12px] font-semibold text-ink-muted hover:bg-surface-subtle hover:text-brand-text touch:h-9 touch:w-10"
      :aria-label="t('Insert a field', 'Insertar un campo')"
      :title="t('Insert a field ({{ also works)', 'Insertar un campo (también con {{)')"
      :data-test="testId ? `${testId}-fields` : undefined"
      @mousedown.prevent
      @click="openFromButton"
    >{ }</button>
    <AutomationsVariablePicker
      v-if="open"
      ref="picker"
      :variables="variables"
      :at="open.at"
      :searchable="!open.typed"
      :query="open.query"
      @pick="pick"
      @close="open = null"
    />
  </div>
</template>

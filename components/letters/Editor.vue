<script setup lang="ts">
// The body of a letter or a letter template: paragraphs, bold/italic/
// underline and lists, via execCommand. What it emits is the raw innerHTML;
// whoever saves it reduces it with sanitizeLetterHtml (utils/letters.ts),
// and what it is given is reduced the same way before it reaches innerHTML,
// because a body is written by any member through the Data API.
//
// `fields` adds the merge-field picker (Settings > Letters). A letter on the
// record is already filled in, so it has none: a token typed there would
// print as written. `readonly` shows the letter without the toolbar, for
// someone who may read it but not change it.
import { LETTER_MERGE_FIELDS } from '~/utils/docFields'
import { sanitizeLetterHtml } from '~/utils/letters'

const props = defineProps<{ modelValue: string; fields?: boolean; label?: string; readonly?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const t = useT()
const editorRef = ref<HTMLDivElement | null>(null)
let lastEmitted: string | null = null

function render(value: string) {
  if (editorRef.value) editorRef.value.innerHTML = sanitizeLetterHtml(value)
}
onMounted(() => {
  render(props.modelValue)
  document.addEventListener('selectionchange', rememberSelection)
})
onUnmounted(() => document.removeEventListener('selectionchange', rememberSelection))
watch(
  () => props.modelValue,
  (value) => {
    if (value !== lastEmitted) render(value)
  },
)

function onInput() {
  lastEmitted = editorRef.value?.innerHTML ?? ''
  emit('update:modelValue', lastEmitted)
}

// The picker is a <select>, which takes focus and the caret with it; the
// last caret inside the editor is where a field goes.
let savedRange: Range | null = null
function rememberSelection() {
  const selection = window.getSelection()
  if (!selection || !selection.rangeCount || !editorRef.value) return
  const range = selection.getRangeAt(0)
  if (editorRef.value.contains(range.commonAncestorContainer)) savedRange = range.cloneRange()
}
function restoreSelection() {
  editorRef.value?.focus()
  const selection = window.getSelection()
  if (savedRange && selection) {
    selection.removeAllRanges()
    selection.addRange(savedRange)
  }
}

function exec(command: string) {
  restoreSelection()
  document.execCommand(command)
  onInput()
}

function onFocus() {
  // Enter makes a <p>, not a <div>: the same either way to the parser, but
  // the editor's own spacing is styled on paragraphs.
  document.execCommand('defaultParagraphSeparator', false, 'p')
}

function onKeydown(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return
  const key = e.key.toLowerCase()
  if (key === 'b' || key === 'i' || key === 'u') {
    e.preventDefault()
    exec({ b: 'bold', i: 'italic', u: 'underline' }[key] as string)
  }
}

// Plain text only: a paste from Word brings fonts, colours and tables a
// letter cannot print.
function onPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text/plain') ?? ''
  e.preventDefault()
  if (!text) return
  document.execCommand('insertText', false, text)
  onInput()
}

const fieldChoice = ref('')
function insertField(key: string) {
  fieldChoice.value = ''
  if (!key) return
  restoreSelection()
  document.execCommand('insertText', false, `{{${key}}}`)
  onInput()
}

const toolbarBtn = 'flex h-7 min-w-7 touch:h-10 touch:min-w-10 items-center justify-center rounded-ctlSm px-1.5 text-[13px] text-ink-600 hover:bg-line-faint'
</script>

<template>
  <div class="overflow-hidden rounded-ctl border border-line-control bg-surface">
    <div v-if="!readonly" class="flex flex-wrap items-center gap-1 border-b border-line-control bg-surface-subtle px-2 py-1.5" role="toolbar" :aria-label="t('Formatting', 'Formato')">
      <button type="button" :class="[toolbarBtn, 'font-bold']" :title="t('Bold (Ctrl/Cmd + B)', 'Negrita (Ctrl/Cmd + B)')" @mousedown.prevent @click="exec('bold')">B</button>
      <button type="button" :class="[toolbarBtn, 'italic']" :title="t('Italic (Ctrl/Cmd + I)', 'Cursiva (Ctrl/Cmd + I)')" @mousedown.prevent @click="exec('italic')">I</button>
      <button type="button" :class="[toolbarBtn, 'underline']" :title="t('Underline (Ctrl/Cmd + U)', 'Subrayado (Ctrl/Cmd + U)')" @mousedown.prevent @click="exec('underline')">U</button>
      <span class="mx-1 h-4 w-px bg-line-control" aria-hidden="true"></span>
      <button type="button" :class="toolbarBtn" :title="t('Bulleted list', 'Lista con viñetas')" :aria-label="t('Bulleted list', 'Lista con viñetas')" @mousedown.prevent @click="exec('insertUnorderedList')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" fill="currentColor" /><circle cx="4.5" cy="12" r="1" fill="currentColor" /><circle cx="4.5" cy="18" r="1" fill="currentColor" /></svg>
      </button>
      <button type="button" :class="toolbarBtn" :title="t('Numbered list', 'Lista numerada')" :aria-label="t('Numbered list', 'Lista numerada')" @mousedown.prevent @click="exec('insertOrderedList')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10 6h10M10 12h10M10 18h10M4 4.5h1.5V9M4 9h3M4 14.5c.5-.7 2.8-.9 2.8.6 0 1-2.8 2-2.8 3.4h3" /></svg>
      </button>
      <select
        v-if="fields"
        v-model="fieldChoice"
        data-cy="letter-field-picker"
        class="ml-auto h-7 touch:h-10 rounded-ctlSm border border-line-control bg-surface px-2 text-[12.5px] text-ink-700 focus:border-brand focus:outline-none"
        :aria-label="t('Insert a field', 'Insertar un campo')"
        @change="insertField(fieldChoice)"
      >
        <option value="">{{ t('+ Insert a field…', '+ Insertar un campo…') }}</option>
        <option v-for="f in LETTER_MERGE_FIELDS" :key="f.key" :value="f.key">{{ t(f.en, f.es) }}{{ f.clinical ? ` (${t('clinical', 'clínico')})` : '' }}</option>
      </select>
    </div>
    <div
      ref="editorRef"
      data-cy="letter-body"
      :contenteditable="readonly ? 'false' : 'true'"
      role="textbox"
      :aria-readonly="readonly ? 'true' : undefined"
      aria-multiline="true"
      :aria-label="label ?? t('Letter', 'Carta')"
      class="min-h-[320px] px-5 py-4 text-[14px] leading-relaxed text-ink-900 focus:outline-none [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6"
      @input="onInput"
      @focus="onFocus"
      @keydown="onKeydown"
      @paste="onPaste"
    ></div>
  </div>
</template>

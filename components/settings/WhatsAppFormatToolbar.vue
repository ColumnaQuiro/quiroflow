<script setup lang="ts">
import {
  insertWhatsAppText,
  toggleWhatsAppLines,
  toggleWhatsAppStyle,
  type WhatsAppEdit,
  type WhatsAppLineKind,
  type WhatsAppStyle,
} from '~/utils/whatsappFormatting'

// The formatting a WhatsApp message takes, as buttons over the box it is
// written in: bold, italic, strikethrough, monospace and inline code around
// the selection, lists and quotes on its lines, and emoji at the cursor.
// `formatting: false` leaves the emoji alone, for a footer.
//
// Edits go through the browser's own insertText where it has it, so Cmd+Z
// takes them back like typing; the v-model is only set directly when it
// does not.

const props = withDefaults(defineProps<{ field: HTMLTextAreaElement | HTMLInputElement | null; formatting?: boolean }>(), { formatting: true })
const model = defineModel<string>({ required: true })
const t = useT()
const { preference } = useLang()

const isMac = import.meta.client && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl+'

const STYLES: { style: WhatsAppStyle; en: string; es: string; sample: string; key?: string; glyph: string; glyphClass: string }[] = [
  { style: 'bold', en: 'Bold', es: 'Negrita', sample: '*', key: 'b', glyph: 'B', glyphClass: 'font-bold' },
  { style: 'italic', en: 'Italic', es: 'Cursiva', sample: '_', key: 'i', glyph: 'I', glyphClass: 'italic font-serif' },
  { style: 'strike', en: 'Strikethrough', es: 'Tachado', sample: '~', glyph: 'S', glyphClass: 'line-through' },
  { style: 'mono', en: 'Monospace', es: 'Monoespaciado', sample: '```', glyph: 'M', glyphClass: 'font-mono' },
  { style: 'code', en: 'Inline code', es: 'Código en línea', sample: '`', glyph: '</>', glyphClass: 'font-mono text-[11px]' },
]
const LINES: { kind: WhatsAppLineKind; en: string; es: string; sample: string; glyph: string }[] = [
  { kind: 'bullet', en: 'Bulleted list', es: 'Lista con viñetas', sample: '- ', glyph: '•' },
  { kind: 'numbered', en: 'Numbered list', es: 'Lista numerada', sample: '1. ', glyph: '1.' },
  { kind: 'quote', en: 'Quote', es: 'Cita', sample: '> ', glyph: '❝' },
]
const styleTitle = (s: (typeof STYLES)[number]) => `${t(s.en, s.es)} (${s.sample}${t('text', 'texto')}${s.sample})${s.key ? ` · ${mod}${s.key.toUpperCase()}` : ''}`

function apply(edit: WhatsAppEdit) {
  const el = props.field
  const before = model.value
  if (!el || !import.meta.client) {
    model.value = edit.text
    return
  }
  // Only the part that changed is replaced, so undo takes back just that.
  let head = 0
  while (head < before.length && head < edit.text.length && before[head] === edit.text[head]) head++
  let tail = 0
  while (tail < before.length - head && tail < edit.text.length - head && before[before.length - 1 - tail] === edit.text[edit.text.length - 1 - tail]) tail++
  const middle = edit.text.slice(head, edit.text.length - tail)
  el.focus()
  el.setSelectionRange(head, before.length - tail)
  let done = false
  try {
    done = document.execCommand(middle ? 'insertText' : 'delete', false, middle)
  } catch {
    done = false
  }
  if (!done || el.value !== edit.text) {
    el.value = edit.text
    model.value = edit.text
  }
  el.setSelectionRange(edit.start, edit.end)
  // The v-model may write the value back on the next render; the selection has to survive it.
  nextTick(() => {
    if (el.value === edit.text) el.setSelectionRange(edit.start, edit.end)
  })
}

function selection(): [number, number] {
  const el = props.field
  const end = model.value.length
  return el ? [el.selectionStart ?? end, el.selectionEnd ?? end] : [end, end]
}
const style = (s: WhatsAppStyle) => apply(toggleWhatsAppStyle(model.value, ...selection(), s))
const lines = (k: WhatsAppLineKind) => apply(toggleWhatsAppLines(model.value, ...selection(), k))
const insert = (text: string) => apply(insertWhatsAppText(model.value, ...selection(), text))

// Cmd/Ctrl+B and +I in the box, as in any editor.
function onFieldKeydown(e: Event) {
  const k = e as KeyboardEvent
  if (!props.formatting || !(k.metaKey || k.ctrlKey) || k.altKey || k.shiftKey) return
  const s = STYLES.find((x) => x.key === k.key.toLowerCase())
  if (!s) return
  k.preventDefault()
  style(s.style)
}
watch(
  () => props.field,
  (el, old) => {
    old?.removeEventListener('keydown', onFieldKeydown)
    el?.addEventListener('keydown', onFieldKeydown)
  },
  { immediate: true },
)
onBeforeUnmount(() => props.field?.removeEventListener('keydown', onFieldKeydown))

// ---- Emoji -------------------------------------------------------------------
// emoji-picker-element and its emoji list (~420 KB of JSON per language,
// ~60 KB over the wire) are fetched the first time someone opens it, and
// from QuiroFlow itself rather than the CDN the library uses by default. The
// library keeps the list in IndexedDB after that.
type Lang = 'en' | 'es' | 'pt' | 'de'
const EMOJI_DATA: Record<Lang, () => Promise<{ default: string }>> = {
  en: () => import('emoji-picker-element-data/en/cldr/data.json?url'),
  es: () => import('emoji-picker-element-data/es/cldr/data.json?url'),
  pt: () => import('emoji-picker-element-data/pt/cldr/data.json?url'),
  de: () => import('emoji-picker-element-data/de/cldr/data.json?url'),
}
const EMOJI_I18N: Partial<Record<Lang, () => Promise<{ default: unknown }>>> = {
  es: () => import('emoji-picker-element/i18n/es.js'),
  pt: () => import('emoji-picker-element/i18n/pt_PT.js'),
  de: () => import('emoji-picker-element/i18n/de.js'),
}

const open = ref(false)
const loading = ref(false)
const failed = ref(false)
const wrap = ref<HTMLElement | null>(null)
const pickerHost = ref<HTMLElement | null>(null)
const emojiButton = ref<HTMLButtonElement | null>(null)
let picker: HTMLElement | null = null

async function mountPicker() {
  if (picker || loading.value) return
  loading.value = true
  failed.value = false
  try {
    const lang: Lang = (['en', 'es', 'pt', 'de'] as const).find((l) => l === preference.value) ?? 'en'
    const [{ Picker }, data, i18n] = await Promise.all([import('emoji-picker-element'), EMOJI_DATA[lang](), EMOJI_I18N[lang]?.()])
    const el = new Picker({
      dataSource: data.default,
      locale: lang,
      ...(i18n ? { i18n: i18n.default as never } : {}),
    }) as unknown as HTMLElement
    // The app's own colours, through its tokens, so it follows light and dark
    // like everything around it; the class picks the library's defaults for
    // whatever the tokens do not cover.
    el.classList.add(getComputedStyle(document.documentElement).colorScheme.includes('dark') ? 'dark' : 'light')
    const token = (name: string) => `rgb(var(${name}))`
    const vars: Record<string, string> = {
      '--num-columns': '8',
      '--emoji-size': '1.35rem',
      '--border-size': '0',
      '--background': 'transparent',
      '--border-color': token('--color-line'),
      '--input-border-color': token('--color-line-control'),
      '--input-font-color': token('--color-ink-900'),
      '--input-placeholder-color': token('--color-ink-faint'),
      '--category-font-color': token('--color-ink-muted'),
      '--indicator-color': token('--color-brand'),
      '--outline-color': token('--color-brand'),
      '--button-hover-background': token('--color-chip-bg'),
      '--button-active-background': token('--color-chip-bg'),
    }
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v)
    el.style.width = 'min(332px, calc(100vw - 64px))'
    el.style.height = '320px'
    el.addEventListener('emoji-click', (e) => {
      const unicode = (e as CustomEvent<{ unicode?: string }>).detail.unicode
      if (unicode) insert(unicode)
    })
    picker = el
    pickerHost.value?.appendChild(el)
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}

function toggleEmoji() {
  open.value = !open.value
  if (open.value) nextTick(mountPicker)
}
function closeEmoji(refocus = false) {
  open.value = false
  if (refocus) emojiButton.value?.focus()
}
// The picker draws in its own shadow DOM, so where a click landed is asked of
// composedPath, not of contains.
function onDocumentPointer(e: PointerEvent) {
  if (open.value && wrap.value && !e.composedPath().includes(wrap.value)) closeEmoji()
}
// Escape closes the picker, not the dialog it sits in: useFocusTrap leaves an
// Escape somebody already handled alone.
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) {
    e.preventDefault()
    closeEmoji(true)
  }
}
onMounted(() => document.addEventListener('pointerdown', onDocumentPointer))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointer))

const BTN = 'flex h-7 min-w-7 items-center justify-center rounded-ctlSm px-1 text-[13px] text-ink-700 hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand touch:h-11 touch:min-w-11'
</script>

<template>
  <div ref="wrap" class="relative flex flex-wrap items-center gap-0.5" role="toolbar" :aria-label="t('Formatting', 'Formato')" data-cy="wa-format-toolbar" @keydown="onKeydown">
    <template v-if="formatting">
      <!-- mousedown.prevent keeps the box's selection while the button is pressed. -->
      <button
        v-for="s in STYLES"
        :key="s.style"
        type="button"
        :class="BTN"
        :title="styleTitle(s)"
        :aria-label="t(s.en, s.es)"
        :data-cy="`wa-format-${s.style}`"
        @mousedown.prevent
        @click="style(s.style)"
      >
        <span :class="s.glyphClass" aria-hidden="true">{{ s.glyph }}</span>
      </button>
      <span class="mx-1 h-4 w-px bg-line-row" aria-hidden="true" />
      <button
        v-for="l in LINES"
        :key="l.kind"
        type="button"
        :class="BTN"
        :title="`${t(l.en, l.es)} (${l.sample})`"
        :aria-label="t(l.en, l.es)"
        :data-cy="`wa-format-${l.kind}`"
        @mousedown.prevent
        @click="lines(l.kind)"
      >
        <span aria-hidden="true">{{ l.glyph }}</span>
      </button>
      <span class="mx-1 h-4 w-px bg-line-row" aria-hidden="true" />
    </template>
    <button
      ref="emojiButton"
      type="button"
      :class="BTN"
      :title="t('Emoji', 'Emoji')"
      :aria-label="t('Emoji', 'Emoji')"
      :aria-expanded="open"
      aria-haspopup="dialog"
      data-cy="wa-format-emoji"
      @mousedown.prevent
      @click="toggleEmoji"
    >
      <span aria-hidden="true">🙂</span>
    </button>

    <div
      v-show="open"
      class="absolute right-0 top-full z-20 mt-1 rounded-card border border-line bg-surface p-1 shadow-popover"
      :class="formatting ? 'sm:left-0 sm:right-auto' : ''"
      role="dialog"
      :aria-label="t('Emoji', 'Emoji')"
      data-cy="wa-format-emoji-picker"
    >
      <p v-if="loading" class="px-3 py-6 text-center text-[12.5px] text-ink-muted">{{ t('Loading…', 'Cargando…') }}</p>
      <p v-else-if="failed" class="px-3 py-6 text-center text-[12.5px] text-danger-text">
        {{ t('The emoji could not be loaded.', 'No se han podido cargar los emojis.') }}
        <button type="button" class="font-semibold underline" @click="mountPicker">{{ t('Try again', 'Reintentar') }}</button>
      </p>
      <div ref="pickerHost" />
    </div>
  </div>
</template>

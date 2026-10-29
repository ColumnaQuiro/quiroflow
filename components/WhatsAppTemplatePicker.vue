<script setup lang="ts">
// Choosing a WhatsApp template by what it says. The send dialogs used to
// offer a <select> of raw Meta names ("recall_sin_proxima_cita (es)"), so the
// only way to read a template was to pick it. Here each one is a card with a
// readable name and the start of its text, with {{n}} already filled in where
// the dialog knows the value, plus a search box and a language filter, since
// every template tends to exist in es/en/fr and would otherwise be listed
// three times.
//
// The picker only chooses: the dialog keeps the selected key and does what it
// always did with it (full text, variable fields, attachment, send).

interface WhatsAppPickerTemplate {
  name: string
  language: string
  category: string
  bodyText: string
}

const props = defineProps<{
  templates: WhatsAppPickerTemplate[]
  /** The selected template's `name::language` key, or ''. */
  modelValue: string
  /** The patient's language ('es', 'en'...), which the list opens on. */
  preferredLanguage?: string | null
  /** Values for {{1}}, {{2}}... in the previews; '' leaves the slot showing. */
  fill?: string[]
  /** What an unfilled slot stands for, e.g. { 1: 'first name' } in a bulk send. */
  slotLabels?: Record<number, string>
}>()
const emit = defineEmits<{ 'update:modelValue': [key: string] }>()

const t = useT()

function keyOf(tpl: Pick<WhatsAppPickerTemplate, 'name' | 'language'>) {
  return `${tpl.name}::${tpl.language}`
}
function baseLanguage(code: string) {
  return code.split('_')[0]!.toLowerCase()
}

const LANGUAGE_NAMES: Record<string, string> = {
  es: 'Español',
  en: 'English',
  fr: 'Français',
  ca: 'Català',
  pt: 'Português',
  de: 'Deutsch',
  it: 'Italiano',
}
function languageName(code: string) {
  return LANGUAGE_NAMES[baseLanguage(code)] ?? code.toUpperCase()
}

// "recall_sin_proxima_cita" -> "Recall sin proxima cita". Meta only allows
// lowercase, digits and underscores, so this is all a name can be turned into.
function readableName(name: string) {
  const words = name.replace(/_+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const selected = computed(() => props.templates.find((tpl) => keyOf(tpl) === props.modelValue) ?? null)

// The languages in use: the patient's first, then by how many templates each has.
const languages = computed(() => {
  const counts = new Map<string, number>()
  for (const tpl of props.templates) counts.set(baseLanguage(tpl.language), (counts.get(baseLanguage(tpl.language)) ?? 0) + 1)
  const preferred = props.preferredLanguage ? baseLanguage(props.preferredLanguage) : ''
  return [...counts.keys()].sort((a, b) => Number(b === preferred) - Number(a === preferred) || counts.get(b)! - counts.get(a)! || a.localeCompare(b))
})

// The chosen template's language, else the patient's, else the one most of
// the clinic's templates are written in -- the nearest thing to a clinic
// language there is, and the right one for a bulk send to many patients.
function initialLanguage() {
  if (selected.value) return baseLanguage(selected.value.language)
  return languages.value[0] ?? 'all'
}

const language = ref(initialLanguage())
const query = ref('')
// Open until something is chosen; a preselected template (Recalls, "send the
// app") opens closed, on that template, with Change to see the others.
const open = ref(!selected.value)

// The dialogs load their templates after mounting, so the language has to be
// worked out again once they arrive.
watch(
  () => props.templates.length,
  () => {
    language.value = initialLanguage()
    open.value = !selected.value
  },
)

function normalise(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

const visible = computed(() => {
  const q = normalise(query.value.trim())
  return props.templates.filter((tpl) => {
    if (language.value !== 'all' && baseLanguage(tpl.language) !== language.value) return false
    if (!q) return true
    return normalise(`${tpl.name} ${readableName(tpl.name)} ${tpl.bodyText}`).includes(q)
  })
})
// Matches the language filter is hiding, so an empty list can offer them.
const hiddenMatches = computed(() => {
  if (language.value === 'all' || !query.value.trim()) return 0
  const q = normalise(query.value.trim())
  return props.templates.filter((tpl) => normalise(`${tpl.name} ${readableName(tpl.name)} ${tpl.bodyText}`).includes(q)).length
})

type Segment = { text: string; slot?: number; filled?: boolean }
// The body split around its {{n}} slots, so a filled value can be drawn
// apart from the template's own words and an unfilled one as a chip.
function segments(body: string): Segment[] {
  const out: Segment[] = []
  let last = 0
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    if (m.index! > last) out.push({ text: body.slice(last, m.index) })
    const n = Number(m[1])
    const value = props.fill?.[n - 1]?.trim()
    out.push(value ? { text: value, slot: n, filled: true } : { text: props.slotLabels?.[n] ?? `{{${n}}}`, slot: n, filled: false })
    last = m.index! + m[0].length
  }
  if (last < body.length) out.push({ text: body.slice(last) })
  return out
}

function choose(tpl: WhatsAppPickerTemplate) {
  emit('update:modelValue', keyOf(tpl))
  open.value = false
  query.value = ''
}

const CATEGORY_LABELS: Record<string, [string, string]> = {
  MARKETING: ['Marketing', 'Marketing'],
  UTILITY: ['Utility', 'Servicio'],
  AUTHENTICATION: ['Authentication', 'Autenticación'],
}
function categoryLabel(category: string) {
  const labels = CATEGORY_LABELS[category]
  return labels ? t(...labels) : category
}
</script>

<template>
  <div data-cy="whatsapp-template-picker">
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs font-medium text-ink-muted">{{ t('Template', 'Plantilla') }}</span>
      <button v-if="selected && !open" type="button" class="text-xs font-semibold text-brand-text hover:underline" data-cy="whatsapp-template-change" @click="open = true">
        {{ t('Change', 'Cambiar') }}
      </button>
      <button v-else-if="selected && open" type="button" class="text-xs font-semibold text-ink-muted hover:underline" @click="open = false">
        {{ t('Keep', 'Mantener') }} «{{ readableName(selected.name) }}»
      </button>
    </div>

    <!-- Chosen: one line, the dialog shows the whole message under it. -->
    <div v-if="selected && !open" class="mt-1 flex items-center gap-2 rounded-ctl border border-brand-tintBorder bg-brand-tint px-3 py-2" data-cy="whatsapp-template-selected">
      <span class="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-900">{{ readableName(selected.name) }}</span>
      <span class="shrink-0 text-[11px] font-medium text-ink-muted">{{ languageName(selected.language) }}</span>
    </div>

    <template v-else>
      <input
        v-model="query"
        type="search"
        :placeholder="t('Search by name or text', 'Buscar por nombre o texto')"
        :aria-label="t('Search templates', 'Buscar plantillas')"
        class="mt-1 h-9 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-900 placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
        data-cy="whatsapp-template-search"
      />

      <div v-if="languages.length > 1" class="mt-2 flex flex-wrap gap-1.5" role="group" :aria-label="t('Language', 'Idioma')">
        <button
          v-for="code in [...languages, 'all']"
          :key="code"
          type="button"
          class="rounded-pill border px-2.5 py-1 text-[12px] font-semibold"
          :class="language === code ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line bg-surface text-ink-600 hover:bg-surface-subtle'"
          :aria-pressed="language === code"
          :data-cy="`whatsapp-template-lang-${code}`"
          @click="language = code"
        >
          {{ code === 'all' ? t('All', 'Todos') : languageName(code) }}
        </button>
      </div>

      <ul class="mt-2 max-h-[min(22rem,50vh)] space-y-1.5 overflow-y-auto overscroll-contain pr-0.5" data-cy="whatsapp-template-list">
        <li v-for="tpl in visible" :key="keyOf(tpl)">
          <button
            type="button"
            class="w-full rounded-ctl border px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
            :class="keyOf(tpl) === modelValue ? 'border-brand bg-brand-tint' : 'border-line bg-surface hover:border-line-controlHover hover:bg-surface-subtle'"
            :aria-pressed="keyOf(tpl) === modelValue"
            data-cy="whatsapp-template-card"
            @click="choose(tpl)"
          >
            <span class="flex items-baseline gap-2">
              <span class="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-900">{{ readableName(tpl.name) }}</span>
              <span class="shrink-0 text-[11px] font-medium text-ink-faint">
                <template v-if="language === 'all'">{{ languageName(tpl.language) }} · </template>{{ categoryLabel(tpl.category) }}
              </span>
            </span>
            <span class="mt-1 line-clamp-3 whitespace-pre-line text-xs leading-snug text-ink-muted2">
              <template v-for="(seg, i) in segments(tpl.bodyText)" :key="i">
                <span v-if="seg.slot && seg.filled" class="font-semibold text-ink-800">{{ seg.text }}</span>
                <span v-else-if="seg.slot" class="rounded bg-chip-bg px-1 text-[11px] text-chip-text" :class="{ 'font-mono': !slotLabels?.[seg.slot] }">{{ seg.text }}</span>
                <template v-else>{{ seg.text }}</template>
              </template>
            </span>
          </button>
        </li>
        <li v-if="visible.length === 0" class="rounded-ctl border border-dashed border-line px-3 py-4 text-center text-[13px] text-ink-faint">
          {{ t('No template matches.', 'Ninguna plantilla coincide.') }}
          <button v-if="hiddenMatches > 0" type="button" class="font-semibold text-brand-text hover:underline" @click="language = 'all'">
            {{ t(`See ${hiddenMatches} in other languages`, `Ver ${hiddenMatches} en otros idiomas`) }}
          </button>
        </li>
      </ul>
    </template>
  </div>
</template>

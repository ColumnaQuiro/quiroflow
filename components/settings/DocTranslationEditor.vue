<script setup lang="ts">
// Settings > Docs > a form's language tab: the form's words in another
// language, block by block beside the original's (utils/docTranslations.ts).
// Only the words: what the form asks, in what order and how, is edited on
// the original's tab and reaches every language at once.
//
// "Translate with AI" fills in what is missing (or all of it again) through
// /api/docs/translate-form, a batch at a time so a long consent form fits
// in a function's time limit. Nothing is saved here; the page's Save keeps it.
import type { DocField } from '~/utils/docFields'
import type { DocBlockTranslation, DocLanguage, DocTranslation } from '~/utils/docTranslations'
import type { TranslateResult } from '~/utils/aiFormTranslate'

const props = defineProps<{
  fields: DocField[]
  title: string
  language: DocLanguage
  modelValue: DocTranslation
}>()
const emit = defineEmits<{ 'update:modelValue': [value: DocTranslation]; remove: [] }>()

const t = useT()

const blocks = computed(() => translatableBlocks(props.fields))
const missing = computed(() => new Set(untranslatedBlockIds(props.fields, props.modelValue)))
const languageName = computed(() => docLanguageName(props.language, t))

function blockOf(id: string): DocBlockTranslation {
  return props.modelValue.fields?.[id] ?? {}
}
function setBlock(id: string, next: DocBlockTranslation) {
  emit('update:modelValue', { ...props.modelValue, fields: { ...(props.modelValue.fields ?? {}), [id]: next } })
}
function setLabel(f: DocField, label: string) {
  setBlock(f.id, { ...blockOf(f.id), label })
}
function setOption(f: DocField, i: number, value: string) {
  const current = blockOf(f.id).options
  const options = (f.options ?? []).map((_, j) => (j === i ? value : (current?.[j] ?? '')))
  setBlock(f.id, { ...blockOf(f.id), options })
}
function setTitle(title: string) {
  emit('update:modelValue', { ...props.modelValue, title })
}

const KIND: Record<string, [string, string]> = {
  heading: ['Heading', 'Título'],
  text: ['Text', 'Texto'],
  short_text: ['Short answer', 'Respuesta corta'],
  long_text: ['Long answer', 'Respuesta larga'],
  checkbox: ['Checkbox', 'Casilla'],
  choice: ['Options', 'Opciones'],
  scale: ['Number scale', 'Escala numérica'],
  rating: ['Rating', 'Valoración'],
  date: ['Date', 'Fecha'],
  signature: ['Signature', 'Firma'],
  drawable_image: ['Drawable image', 'Imagen para dibujar'],
}
const kindOf = (f: DocField) => {
  const k = KIND[f.type]
  return k ? t(k[0], k[1]) : f.type
}
const rowsFor = (text: string) => Math.min(14, Math.max(2, Math.ceil(text.length / 80) + 1))

// ---- "Translate with AI"
const translating = ref(false)
const done = ref(0)
const total = ref(0)
const aiError = ref('')
const aiNote = ref('')

async function translateWithAi(onlyMissing: boolean) {
  if (translating.value) return
  aiError.value = ''
  aiNote.value = ''
  const wanted = blocks.value.filter((f) => !onlyMissing || missing.value.has(f.id))
  const payload = wanted.map((f) => ({
    id: f.id,
    type: f.type,
    label: f.label,
    ...(f.type === 'choice' && f.options?.length ? { options: f.options } : {}),
  }))
  const needTitle = !onlyMissing || !props.modelValue.title?.trim()
  const batches = translationBatches(payload, needTitle && props.title.trim() ? props.title.trim() : undefined)
  if (batches.length === 0) return
  translating.value = true
  done.value = 0
  total.value = batches.length
  // What came back so far, laid over what the person had: each batch shows
  // as soon as it lands.
  let current: DocTranslation = { ...props.modelValue, fields: { ...(props.modelValue.fields ?? {}) } }
  let skipped = 0
  let stop = false
  async function one(batch: (typeof batches)[number]) {
    if (stop) return
    try {
      const res = await $fetch<
        | { available: false }
        | { available: true; limit: 'hour' | 'day' }
        | { available: true; refused: true }
        | { available: true; translation: TranslateResult }
      >('/api/docs/translate-form', { method: 'POST', body: { language: props.language, ...batch } })
      if (!res.available) {
        stop = true
        aiError.value = t('Translating with AI is not available right now.', 'Traducir con IA no está disponible ahora mismo.')
      } else if ('limit' in res) {
        stop = true
        aiError.value = res.limit === 'hour'
          ? t('Your clinic has translated a lot this hour. Try again in a while.', 'Tu clínica ha traducido mucho en esta hora. Vuelve a intentarlo dentro de un rato.')
          : t("Your clinic has reached today's limit of AI translations. Try again tomorrow.", 'Tu clínica ha llegado al límite de traducciones con IA de hoy. Vuelve a intentarlo mañana.')
      } else if ('refused' in res) {
        skipped += batch.blocks.length
      } else {
        const got = res.translation
        skipped += batch.blocks.filter((b) => !got.fields[b.id]).length
        current = {
          ...current,
          ...(got.title ? { title: got.title } : {}),
          fields: { ...(current.fields ?? {}), ...got.fields },
        }
        emit('update:modelValue', current)
      }
    } catch (err: any) {
      skipped += batch.blocks.length
      aiError.value = err?.data?.statusMessage ?? t('Part of the form could not be translated. Try again.', 'Una parte del formulario no se ha podido traducir. Vuelve a intentarlo.')
    } finally {
      done.value += 1
    }
  }
  // Three at a time: a long form finishes in the time of its slowest third.
  const queue = [...batches]
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) await one(queue.shift()!)
  }))
  translating.value = false
  if (!aiError.value && skipped > 0) {
    aiNote.value = skipped === 1
      ? t('1 block could not be translated and is marked below.', '1 bloque no se ha podido traducir y está marcado abajo.')
      : t(`${skipped} blocks could not be translated and are marked below.`, `${skipped} bloques no se han podido traducir y están marcados abajo.`)
  }
}
</script>

<template>
  <div class="flex flex-col gap-4" data-cy="doc-translation" :data-language="language">
    <div class="flex flex-col gap-2 rounded-ctl border border-line bg-surface-subtle px-3.5 py-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="flex-1 text-[13.5px] text-ink-700">
          <template v-if="missing.size === 0">{{ t(`All of it is in ${languageName}.`, `Todo está en ${languageName.toLowerCase()}.`) }}</template>
          <template v-else-if="missing.size === blocks.length">{{ t(`Not translated into ${languageName} yet.`, `Aún sin traducir al ${languageName.toLowerCase()}.`) }}</template>
          <template v-else>
            <strong data-cy="doc-translation-missing">{{ missing.size }}</strong>
            {{ missing.size === 1 ? t('block still to translate.', 'bloque por traducir.') : t('blocks still to translate.', 'bloques por traducir.') }}
          </template>
        </span>
        <UiBtn v-if="missing.size > 0" variant="primary" size="sm" :disabled="translating" data-cy="doc-translate-ai" @click="translateWithAi(true)">
          <template v-if="translating">{{ t(`Translating… ${done}/${total}`, `Traduciendo… ${done}/${total}`) }}</template>
          <template v-else-if="missing.size === blocks.length">{{ t('Translate with AI', 'Traducir con IA') }}</template>
          <template v-else>{{ t('Translate what is missing with AI', 'Traducir lo que falta con IA') }}</template>
        </UiBtn>
        <UiBtn v-else size="sm" :disabled="translating" data-cy="doc-translate-ai-again" @click="translateWithAi(false)">
          {{ translating ? t(`Translating… ${done}/${total}`, `Traduciendo… ${done}/${total}`) : t('Translate it all again with AI', 'Volver a traducir todo con IA') }}
        </UiBtn>
        <UiBtn size="sm" variant="ghost" :disabled="translating" data-cy="doc-translation-remove" @click="emit('remove')">{{ t('Remove language', 'Quitar idioma') }}</UiBtn>
      </div>
      <p class="text-[12.5px] leading-snug text-ink-muted">
        {{ t(`Patients whose language is ${languageName} are sent this version. The questions are the original's: add, remove or reorder them on the Spanish tab and they change here too. A block not translated yet goes out in Spanish.`, `Los pacientes con idioma ${languageName.toLowerCase()} reciben esta versión. Las preguntas son las del original: se añaden, quitan o reordenan en la pestaña de español y cambian aquí también. Un bloque aún sin traducir se envía en español.`) }}
      </p>
      <p v-if="aiError" role="alert" class="text-[13px] text-danger-text" data-cy="doc-translate-error">{{ aiError }}</p>
      <p v-else-if="aiNote" class="text-[13px] text-warning-text">{{ aiNote }}</p>
    </div>

    <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
      {{ t('Name', 'Nombre') }}
      <span class="text-[12.5px] font-normal text-ink-muted">{{ title }}</span>
      <input
        :value="modelValue.title ?? ''"
        type="text"
        :placeholder="title"
        data-cy="doc-translation-title"
        class="h-10 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[16px] font-semibold text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        @input="setTitle(($event.target as HTMLInputElement).value)"
      />
    </label>

    <p v-if="blocks.length === 0" class="text-[13.5px] text-ink-muted">{{ t('This form has no text to translate yet.', 'Este formulario aún no tiene texto que traducir.') }}</p>
    <ol class="flex flex-col gap-3">
      <li
        v-for="f in blocks"
        :key="f.id"
        class="flex flex-col gap-2 rounded-ctl border px-3.5 py-3"
        :class="missing.has(f.id) ? 'border-warning-border' : 'border-line'"
        data-cy="doc-translation-block"
        :data-block-id="f.id"
      >
        <div class="flex items-center gap-2">
          <span class="text-[11px] font-[640] uppercase tracking-[.07em] text-ink-faint">{{ kindOf(f) }}</span>
          <UiPill v-if="missing.has(f.id)" tone="warning">{{ t('Not translated', 'Sin traducir') }}</UiPill>
        </div>
        <template v-if="f.label?.trim()">
          <p class="whitespace-pre-line text-[13px] leading-snug text-ink-muted">{{ f.label }}</p>
          <textarea
            v-if="f.type === 'text' || f.label.length > 120"
            :value="blockOf(f.id).label ?? ''"
            :rows="rowsFor(f.label)"
            :aria-label="t(`${kindOf(f)} in ${languageName}`, `${kindOf(f)} en ${languageName.toLowerCase()}`)"
            data-cy="doc-translation-label"
            class="rounded-ctl border border-line-control bg-surface px-3 py-2 text-[14px] leading-snug text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            @input="setLabel(f, ($event.target as HTMLTextAreaElement).value)"
          />
          <input
            v-else
            :value="blockOf(f.id).label ?? ''"
            type="text"
            :aria-label="t(`${kindOf(f)} in ${languageName}`, `${kindOf(f)} en ${languageName.toLowerCase()}`)"
            data-cy="doc-translation-label"
            class="h-10 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            :class="f.type === 'heading' ? 'font-semibold' : ''"
            @input="setLabel(f, ($event.target as HTMLInputElement).value)"
          />
        </template>
        <div v-if="f.type === 'choice' && f.options?.length" class="flex flex-col gap-1.5 pl-3">
          <label v-for="(option, i) in f.options" :key="i" class="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-2 text-[13px] text-ink-muted">
            <span class="truncate">{{ option }}</span>
            <input
              :value="blockOf(f.id).options?.[i] ?? ''"
              type="text"
              :aria-label="t(`Option “${option}” in ${languageName}`, `Opción «${option}» en ${languageName.toLowerCase()}`)"
              data-cy="doc-translation-option"
              class="h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-2.5 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              @input="setOption(f, i, ($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>
      </li>
    </ol>
  </div>
</template>

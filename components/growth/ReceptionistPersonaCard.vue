<script setup lang="ts">
import type { ReceptionistConfig } from '~/composables/useGrowthReceptionist'
import { RECEPTIONIST_LANGUAGES } from '~/utils/receptionistLanguages'

// Who it is when it writes: its name, its tone, the languages it may answer
// in, and what it never says.
const props = defineProps<{
  config: ReceptionistConfig
  saving: boolean
  save: (patch: Partial<ReceptionistConfig>) => Promise<boolean>
}>()

const t = useT()
const { preference } = useLang()

const TONES = [
  { value: 'warm_brief', label: t('Warm and brief', 'Cercano y breve') },
  { value: 'clinical', label: t('Clinical', 'Clínico') },
  { value: 'chatty', label: t('Chatty', 'Conversacional') },
  { value: 'formal', label: t('Formal (usted)', 'Formal (usted)') },
]

const languages = computed(() => Object.entries(RECEPTIONIST_LANGUAGES).map(([code, names]) => ({ code, label: preference.value === 'es' ? names.es : names.en })))

// Languages were shown and not editable, while the prompt read them: a
// clinic in Barcelona could not add Catalan. At least one stays on, because
// the sentence the prompt builds from them cannot name none.
function toggleLanguage(code: string) {
  const current = props.config.languages
  const next = current.includes(code) ? current.filter((l) => l !== code) : [...current, code]
  if (!next.length) return
  props.save({ languages: next })
}
</script>

<template>
  <GrowthSettingCard :title="t('Persona', 'Personalidad')">
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="flex flex-col gap-1">
        <span class="text-[11px] uppercase tracking-[.06em] text-ink-faint">{{ t('Name it answers with', 'Nombre con el que responde') }}</span>
        <input
          :value="config.personaName"
          type="text"
          class="h-8 rounded-ctl border border-line-control bg-surface px-2.5 text-[12.5px] text-ink-700 focus:border-brand focus:outline-none"
          data-test="persona-name"
          @change="save({ personaName: ($event.target as HTMLInputElement).value })"
        >
      </label>
      <div class="flex flex-col gap-1.5">
        <span class="text-[11px] uppercase tracking-[.06em] text-ink-faint">{{ t('Tone', 'Tono') }}</span>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="tone in TONES"
            :key="tone.value"
            type="button"
            class="rounded-pill border px-2.5 py-0.5 text-[11.5px]"
            :class="config.tone === tone.value ? 'border-brand-tintBorder bg-brand-tint font-medium text-brand-text' : 'border-chip-border bg-chip-bg text-ink-muted hover:text-ink-700'"
            :disabled="saving"
            :data-test="`tone-${tone.value}`"
            @click="save({ tone: tone.value })"
          >{{ tone.label }}</button>
        </div>
      </div>
    </div>

    <div class="flex flex-col gap-1.5">
      <span class="text-[11px] uppercase tracking-[.06em] text-ink-faint">{{ t('Languages it answers in', 'Idiomas en los que responde') }}</span>
      <div class="flex flex-wrap gap-1.5" data-test="languages">
        <button
          v-for="lang in languages"
          :key="lang.code"
          type="button"
          class="rounded-pill border px-2.5 py-0.5 text-[11.5px]"
          :class="config.languages.includes(lang.code) ? 'border-brand-tintBorder bg-brand-tint font-medium text-brand-text' : 'border-chip-border bg-chip-bg text-ink-muted hover:text-ink-700'"
          :aria-pressed="config.languages.includes(lang.code)"
          :disabled="saving"
          :data-test="`language-${lang.code}`"
          @click="toggleLanguage(lang.code)"
        >{{ lang.label }}</button>
      </div>
      <p class="text-[11px] leading-[1.5] text-ink-muted">
        {{ t('It replies in the language the patient writes in, within these.', 'Responde en el idioma en que escribe el paciente, dentro de estos.') }}
      </p>
    </div>

    <label class="flex flex-col gap-1">
      <span class="text-[11px] uppercase tracking-[.06em] text-ink-faint">{{ t('Never says', 'Nunca dice') }}</span>
      <textarea
        :value="config.neverSays"
        rows="3"
        :placeholder="t('e.g. Never quote a discount. Never say we treat children.', 'p. ej. Nunca ofrece descuentos. Nunca dice que tratamos a niños.')"
        class="resize-none rounded-ctl border border-line-control bg-surface px-2.5 py-2 text-[11.5px] leading-[1.5] text-ink-700 focus:border-brand focus:outline-none"
        data-test="never-says"
        @change="save({ neverSays: ($event.target as HTMLTextAreaElement).value })"
      />
    </label>
  </GrowthSettingCard>
</template>

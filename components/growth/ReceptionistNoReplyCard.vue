<script setup lang="ts">
import type { ReceptionistConfig } from '~/composables/useGrowthReceptionist'

// Whole messages it leaves alone (utils/receptionistAutoReply.ts,
// isNoReplyMessage): "Confirmar" on the reminder, "Gracias", "👍". No reply,
// no draft. The model can also decide so on its own; this list is the sure,
// free part.
const props = defineProps<{
  config: ReceptionistConfig
  saving: boolean
  save: (patch: Partial<ReceptionistConfig>) => Promise<boolean>
}>()

const t = useT()
const draft = ref('')

function add() {
  const phrase = draft.value.trim().slice(0, 60)
  if (!phrase) return
  props.save({ noReplyPhrases: [...props.config.noReplyPhrases, phrase] })
  draft.value = ''
}
function remove(index: number) {
  props.save({ noReplyPhrases: props.config.noReplyPhrases.filter((_, i) => i !== index) })
}
</script>

<template>
  <GrowthSettingCard :title="t('Messages it does not answer', 'Mensajes que no contesta')">
    <div class="flex flex-wrap gap-1.5" data-test="no-reply-phrases">
      <span
        v-for="(phrase, i) in config.noReplyPhrases"
        :key="`${phrase}-${i}`"
        class="flex items-center gap-1 rounded-pill border border-chip-border bg-chip-bg px-2 py-0.5 text-[11.5px] text-ink-700"
        data-test="no-reply-phrase"
      >
        {{ phrase }}
        <button type="button" class="text-[11px] text-ink-muted hover:text-danger-text" :disabled="saving" :aria-label="t(`Remove ${phrase}`, `Quitar ${phrase}`)" @click="remove(i)">×</button>
      </span>
    </div>
    <div class="flex flex-col gap-1.5 border-t border-line-divider pt-2.5">
      <div class="flex gap-1.5">
        <input
          v-model="draft"
          type="text"
          :placeholder="t('e.g. Thanks', 'p. ej. Gracias')"
          class="h-8 min-w-0 flex-1 rounded-ctl border border-line-control bg-surface px-2.5 text-[12px] text-ink-700 focus:border-brand focus:outline-none"
          data-test="no-reply-text"
          @keyup.enter="add"
        />
        <UiBtn variant="secondary" size="sm" :disabled="saving || !draft.trim()" data-test="add-no-reply" @click="add">
          {{ t('Add', 'Añadir') }}
        </UiBtn>
      </div>
      <p class="text-[11px] leading-[1.5] text-ink-muted">
        {{ t(
          'When a message is only one of these (case, accents and punctuation aside), it neither answers nor drafts — "Confirmar" on the reminder is already recorded. It also stays quiet on its own when a message clearly needs no answer.',
          'Cuando un mensaje es solo una de estas (sin importar mayúsculas, tildes o signos), ni contesta ni deja borrador: el "Confirmar" del recordatorio ya queda registrado. También se calla sola cuando un mensaje claramente no necesita respuesta.',
        ) }}
      </p>
    </div>
  </GrowthSettingCard>
</template>

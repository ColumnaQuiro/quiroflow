<script setup lang="ts">
const props = defineProps<{ available: boolean; personaName: string }>()

const t = useT()
const { turns, thinking, unavailable, send } = useGrowthReceptionistTest()
const draft = ref('')

const usable = computed(() => props.available && !unavailable.value)

function submit() {
  if (!draft.value.trim() || thinking.value) return
  send(draft.value)
  draft.value = ''
}
</script>

<template>
  <!-- Sticky because it is the control the owner checks their edits against:
  change a booking rule on the left, try it here without scrolling back. -->
  <aside class="flex max-h-[calc(100vh-140px)] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card lg:sticky lg:top-4" data-test="test-chat">
    <header class="flex shrink-0 items-start justify-between gap-3 border-b border-line-divider p-4">
      <div class="flex items-center gap-2.5">
        <span class="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] bg-brand text-[10px] font-bold text-white">AI</span>
        <div class="flex flex-col">
          <span class="text-[12.5px] font-semibold tracking-tightTitle text-ink-900">{{ t('Try', 'Prueba a') }} {{ personaName }}</span>
          <span class="text-[10.5px] text-ink-muted">{{ t('Nothing is sent and nothing is booked', 'No se envía ni se reserva nada') }}</span>
        </div>
      </div>
      <span class="shrink-0 rounded-pill border border-warning-border bg-warning-bg px-2 py-0.5 text-[10px] font-semibold text-warning-text">
        {{ t('Test mode', 'Modo de prueba') }}
      </span>
    </header>

    <div class="flex-1 space-y-2 overflow-y-auto p-4">
      <!-- Said plainly rather than shown as a broken chat. Without a key the
      model cannot run at all, and that is a configuration fact the owner can
      act on. -->
      <p v-if="!usable" class="rounded-ctl border border-line bg-surface-subtle px-3 py-2.5 text-[11.5px] leading-[1.5] text-ink-muted" data-test="test-chat-unavailable">
        {{ t(
          'Test mode needs an Anthropic API key on the server. Everything on the left still saves without it.',
          'El modo de prueba necesita una clave de API de Anthropic en el servidor. Todo lo de la izquierda se guarda igualmente.',
        ) }}
      </p>

      <template v-else>
        <p v-if="!turns.length" class="py-6 text-center text-[11.5px] text-ink-faint">
          {{ t('Write as a patient would, and see what comes back.', 'Escribe como lo haría un paciente y mira qué responde.') }}
        </p>

        <p
          v-for="(turn, i) in turns"
          :key="i"
          class="max-w-[88%] whitespace-pre-wrap rounded-card px-3 py-2 text-[12px] leading-[1.45] text-ink-700"
          :class="turn.role === 'assistant'
            ? 'rounded-bl-[4px] border border-brand-tintBorder bg-brand-tint'
            : 'ml-auto rounded-br-[4px] border border-line bg-surface-subtle'"
        >{{ turn.content }}</p>

        <p v-if="thinking" class="max-w-[88%] rounded-card rounded-bl-[4px] border border-brand-tintBorder bg-brand-tint px-3 py-2 text-[12px] text-ink-muted">
          {{ personaName }} {{ t('is typing…', 'está escribiendo…') }}
        </p>
      </template>
    </div>

    <div v-if="usable" class="flex shrink-0 items-center gap-2 border-t border-line-divider p-3">
      <input
        v-model="draft"
        type="text"
        class="h-8 min-w-0 flex-1 rounded-ctl border border-line-control bg-surface px-2.5 text-[12px] text-ink-700 placeholder:text-ink-faint focus:border-brand focus:outline-none"
        :placeholder="t('Write as a patient…', 'Escribe como paciente…')"
        data-test="test-chat-input"
        @keydown.enter.prevent="submit"
      >
      <UiBtn variant="primary" size="sm" :disabled="!draft.trim() || thinking" @click="submit">{{ t('Send', 'Enviar') }}</UiBtn>
    </div>
  </aside>
</template>

<script setup lang="ts">
import type { TestChatTurn } from '~/composables/useGrowthReceptionist'

const props = defineProps<{ turns: TestChatTurn[]; why: string }>()

const t = useT()

// Local to the panel: the owner is trying the persona out, not holding a
// conversation anyone else will ever read.
const draft = ref('')
const extra = ref<TestChatTurn[]>([])
const allTurns = computed(() => [...props.turns, ...extra.value])

function send() {
  const text = draft.value.trim()
  if (!text) return
  extra.value.push({ from: 'patient', text })
  draft.value = ''
  // No model call behind this yet. Saying so in the transcript is better
  // than a canned reply that looks like the AI actually answered.
  extra.value.push({
    from: 'ai',
    text: t(
      'Test mode is not wired to a model yet — this is where Alba would reply, using the knowledge and booking rules on the left.',
      'El modo de prueba aún no está conectado a un modelo: aquí respondería Alba, usando el conocimiento y las reglas de reserva de la izquierda.',
    ),
  })
}
</script>

<template>
  <!-- Sticky because it is the control the owner checks their edits against:
  change a booking rule on the left, try it here without scrolling back. -->
  <aside class="flex max-h-[calc(100vh-140px)] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card lg:sticky lg:top-4">
    <header class="flex shrink-0 items-start justify-between gap-3 border-b border-line-divider p-4">
      <div class="flex items-center gap-2.5">
        <span class="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] bg-brand text-[10px] font-bold text-white">AI</span>
        <div class="flex flex-col">
          <span class="text-[12.5px] font-semibold tracking-tightTitle text-ink-900">{{ t('Try Alba', 'Prueba a Alba') }}</span>
          <span class="text-[10.5px] text-ink-muted">{{ t('Nothing is booked from here', 'Desde aquí no se reserva nada') }}</span>
        </div>
      </div>
      <span class="shrink-0 rounded-pill border border-warning-border bg-warning-bg px-2 py-0.5 text-[10px] font-semibold text-warning-text">
        {{ t('Test mode', 'Modo de prueba') }}
      </span>
    </header>

    <div class="flex-1 space-y-2 overflow-y-auto p-4">
      <p
        v-for="(turn, i) in allTurns"
        :key="i"
        class="max-w-[88%] rounded-card px-3 py-2 text-[12px] leading-[1.45] text-ink-700"
        :class="turn.from === 'ai'
          ? 'rounded-bl-[4px] border border-brand-tintBorder bg-brand-tint'
          : 'ml-auto rounded-br-[4px] border border-line bg-surface-subtle'"
      >{{ turn.text }}</p>

      <!-- The reason the reply came out that way, which is what the owner is
      really testing: whether the rules they set are the ones being used. -->
      <div class="flex flex-col gap-1 rounded-ctl border border-line bg-surface-subtle px-3 py-2">
        <span class="text-[10.5px] font-semibold text-ink-700">{{ t('Why this reply', 'Por qué esta respuesta') }}</span>
        <span class="text-[10.5px] leading-[1.5] text-ink-muted">{{ why }}</span>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-2 border-t border-line-divider p-3">
      <input
        v-model="draft"
        type="text"
        class="h-8 min-w-0 flex-1 rounded-ctl border border-line-control bg-surface px-2.5 text-[12px] text-ink-700 placeholder:text-ink-faint focus:border-brand focus:outline-none"
        :placeholder="t('Write as a patient…', 'Escribe como paciente…')"
        @keydown.enter.prevent="send"
      >
      <UiBtn variant="primary" size="sm" :disabled="!draft.trim()" @click="send">{{ t('Send', 'Enviar') }}</UiBtn>
    </div>
  </aside>
</template>

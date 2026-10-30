<script setup lang="ts">
import type { TestScenario, TestTurn } from '~/composables/useGrowthReceptionistTest'

const props = defineProps<{ available: boolean; personaName: string; /** Fills the panel's own height rather than the sidebar's. */ fill?: boolean }>()
const emit = defineEmits<{ tried: [] }>()

const t = useT()
const { turns, thinking, unavailable, scenario, send, reset } = useGrowthReceptionistTest()
const draft = ref('')

const usable = computed(() => props.available && !unavailable.value)

// Who the owner is pretending to be. A real lead's origin is on its record;
// here it is chosen, so an answer that depends on it (an ad-only price, no
// first visit for someone who has been before) can be tried each way.
const SCENARIOS: { key: TestScenario; label: string }[] = [
  { key: 'new', label: t('New enquiry', 'Consulta nueva') },
  { key: 'ad', label: t('Came from an ad', 'Viene de un anuncio') },
  { key: 'existing', label: t('Existing patient', 'Paciente de la clínica') },
]

function submit() {
  if (!draft.value.trim() || thinking.value) return
  send(draft.value)
  draft.value = ''
  emit('tried')
}

// Changing who they are mid-conversation would make the earlier turns a
// conversation with someone else: it starts over.
function pick(next: TestScenario) {
  if (next === scenario.value) return
  scenario.value = next
  reset()
}

function outcomeText(turn: TestTurn) {
  if (turn.outcome === 'refused') return t('The model declined to answer that one. Nothing was sent anywhere.', 'El modelo no ha querido responder a eso. No se ha enviado nada.')
  return t('It would stay quiet: this message needs no answer, so nothing would be sent.', 'Se quedaría callada: este mensaje no necesita respuesta, así que no se enviaría nada.')
}

// Opens at the newest turn as the conversation grows.
const scroller = ref<HTMLElement | null>(null)
watch(() => turns.value.length + (thinking.value ? 1 : 0), () => {
  nextTick(() => {
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
  })
})
</script>

<template>
  <!-- Sticky because it is the control the owner checks their edits against:
  change a booking rule on the left, try it here without scrolling back. -->
  <aside
    class="flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card"
    :class="fill ? 'min-h-[60vh]' : 'max-h-[calc(100vh-140px)] lg:sticky lg:top-4'"
    data-test="test-chat"
  >
    <header class="flex shrink-0 items-start justify-between gap-3 border-b border-line-divider p-4">
      <div class="flex items-center gap-2.5">
        <span class="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] bg-brand text-[10px] font-bold text-brand-on">AI</span>
        <div class="flex flex-col">
          <span class="text-[12.5px] font-semibold tracking-tightTitle text-ink-900">{{ t('Try', 'Prueba a') }} {{ personaName }}</span>
          <span class="text-[10.5px] text-ink-muted">{{ t('Nothing is sent and nothing is booked', 'No se envía ni se reserva nada') }}</span>
        </div>
      </div>
      <span class="shrink-0 rounded-pill border border-warning-border bg-warning-bg px-2 py-0.5 text-[10px] font-semibold text-warning-text">
        {{ t('Test mode', 'Modo de prueba') }}
      </span>
    </header>

    <div v-if="usable" class="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line-divider px-3 py-2" data-test="test-chat-scenarios">
      <span class="mr-1 text-[10.5px] text-ink-faint">{{ t('You are…', 'Eres…') }}</span>
      <button
        v-for="s in SCENARIOS"
        :key="s.key"
        type="button"
        class="rounded-pill border px-2 py-0.5 text-[11px]"
        :class="scenario === s.key ? 'border-brand-tintBorder bg-brand-tint font-medium text-brand-text' : 'border-chip-border bg-chip-bg text-ink-muted hover:text-ink-700'"
        :aria-pressed="scenario === s.key"
        :disabled="thinking"
        :data-test="`test-chat-scenario-${s.key}`"
        @click="pick(s.key)"
      >{{ s.label }}</button>
      <button
        v-if="turns.length"
        type="button"
        class="ml-auto text-[11px] font-medium text-ink-muted hover:text-danger-text"
        :disabled="thinking"
        data-test="test-chat-reset"
        @click="reset"
      >{{ t('Start over', 'Empezar de nuevo') }}</button>
    </div>

    <div ref="scroller" class="flex-1 space-y-2 overflow-y-auto p-4">
      <!-- Said plainly rather than shown as a broken chat. Without a key the
      model cannot run at all, and that is a configuration fact the owner can
      act on. -->
      <p v-if="!usable" class="rounded-ctl border border-line bg-surface-subtle px-3 py-2.5 text-[11.5px] leading-[1.5] text-ink-muted" data-test="test-chat-unavailable">
        {{ t(
          'Test mode needs an Anthropic API key on the server. Everything else on this page still saves without it.',
          'El modo de prueba necesita una clave de API de Anthropic en el servidor. Todo lo demás de esta página se guarda igualmente.',
        ) }}
      </p>

      <template v-else>
        <div v-if="!turns.length" class="flex flex-col gap-1.5 py-6 text-center text-[11.5px] text-ink-faint">
          <p>{{ t('Write as a patient would, and see what comes back.', 'Escribe como lo haría un paciente y mira qué responde.') }}</p>
          <p class="text-[10.5px]">{{ t('It uses what you have saved on this page and the real free times in the calendar. Escalation rules are tried too: it says when it would hand over.', 'Usa lo que tengas guardado en esta página y las horas libres reales del calendario. Las reglas de escalado también se prueban: dice cuándo pasaría a una persona.') }}</p>
        </div>

        <div v-for="(turn, i) in turns" :key="i" class="flex flex-col gap-1" :class="turn.role === 'assistant' ? 'items-start' : 'items-end'">
          <p
            v-if="turn.outcome"
            class="max-w-[88%] rounded-card rounded-bl-[4px] border border-dashed border-line-control bg-surface-subtle px-3 py-2 text-[11.5px] italic leading-[1.45] text-ink-muted"
            data-test="test-chat-outcome"
          >{{ outcomeText(turn) }}</p>
          <p
            v-else
            class="max-w-[88%] whitespace-pre-wrap rounded-card px-3 py-2 text-[12px] leading-[1.45] text-ink-700"
            :class="turn.role === 'assistant'
              ? 'rounded-bl-[4px] border border-brand-tintBorder bg-brand-tint'
              : 'rounded-br-[4px] border border-line bg-surface-subtle'"
          >{{ turn.content }}</p>

          <!-- What it did to write that: the lookups, and whether it would
          have handed over. The part of a reply a chat bubble cannot show,
          and the part an owner setting escalation rules is here to see. -->
          <ul v-if="turn.trace && (turn.trace.lookups.length || turn.trace.handedOver)" class="flex max-w-[88%] flex-col gap-0.5 px-1 text-[10.5px] text-ink-faint" data-test="test-chat-trace">
            <li v-for="(lookup, j) in turn.trace.lookups" :key="j" class="flex items-center gap-1.5">
              <span class="h-1 w-1 shrink-0 rounded-full" :class="lookup.ok ? 'bg-info-accent' : 'bg-danger-text'" />
              <span>{{ lookup.ok ? t('Looked up free times', 'Consultó las horas libres') : t('Could not read the calendar', 'No pudo leer el calendario') }}<template v-if="lookup.detail"> · {{ lookup.detail }}</template></span>
            </li>
            <li v-if="turn.trace.handedOver" class="flex items-start gap-1.5 text-warning-text" data-test="test-chat-handover">
              <span class="mt-1 h-1 w-1 shrink-0 rounded-full bg-warning-accent" />
              <span>{{ t('Would hand over to a person', 'Pasaría a una persona') }} · {{ turn.trace.handedOver }}</span>
            </li>
          </ul>
        </div>

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

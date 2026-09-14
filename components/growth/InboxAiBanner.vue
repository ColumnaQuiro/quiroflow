<script setup lang="ts">
import type { AiState } from '~/composables/useGrowthConversations'

const props = defineProps<{ aiState: AiState; takenOverBy: string | null }>()
defineEmits<{ takeOver: []; handBack: [] }>()

const t = useT()

// Derived from the state rather than stored as prose. What the AI is doing
// follows from which state it is in, and a sentence saved on the row would
// go stale the moment the state changed without it.
const summary = computed(() => {
  switch (props.aiState) {
    case 'handling':
      return t(
        'It will qualify the enquiry and offer appointment times, and hand over if it hits one of your escalation rules.',
        'Cualificará la consulta y ofrecerá horarios, y cederá el control si se cumple una de tus reglas de escalado.',
      )
    case 'needs_human':
      return t('The AI stopped and is waiting for a person.', 'La IA se ha detenido y espera a una persona.')
    case 'blocked':
      return t('Nothing can be sent until the channel is reconnected.', 'No se puede enviar nada hasta reconectar el canal.')
    default:
      return ''
  }
})
</script>

<template>
  <!-- Who is answering, and the one control that changes it. Sits directly
  under the thread header so it is read before the messages are. -->
  <div
    v-if="aiState === 'handling'"
    class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-brand-tintBorder bg-brand-tint px-4 py-2.5"
  >
    <div class="flex min-w-0 items-start gap-2.5">
      <span class="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] bg-brand text-[9px] font-bold text-white">AI</span>
      <div class="flex min-w-0 flex-col">
        <span class="text-[12.5px] font-semibold text-brand-text">{{ t('AI is handling this conversation', 'La IA está gestionando esta conversación') }}</span>
        <span class="text-[11.5px] text-ink-muted">{{ summary }}</span>
      </div>
    </div>
    <UiBtn variant="primary" size="sm" data-test="take-over" @click="$emit('takeOver')">
      {{ t('Take over', 'Tomar el control') }}
    </UiBtn>
  </div>

  <div
    v-else-if="aiState === 'paused'"
    class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-subtle px-4 py-2.5"
  >
    <div class="flex min-w-0 items-center gap-2.5">
      <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-warning-accent" />
      <!-- Named, not just "a colleague". Two people answering the same
      escalated thread is the failure this control exists to prevent, and the
      second one needs to see who already has it. -->
      <span class="text-[12px] text-ink-muted">
        {{ t('AI paused', 'IA en pausa') }}<template v-if="takenOverBy"> · {{ takenOverBy }}</template>
        {{ t('took over. The AI will not reply until you hand it back.', 'ha tomado el control. La IA no responderá hasta que se lo devuelvas.') }}
      </span>
    </div>
    <button
      type="button"
      class="shrink-0 text-[11.5px] font-semibold text-brand-text hover:underline"
      data-test="hand-back"
      @click="$emit('handBack')"
    >{{ t('Hand back to AI', 'Devolver a la IA') }}</button>
  </div>

  <div
    v-else-if="aiState === 'needs_human'"
    class="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-warning-border bg-warning-bg px-4 py-2.5"
  >
    <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-warning-accent" />
    <span class="text-[12px] text-warning-text">{{ summary }}</span>
  </div>

  <div
    v-else-if="aiState === 'blocked'"
    class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-danger-border bg-danger-bg px-4 py-2.5"
  >
    <div class="flex min-w-0 items-center gap-2.5">
      <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-danger-text" />
      <span class="text-[12px] text-danger-text">{{ summary }}</span>
    </div>
    <NuxtLink to="/settings/whatsapp" class="shrink-0 text-[11.5px] font-semibold text-danger-text hover:underline">
      {{ t('Reconnect number', 'Reconectar número') }} →
    </NuxtLink>
  </div>
</template>

<script setup lang="ts">
import type { LeadConversation } from '~/composables/useGrowthConversations'

defineProps<{ conversation: LeadConversation }>()
defineEmits<{ takeOver: []; handBack: [] }>()

const t = useT()
</script>

<template>
  <!-- Who is answering, and the one control that changes it. Sits directly
  under the thread header so it is read before the messages are. -->
  <div
    v-if="conversation.aiState === 'handling'"
    class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-brand-tintBorder bg-brand-tint px-4 py-2.5"
  >
    <div class="flex min-w-0 items-start gap-2.5">
      <span class="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] bg-brand text-[9px] font-bold text-white">AI</span>
      <div class="flex min-w-0 flex-col">
        <span class="text-[12.5px] font-semibold text-brand-text">{{ t('AI is handling this conversation', 'La IA está gestionando esta conversación') }}</span>
        <span class="text-[11.5px] text-ink-muted">{{ conversation.aiSummary }}</span>
      </div>
    </div>
    <UiBtn variant="primary" size="sm" data-test="take-over" @click="$emit('takeOver')">
      {{ t('Take over', 'Tomar el control') }}
    </UiBtn>
  </div>

  <div
    v-else-if="conversation.aiState === 'paused'"
    class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-subtle px-4 py-2.5"
  >
    <div class="flex min-w-0 items-center gap-2.5">
      <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-warning-accent" />
      <span class="text-[12px] text-ink-muted">
        {{ t('AI paused', 'IA en pausa') }} ·
        {{ conversation.takenOverBy }}
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
    v-else-if="conversation.aiState === 'needs_human'"
    class="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-warning-border bg-warning-bg px-4 py-2.5"
  >
    <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-warning-accent" />
    <span class="text-[12px] text-warning-text">{{ conversation.aiSummary }}</span>
  </div>

  <div
    v-else-if="conversation.aiState === 'blocked'"
    class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-danger-border bg-danger-bg px-4 py-2.5"
  >
    <div class="flex min-w-0 items-center gap-2.5">
      <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-danger-text" />
      <span class="text-[12px] text-danger-text">{{ conversation.aiSummary }}</span>
    </div>
    <NuxtLink to="/settings/whatsapp" class="shrink-0 text-[11.5px] font-semibold text-danger-text hover:underline">
      {{ t('Reconnect number', 'Reconectar número') }} →
    </NuxtLink>
  </div>
</template>

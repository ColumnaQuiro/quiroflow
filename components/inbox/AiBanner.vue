<script setup lang="ts">
// Who is answering this conversation, and the one control that changes it.
// Sits directly under the thread header so it is read before the messages
// are -- for a lead's thread and a patient's alike, from one state shape.
//
// A lead's state is explicit (leads.ai_state: handling, paused by a person,
// needs_human, blocked). A patient's is read from what happened in the
// thread (utils/inboxAiState.ts): the receptionist wrote last (handling), or
// it handed the conversation over and no person has written since
// (needs_human). A patient's thread therefore has no "paused": a person
// replying is what pauses it, for an hour, and the banner says so.
//
// Shared shape with the staff app in mind (components/ is resolved there
// too), so no `~` imports.
export type InboxAiBannerState = 'handling' | 'paused' | 'needs_human' | 'blocked' | 'none'

const props = defineProps<{
  state: InboxAiBannerState | null
  kind: 'lead' | 'patient'
  /** Who took the thread off the AI, once someone has (leads). */
  takenOverBy?: string | null
  /** Why it was handed over: the receptionist's own note, when there is one. */
  reason?: string | null
  /**
   * The receptionist is not writing in this clinic right now: switched off,
   * or at its monthly limit. Said in the thread, because the only other sign
   * is drafts quietly not arriving.
   */
  quiet?: 'off' | 'limit' | null
}>()
defineEmits<{ takeOver: []; handBack: []; markHandled: [] }>()

const t = useT()

const quietText = computed(() => {
  if (props.quiet === 'limit') return t('The receptionist has reached its monthly reply limit, so it is not drafting or answering until the 1st.', 'La recepcionista ha llegado a su límite mensual de respuestas, así que no redacta ni contesta hasta el día 1.')
  if (props.quiet === 'off') return t('The receptionist is switched off, so nothing is drafted here.', 'La recepcionista está desactivada, así que aquí no se redacta nada.')
  return ''
})
</script>

<template>
  <div
    v-if="state === 'handling'"
    class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-brand-tintBorder bg-brand-tint px-4 py-2.5"
    data-test="ai-banner"
    data-state="handling"
  >
    <div class="flex min-w-0 items-start gap-2.5">
      <span class="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] bg-brand text-[9px] font-bold text-white">AI</span>
      <div class="flex min-w-0 flex-col">
        <span class="text-[12.5px] font-semibold text-brand-text">{{ t('AI is handling this conversation', 'La IA está gestionando esta conversación') }}</span>
        <span class="text-[11.5px] text-ink-muted">
          <template v-if="kind === 'lead'">{{ t('It will qualify the enquiry and offer appointment times, and hand over if it hits one of your escalation rules.', 'Cualificará la consulta y ofrecerá horarios, y cederá el control si se cumple una de tus reglas de escalado.') }}</template>
          <template v-else>{{ t('It answered last. If you reply, it stays quiet in this conversation for an hour, and hands over if it hits one of your escalation rules.', 'Respondió la última. Si contestas tú, se calla en esta conversación durante una hora, y cede el control si se cumple una de tus reglas de escalado.') }}</template>
        </span>
      </div>
    </div>
    <UiBtn v-if="kind === 'lead'" variant="primary" size="sm" data-test="take-over" @click="$emit('takeOver')">
      {{ t('Take over', 'Tomar el control') }}
    </UiBtn>
  </div>

  <div
    v-else-if="state === 'paused'"
    class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-subtle px-4 py-2.5"
    data-test="ai-banner"
    data-state="paused"
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
    <button type="button" class="shrink-0 text-[11.5px] font-semibold text-brand-text hover:underline" data-test="hand-back" @click="$emit('handBack')">
      {{ t('Hand back to AI', 'Devolver a la IA') }}
    </button>
  </div>

  <!-- Handed over: why, and what to do once it is dealt with. It used to say
  only that the AI had stopped, with no reason and no way out, so a lead
  handed over stayed "Needs human" for ever. -->
  <div
    v-else-if="state === 'needs_human'"
    class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-warning-border bg-warning-bg px-4 py-2.5"
    data-test="ai-banner"
    data-state="needs_human"
  >
    <div class="flex min-w-0 items-start gap-2.5">
      <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning-accent" />
      <div class="flex min-w-0 flex-col">
        <span class="text-[12.5px] font-semibold text-warning-text">{{ t('The receptionist handed this to a person', 'La recepcionista ha pasado esta conversación a una persona') }}</span>
        <span class="text-[11.5px] text-warning-text" data-test="ai-banner-reason">
          <template v-if="reason">{{ reason }}</template>
          <template v-else>{{ t('It stopped answering here and is waiting for one of you.', 'Ha dejado de responder aquí y espera a alguien del equipo.') }}</template>
        </span>
      </div>
    </div>
    <div class="flex shrink-0 items-center gap-3">
      <button v-if="kind === 'lead'" type="button" class="text-[11.5px] font-semibold text-warning-text hover:underline" data-test="hand-back" @click="$emit('handBack')">
        {{ t('Hand back to AI', 'Devolver a la IA') }}
      </button>
      <UiBtn variant="secondary" size="sm" data-test="mark-handled" @click="$emit('markHandled')">
        {{ t("I've handled it", 'Ya lo he atendido') }}
      </UiBtn>
    </div>
  </div>

  <div
    v-else-if="state === 'blocked'"
    class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-danger-border bg-danger-bg px-4 py-2.5"
    data-test="ai-banner"
    data-state="blocked"
  >
    <div class="flex min-w-0 items-center gap-2.5">
      <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-danger-text" />
      <span class="text-[12px] text-danger-text">{{ t('Nothing can be sent until the channel is reconnected.', 'No se puede enviar nada hasta reconectar el canal.') }}</span>
    </div>
    <NuxtLink to="/settings/whatsapp" class="shrink-0 text-[11.5px] font-semibold text-danger-text hover:underline">
      {{ t('Reconnect number', 'Reconectar número') }} →
    </NuxtLink>
  </div>

  <!-- Nothing to say about this thread, but something about the receptionist
  itself that explains why no draft is coming. -->
  <div
    v-else-if="quiet"
    class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-subtle px-4 py-2"
    data-test="ai-quiet"
    :data-why="quiet"
  >
    <span class="text-[11.5px] text-ink-muted">{{ quietText }}</span>
    <NuxtLink to="/growth/receptionist" class="shrink-0 text-[11.5px] font-semibold text-brand-text hover:underline">{{ t('Receptionist settings', 'Ajustes de la recepcionista') }} →</NuxtLink>
  </div>
</template>

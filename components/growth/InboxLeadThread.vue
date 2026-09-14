<script setup lang="ts">
import type { LeadConversation } from '~/composables/useGrowthConversations'

const props = defineProps<{ conversation: LeadConversation }>()
const emit = defineEmits<{
  back: []
  takeOver: []
  handBack: []
  send: [text: string]
}>()

const t = useT()
const draft = ref('')

// The composer opens only once a person has taken the thread off the AI --
// two of them typing into the same conversation is the failure this whole
// banner exists to prevent.
const canReply = computed(() => props.conversation.aiState === 'paused' || props.conversation.aiState === 'needs_human')

function submit() {
  if (!draft.value.trim()) return
  emit('send', draft.value)
  draft.value = ''
}
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col bg-surface-page" data-test="lead-thread">
    <div class="flex h-14 shrink-0 items-center gap-2.5 border-b border-line bg-surface px-4">
      <button
        type="button"
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle md:hidden"
        :title="t('Back to conversations', 'Volver a conversaciones')"
        @click="emit('back')"
      >
        <svg width="8" height="13" viewBox="0 0 8 13" fill="none"><path d="M7 1L1 6.5L7 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[11px] font-semibold text-brand-text">
        {{ conversation.initials }}
      </span>
      <div class="min-w-0 flex-1">
        <p class="truncate text-[13.5px] font-[600] text-ink-900">{{ conversation.name }}</p>
        <p class="truncate text-[11.5px] text-ink-muted2">{{ conversation.threadSubtitle }}</p>
      </div>
      <NuxtLink
        to="/growth/leads"
        class="shrink-0 rounded-ctl border border-line-control bg-surface px-2.5 py-1 text-[11.5px] font-medium text-ink-700 hover:bg-surface-subtle"
      >{{ t('Open lead', 'Abrir contacto') }}</NuxtLink>
    </div>

    <GrowthInboxAiBanner
      :conversation="conversation"
      @take-over="emit('takeOver')"
      @hand-back="emit('handBack')"
    />

    <div class="flex-1 space-y-3 overflow-y-auto px-4 py-4">
      <p class="text-center text-[11px] text-ink-faint">{{ conversation.dayLabel }}</p>

      <div
        v-for="msg in conversation.messages"
        :key="msg.id"
        class="flex flex-col gap-1"
        :class="msg.from === 'lead' ? 'items-start' : 'items-end'"
      >
        <!-- The AI's messages are indigo and staff messages are plain: on a
        thread the clinic is legally answerable for, who said it has to be
        visible without reading the meta line under it. -->
        <p
          class="max-w-[78%] whitespace-pre-wrap rounded-card px-3 py-2 text-[12.5px] leading-[1.45]"
          :class="{
            'rounded-bl-[4px] border border-line bg-surface text-ink-700': msg.from === 'lead',
            'rounded-br-[4px] border border-brand-tintBorder bg-brand-tint text-ink-700': msg.from === 'ai',
            'rounded-br-[4px] border border-line-control bg-surface-subtle text-ink-700': msg.from === 'staff',
          }"
        >{{ msg.text }}</p>
        <span class="text-[10px] text-ink-faint">{{ msg.meta }}</span>
      </div>

      <div
        v-if="conversation.escalation"
        class="mx-auto flex max-w-[78%] flex-col items-center gap-0.5 rounded-ctl border border-warning-border bg-warning-bg px-3 py-2 text-center"
      >
        <span class="text-[11.5px] font-semibold text-warning-text">{{ conversation.escalation.title }}</span>
        <span class="text-[10.5px] text-ink-muted">{{ conversation.escalation.reason }}</span>
      </div>
    </div>

    <div v-if="conversation.aiState === 'handling'" class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3">
      <span class="text-[12px] text-ink-muted">
        {{ t('Composer locked while the AI is replying. Take over to write yourself.', 'Redacción bloqueada mientras responde la IA. Toma el control para escribir tú.') }}
      </span>
      <UiBtn variant="secondary" size="sm" @click="emit('takeOver')">{{ t('Take over', 'Tomar el control') }}</UiBtn>
    </div>

    <div v-else-if="conversation.aiState === 'blocked'" class="shrink-0 border-t border-line bg-surface px-4 py-3">
      <span class="text-[12px] text-danger-text">
        {{ t('Nothing can be sent until the number is reconnected.', 'No se puede enviar nada hasta reconectar el número.') }}
      </span>
    </div>

    <div v-else-if="canReply" class="shrink-0 border-t border-line bg-surface px-4 py-3" data-test="lead-composer">
      <textarea
        v-model="draft"
        rows="2"
        class="w-full resize-none rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 placeholder:text-ink-faint focus:border-brand focus:outline-none"
        :placeholder="t('Write a reply…', 'Escribe una respuesta…')"
        @keydown.enter.exact.prevent="submit"
      />
      <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap gap-1.5">
          <span v-for="label in [t('Templates', 'Plantillas'), t('Saved replies', 'Respuestas guardadas'), t('AI suggest reply', 'Sugerir respuesta'), t('Insert booking link', 'Insertar enlace de reserva')]" :key="label" class="rounded-pill border border-chip-border bg-chip-bg px-2 py-0.5 text-[11px] text-ink-muted">
            {{ label }}
          </span>
        </div>
        <UiBtn variant="primary" size="sm" :disabled="!draft.trim()" @click="submit">{{ t('Send', 'Enviar') }}</UiBtn>
      </div>
      <!-- Said plainly rather than hidden: there is no messaging API behind a
      lead thread yet, so a reply stays in this browser. Better a visible
      caveat than a Send button that implies delivery. -->
      <p class="mt-2 text-[10.5px] text-ink-faint">
        {{ t('Preview — lead replies are not delivered until the Growth messaging API is connected.', 'Vista previa: las respuestas a contactos no se envían hasta conectar la API de mensajería de Growth.') }}
      </p>
    </div>
  </div>
</template>

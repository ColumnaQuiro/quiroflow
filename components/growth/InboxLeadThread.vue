<script setup lang="ts">
import type { LeadThread } from '~/composables/useGrowthLeadThread'

const props = defineProps<{ thread: LeadThread; sending: boolean }>()
const emit = defineEmits<{ back: []; takeOver: []; handBack: []; send: [text: string] }>()

const t = useT()
const draft = ref('')

// The composer opens only once a person has taken the thread off the AI --
// two of them typing into the same conversation is the failure the banner
// exists to prevent. 'needs_human' counts as open because the AI has already
// stopped: there is nobody to take over from.
const aiIsAnswering = computed(() => props.thread.aiState === 'handling')
const channelBlocked = computed(() => props.thread.aiState === 'blocked')
const canReply = computed(() => !aiIsAnswering.value && !channelBlocked.value)

function time(at: string) {
  return new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function submit() {
  if (!draft.value.trim() || props.sending) return
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
      <div class="min-w-0 flex-1">
        <p class="truncate text-[13.5px] font-[600] text-ink-900">{{ thread.name }}</p>
        <p class="truncate text-[11.5px] text-ink-muted2">
          {{ t('Lead', 'Contacto') }}<template v-if="thread.phone"> · {{ thread.phone }}</template>
          <template v-if="thread.source"> · {{ thread.source }}</template>
        </p>
      </div>
    </div>

    <GrowthInboxAiBanner
      :ai-state="thread.aiState"
      :taken-over-by="thread.takenOverBy"
      @take-over="emit('takeOver')"
      @hand-back="emit('handBack')"
    />

    <div class="flex-1 space-y-3 overflow-y-auto px-4 py-4">
      <p v-if="!thread.messages.length" class="py-8 text-center text-[12px] text-ink-faint">
        {{ t('No messages yet.', 'Aún no hay mensajes.') }}
      </p>

      <div
        v-for="message in thread.messages"
        :key="message.id"
        class="flex flex-col gap-1"
        :class="message.from === 'lead' ? 'items-start' : 'items-end'"
      >
        <p
          class="max-w-[78%] whitespace-pre-wrap rounded-card px-3 py-2 text-[12.5px] leading-[1.45] text-ink-700"
          :class="message.from === 'lead'
            ? 'rounded-bl-[4px] border border-line bg-surface'
            : 'rounded-br-[4px] border border-brand-tintBorder bg-brand-tint'"
        >{{ message.text }}</p>
        <!-- Status comes off the row Meta acknowledged, so "delivered" here
        means delivered. Nothing claims which human or model wrote it,
        because the row does not record that. -->
        <span class="text-[10px] text-ink-faint">
          {{ time(message.at) }} · {{ message.status }}<template v-if="message.templateName"> · {{ message.templateName }}</template>
        </span>
      </div>
    </div>

    <div v-if="aiIsAnswering" class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3">
      <span class="text-[12px] text-ink-muted">
        {{ t('Composer locked while the AI is replying. Take over to write yourself.', 'Redacción bloqueada mientras responde la IA. Toma el control para escribir tú.') }}
      </span>
      <UiBtn variant="secondary" size="sm" @click="emit('takeOver')">{{ t('Take over', 'Tomar el control') }}</UiBtn>
    </div>

    <div v-else-if="channelBlocked" class="shrink-0 border-t border-line bg-surface px-4 py-3">
      <span class="text-[12px] text-danger-text">
        {{ t('Nothing can be sent until the number is reconnected.', 'No se puede enviar nada hasta reconectar el número.') }}
      </span>
    </div>

    <!-- WhatsApp refuses free text more than 24h after the last inbound
    message. Said here rather than discovered on send, because the alternative
    is someone writing a careful reply and losing it to a 400. -->
    <div v-else-if="!thread.canReplyFreeText" class="shrink-0 border-t border-line bg-surface px-4 py-3" data-test="window-closed">
      <span class="text-[12px] text-ink-muted">
        {{ t(
          'More than 24 hours since they last wrote, so WhatsApp will not carry a free-form reply. A template has to go out instead.',
          'Han pasado más de 24 horas desde su último mensaje, así que WhatsApp no admite una respuesta libre. Hay que enviar una plantilla.',
        ) }}
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
      <div class="mt-2 flex items-center justify-end">
        <UiBtn variant="primary" size="sm" :disabled="!draft.trim() || sending" @click="submit">
          {{ sending ? t('Sending…', 'Enviando…') : t('Send', 'Enviar') }}
        </UiBtn>
      </div>
    </div>
  </div>
</template>

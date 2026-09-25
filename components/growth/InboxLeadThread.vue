<script setup lang="ts">
import type { LeadThread } from '~/composables/useGrowthLeadThread'

const props = defineProps<{ thread: LeadThread; sending: boolean; drafting: boolean }>()
const emit = defineEmits<{
  back: []
  takeOver: []
  handBack: []
  send: [text: string]
  draftReply: []
  approveDraft: [text: string]
  discardDraft: []
}>()

const t = useT()
const draft = ref('')

// Editing the AI's draft before approving it. Kept separate from `draft`,
// the composer's own text: they are two different messages, and sharing one
// box is how an edit silently becomes the thing you typed earlier.
const editingDraft = ref(false)
const editedDraft = ref('')

function startEditingDraft() {
  editedDraft.value = props.thread.draft ?? ''
  editingDraft.value = true
}

function approve() {
  const text = editingDraft.value ? editedDraft.value : (props.thread.draft ?? '')
  if (!text.trim() || props.sending) return
  emit('approveDraft', text)
  editingDraft.value = false
}

// Drafting only makes sense while a free-form reply is possible at all --
// outside WhatsApp's 24h window the approve button could only ever fail.
const canDraft = computed(
  () => props.thread.receptionistEnabled && props.thread.canReplyFreeText && props.thread.aiState !== 'blocked',
)

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

/**
 * A dry-run rule records what it WOULD have sent instead of sending it.
 *
 * That row is an outbound whatsapp_message like any other, so without this it
 * renders as a message the clinic sent -- same bubble, same side, only the
 * word 'would_send' to tell them apart, and that word was being printed raw.
 * A message nobody received, shown as one that was, is the worst thing this
 * screen could say: it is the screen someone reads to decide whether the
 * automation is working.
 */
const isDryRun = (status: string) => status === 'would_send'

// When the file itself could not be signed (missing from storage), still
// say what kind of message it was.
function mediaLabel(type: string) {
  const labels: Record<string, [string, string]> = {
    image: ['Photo', 'Foto'],
    sticker: ['Sticker', 'Sticker'],
    video: ['Video', 'Vídeo'],
    audio: ['Voice note', 'Nota de voz'],
    document: ['Document', 'Documento'],
  }
  const [en, es] = labels[type] ?? ['Attachment', 'Adjunto']
  return t(en, es)
}

function statusLabel(status: string) {
  if (status === 'would_send') return t('would have been sent', 'se habría enviado')
  if (status === 'received') return t('received', 'recibido')
  if (status === 'delivered') return t('delivered', 'entregado')
  if (status === 'read') return t('read', 'leído')
  if (status === 'sent') return t('sent', 'enviado')
  if (status === 'failed') return t('failed', 'fallido')
  return status
}

function submit() {
  if (!draft.value.trim() || props.sending) return
  emit('send', draft.value)
  draft.value = ''
}
</script>

<template>
  <!-- min-h-0 here and on the message list: since the Inbox put the
  "Assigned to" bar above this (PR 448) it is a flex child of a column, and a
  flex child's minimum height is its content -- so a long thread grew past
  the screen and pushed the composer out of sight instead of scrolling. -->
  <div class="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-page" data-test="lead-thread">
    <div class="flex min-h-16 shrink-0 items-center gap-2.5 border-b border-line bg-surface px-3 py-2.5 sm:px-4">
      <button
        type="button"
        class="flex h-9 touch:h-11 w-9 touch:w-11 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle md:hidden"
        :title="t('Back to conversations', 'Volver a conversaciones')"
        @click="emit('back')"
      >
        <svg width="8" height="13" viewBox="0 0 8 13" fill="none"><path d="M7 1L1 6.5L7 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <div class="min-w-0 flex-1">
        <p class="truncate text-[15px] font-bold text-ink-900">{{ thread.name }}</p>
        <p class="truncate text-[12.5px] text-ink-muted2">
          {{ t('Lead', 'Contacto') }}<template v-if="thread.phone"> · {{ thread.phone }}</template>
          <template v-if="thread.source"> · {{ thread.source }}</template>
        </p>
      </div>
      <!-- The Inbox puts who it is assigned to here, as on a patient thread. -->
      <slot name="actions" />
    </div>

    <GrowthInboxAiBanner
      :ai-state="thread.aiState"
      :taken-over-by="thread.takenOverBy"
      @take-over="emit('takeOver')"
      @hand-back="emit('handBack')"
    />

    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
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
          class="max-w-[78%] whitespace-pre-wrap rounded-card px-3 py-2 text-[12.5px] leading-[1.45]"
          :class="isDryRun(message.status)
            ? 'rounded-br-[4px] border border-dashed border-line-control bg-surface-subtle text-ink-muted'
            : message.from === 'lead'
              ? 'rounded-bl-[4px] border border-line bg-surface text-ink-700'
              : 'rounded-br-[4px] border border-brand-tintBorder bg-brand-tint text-ink-700'"
          :data-test="isDryRun(message.status) ? 'dry-run-message' : undefined"
        >
          <img v-if="message.mediaUrl && (message.mediaType === 'image' || message.mediaType === 'sticker')" :src="message.mediaUrl" alt="" class="mb-1 max-h-72 max-w-full rounded-ctl object-contain" data-test="lead-media" />
          <video v-else-if="message.mediaUrl && message.mediaType === 'video'" :src="message.mediaUrl" controls class="mb-1 max-w-full rounded-ctl" data-test="lead-media" />
          <audio v-else-if="message.mediaUrl && message.mediaType === 'audio'" :src="message.mediaUrl" controls class="mb-1 max-w-full" data-test="lead-media" />
          <a v-else-if="message.mediaUrl" :href="message.mediaUrl" target="_blank" rel="noopener" class="mb-1 block font-semibold text-brand-text underline" data-test="lead-media">{{ message.mediaFilename || t('Open the file', 'Abrir el archivo') }}</a>
          <span v-else-if="message.mediaType" class="block italic text-ink-muted">{{ mediaLabel(message.mediaType) }}</span>
          <!-- A template's text is not stored, only its name: say what was
          sent instead of drawing an empty bubble. -->
          <span v-if="!message.text && message.templateName" class="italic text-ink-muted" data-test="lead-template-message">{{ t('Template', 'Plantilla') }} «{{ message.templateName }}»</span>
          <template v-else>{{ message.text }}</template>
        </p>
        <!-- Status comes off the row Meta acknowledged, so "delivered" here
        means delivered. Nothing claims which human or model wrote it,
        because the row does not record that. -->
        <span class="text-[10px]" :class="isDryRun(message.status) ? 'text-warning-text' : 'text-ink-faint'">
          <template v-if="isDryRun(message.status)">
            {{ t('Test run · not sent', 'Prueba · no enviado') }} ·
          </template>
          {{ time(message.at) }} · {{ statusLabel(message.status) }}<template v-if="message.templateName && message.text"> · {{ message.templateName }}</template>
        </span>
      </div>
    </div>

    <!-- The receptionist's draft, waiting on a person. Same shape as the one
    on a review (PendingReplyCard) because it is the same promise: the model
    writes, a human decides, and nothing reaches anyone unread. -->
    <div v-if="thread.draft" class="flex shrink-0 flex-col gap-2.5 border-t border-brand-tintBorder bg-brand-tint p-4" data-test="lead-draft">
      <div class="flex flex-wrap items-center gap-2">
        <span class="flex h-[18px] w-[18px] items-center justify-center rounded-[6px] bg-brand text-[9px] font-bold text-white">AI</span>
        <span class="text-[12px] font-semibold text-brand-text">
          {{ t('Drafted by the receptionist · needs your approval', 'Redactado por la recepcionista · requiere tu aprobación') }}
        </span>
        <span v-if="thread.draftAt" class="text-[10.5px] text-ink-muted">{{ time(thread.draftAt) }}</span>
      </div>

      <textarea
        v-if="editingDraft"
        v-model="editedDraft"
        rows="4"
        class="w-full resize-none rounded-ctl border border-brand-tintBorder bg-surface px-3 py-2.5 text-[12px] leading-[1.5] text-ink-700 focus:border-brand focus:outline-none"
        data-test="edit-lead-draft"
      />
      <p v-else class="whitespace-pre-wrap rounded-ctl border border-brand-tintBorder bg-surface px-3 py-2.5 text-[12px] leading-[1.5] text-ink-700">
        {{ thread.draft }}
      </p>

      <div class="flex flex-wrap items-center gap-2">
        <UiBtn variant="primary" size="sm" :disabled="sending" data-test="approve-lead-draft" @click="approve">
          {{ sending ? t('Sending…', 'Enviando…') : t('Approve and send', 'Aprobar y enviar') }}
        </UiBtn>
        <button
          v-if="!editingDraft"
          type="button"
          class="flex h-8 items-center rounded-ctl border border-line-control bg-surface px-3 text-[12px] font-medium text-ink-700 hover:bg-surface-subtle"
          data-test="edit-lead-draft-start"
          @click="startEditingDraft"
        >{{ t('Edit', 'Editar') }}</button>
        <button
          type="button"
          class="flex h-8 items-center rounded-ctl border border-line-control bg-surface px-3 text-[12px] font-medium text-ink-700 hover:bg-surface-subtle"
          :disabled="sending"
          data-test="discard-lead-draft"
          @click="emit('discardDraft')"
        >{{ t('Discard', 'Descartar') }}</button>
        <span class="ml-auto text-[10.5px] text-ink-muted">
          {{ t('Nothing sends without your approval', 'No se envía nada sin tu aprobación') }}
        </span>
      </div>
    </div>

    <div v-if="aiIsAnswering" class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3">
      <span class="text-[12px] text-ink-muted">
        {{ t('Composer locked while the AI is replying. Take over to write yourself.', 'Redacción bloqueada mientras responde la IA. Toma el control para escribir tú.') }}
      </span>
      <div class="flex items-center gap-2">
        <UiBtn
          v-if="canDraft && !thread.draft"
          variant="secondary"
          size="sm"
          :disabled="drafting"
          data-test="draft-lead-reply"
          @click="emit('draftReply')"
        >
          {{ drafting ? t('Drafting…', 'Redactando…') : t('Draft a reply', 'Redactar respuesta') }}
        </UiBtn>
        <UiBtn variant="secondary" size="sm" @click="emit('takeOver')">{{ t('Take over', 'Tomar el control') }}</UiBtn>
      </div>
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
      <div class="mt-2 flex items-center justify-end gap-2">
        <!-- Useful even with a person holding the thread: a starting point
        beats a blank box, and they still edit and send it themselves. -->
        <UiBtn
          v-if="canDraft && !thread.draft"
          variant="secondary"
          size="sm"
          :disabled="drafting || sending"
          data-test="draft-lead-reply"
          @click="emit('draftReply')"
        >
          {{ drafting ? t('Drafting…', 'Redactando…') : t('Draft a reply', 'Redactar respuesta') }}
        </UiBtn>
        <UiBtn variant="primary" size="sm" :disabled="!draft.trim() || sending" @click="submit">
          {{ sending ? t('Sending…', 'Enviando…') : t('Send', 'Enviar') }}
        </UiBtn>
      </div>
    </div>
  </div>
</template>

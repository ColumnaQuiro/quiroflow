<script setup lang="ts">
import type { LeadThread } from '~/composables/useGrowthLeadThread'

const props = defineProps<{ thread: LeadThread; sending: boolean; drafting: boolean }>()
const emit = defineEmits<{
  back: []
  takeOver: []
  handBack: []
  send: [text: string]
  sendMedia: [media: { base64: string; mimeType: string; filename: string; kind: 'image' | 'video' | 'audio' | 'document' }]
  sendTemplate: []
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
  if (status === 'pending') return t('sending', 'enviando')
  if (status === 'sent') return t('sent', 'enviado')
  if (status === 'failed') return t('failed', 'fallido')
  return status
}

function submit() {
  if (!draft.value.trim() || props.sending) return
  emit('send', draft.value)
  draft.value = ''
}

// What a patient thread's composer offers beside the box: a file, a voice
// note, a saved reply. Files and voice notes are WhatsApp only, as they are
// there -- instagram/send posts text alone, so on an Instagram lead the
// buttons would take a file and fail at the very end.
const { showToast } = useToast()
const isWhatsApp = computed(() => props.thread.channel !== 'instagram')
const textarea = ref<HTMLTextAreaElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const MAX_MEDIA_BYTES = 16 * 1024 * 1024

// At the cursor, so picking a saved reply does not clobber what is typed.
function insertReply(text: string) {
  const el = textarea.value
  const start = el?.selectionStart ?? draft.value.length
  const end = el?.selectionEnd ?? draft.value.length
  draft.value = draft.value.slice(0, start) + text + draft.value.slice(end)
  nextTick(() => {
    if (!el) return
    el.focus()
    el.setSelectionRange(start + text.length, start + text.length)
  })
}

function kindOf(file: File): 'image' | 'video' | 'audio' | 'document' {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'document'
}

async function onFileChosen(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (fileInput.value) fileInput.value.value = ''
  if (!file) return
  if (file.size > MAX_MEDIA_BYTES) {
    showToast(t('File is too large (max 16 MB).', 'El archivo es demasiado grande (máx. 16 MB).'), 'error')
    return
  }
  const kind = kindOf(file)
  try {
    if (kind === 'image') {
      const { blob, mimeType } = await normalizeImageForWhatsApp(file)
      emit('sendMedia', { base64: await blobToBase64(blob), mimeType, filename: file.name.replace(/\.\w+$/, '.jpg'), kind })
    } else {
      emit('sendMedia', { base64: await blobToBase64(file), mimeType: file.type, filename: file.name, kind })
    }
  } catch (err: any) {
    showToast(err?.message ?? t('Could not process this file.', 'No se pudo procesar este archivo.'), 'error')
  }
}

const { recording, seconds, start: startRecording, stop: stopRecording, cancel: cancelRecording } = useAudioRecorder()
async function toggleRecording() {
  if (recording.value) {
    const result = await stopRecording()
    if (!result) return
    emit('sendMedia', { base64: await blobToBase64(result.blob), mimeType: result.mimeType, filename: `voice-note.${extensionForAudioMimeType(result.mimeType)}`, kind: 'audio' })
    return
  }
  try {
    await startRecording()
  } catch {
    showToast(t('Could not access the microphone -- check your browser permissions.', 'No se pudo acceder al micrófono; comprueba los permisos del navegador.'), 'error')
  }
}
function recordingLabel(secs: number) {
  return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`
}

// Opens at the newest message and stays there as messages arrive -- unless
// somebody has scrolled up to read, who is left where they are. Their own
// reply always brings them down to it.
const scroller = ref<HTMLElement | null>(null)
function nearBottom() {
  const el = scroller.value
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80
}
function toBottom() {
  nextTick(() => requestAnimationFrame(() => {
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
  }))
}
onMounted(toBottom)
watch(
  () => props.thread.messages.length,
  (now, before) => {
    if (now <= before) return
    if (nearBottom() || props.thread.messages[now - 1]?.from === 'clinic') toBottom()
  },
)
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

    <div ref="scroller" class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" data-test="lead-messages">
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
        <span class="flex items-center gap-1 text-[10px]" :class="isDryRun(message.status) ? 'text-warning-text' : message.status === 'failed' ? 'text-warning-text' : 'text-ink-faint'">
          <template v-if="isDryRun(message.status)">
            {{ t('Test run · not sent', 'Prueba · no enviado') }} ·
          </template>
          {{ time(message.at) }}<template v-if="message.templateName && message.text"> · {{ message.templateName }}</template>
          <!-- Ours: the ticks a patient thread shows, clock to blue double
          check, named for a screen reader. Theirs need none. A test run keeps
          its words, because no tick is true of a message nobody was sent. -->
          <template v-if="message.from === 'clinic' && !isDryRun(message.status)">
            <template v-if="message.status === 'failed'"> · {{ statusLabel(message.status) }}</template>
            <InboxMessageStatus :status="message.status" light :title="statusLabel(message.status)" :aria-label="statusLabel(message.status)" data-test="lead-message-status" />
          </template>
          <template v-else-if="isDryRun(message.status)"> · {{ statusLabel(message.status) }}</template>
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
    <div v-else-if="!thread.canReplyFreeText" class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3" data-test="window-closed">
      <span class="text-[12px] text-ink-muted">
        {{ t(
          'More than 24 hours since they last wrote, so WhatsApp will not carry a free-form reply. A template has to go out instead.',
          'Han pasado más de 24 horas desde su último mensaje, así que WhatsApp no admite una respuesta libre. Hay que enviar una plantilla.',
        ) }}
      </span>
      <!-- The way out the message names, as a patient thread offers it.
      Instagram has no templates, and a lead with no number has nowhere for
      one to go. -->
      <UiBtn v-if="isWhatsApp && thread.phone" variant="primary" size="sm" data-test="lead-send-template" @click="emit('sendTemplate')">
        {{ t('Send template', 'Enviar plantilla') }}
      </UiBtn>
    </div>

    <div v-else-if="canReply" class="shrink-0 border-t border-line bg-surface px-4 py-3" data-test="lead-composer">
      <div v-if="recording" class="flex items-center gap-3" data-test="lead-recording">
        <span class="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-danger-text" />
        <span class="flex-1 text-[13px] text-ink-700">{{ t('Recording…', 'Grabando…') }} {{ recordingLabel(seconds) }}</span>
        <button type="button" class="shrink-0 text-[12px] text-ink-faint hover:text-ink-muted" @click="cancelRecording">{{ t('Cancel', 'Cancelar') }}</button>
        <UiBtn variant="primary" size="sm" @click="toggleRecording">{{ t('Send', 'Enviar') }}</UiBtn>
      </div>
      <template v-else>
      <textarea
        ref="textarea"
        v-model="draft"
        rows="2"
        class="w-full resize-none rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 placeholder:text-ink-faint focus:border-brand focus:outline-none"
        :placeholder="t('Write a reply…', 'Escribe una respuesta…')"
        @keydown.enter.exact.prevent="submit"
      />
      <div class="mt-2 flex items-center justify-end gap-2">
        <template v-if="isWhatsApp">
          <button
            type="button"
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-ctl border border-line-control text-ink-muted hover:bg-surface-subtle disabled:opacity-50"
            :disabled="sending"
            :title="t('Attach a file', 'Adjuntar archivo')"
            :aria-label="t('Attach a file', 'Adjuntar archivo')"
            data-test="lead-attach"
            @click="fileInput?.click()"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
              <path d="M11.5 5.5L6.4 10.6a2 2 0 002.8 2.8l5.1-5.1a3.5 3.5 0 00-4.95-4.95L4.25 8.45a5 5 0 007.07 7.07" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <input ref="fileInput" type="file" class="hidden" accept="image/*,video/*,audio/*,.pdf,.doc,.docx" data-test="lead-file-input" @change="onFileChosen" />
          <button
            type="button"
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-ctl border border-line-control text-ink-muted hover:bg-surface-subtle disabled:opacity-50"
            :disabled="sending"
            :title="t('Record a voice note', 'Grabar una nota de voz')"
            :aria-label="t('Record a voice note', 'Grabar una nota de voz')"
            data-test="lead-voice"
            @click="toggleRecording"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
              <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
              <path d="M3 8a5 5 0 0 0 10 0M8 13v1.5" stroke-linecap="round" />
            </svg>
          </button>
        </template>
        <InboxSavedRepliesPicker @insert="insertReply" />
        <span class="flex-1" />
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
      </template>
    </div>
  </div>
</template>

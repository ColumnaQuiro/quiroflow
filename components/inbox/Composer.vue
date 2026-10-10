<script setup lang="ts">
// The message bar under a thread: attach, voice note, saved replies, the box
// and Send. One component for a patient's thread and a lead's, because they
// were two -- the lead thread grew its own bar from the Growth designs and
// drifted (a different box, different sizes, no attach, no voice note, no
// saved replies) on what is, to the person typing, the same WhatsApp chat.
//
// It turns a chosen file or a recording into what whatsapp/inbox-send takes
// and hands that up; where it goes is the thread's business.

export interface ComposerMedia {
  base64: string
  mimeType: string
  filename: string
  kind: 'image' | 'video' | 'audio' | 'document'
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    sending: boolean
    /** The thread is not ready to send into (still loading, say). */
    disabled?: boolean
    /**
     * Attachments and voice notes are WhatsApp-only: both upload through
     * whatsapp/inbox-send, and instagram/send posts text alone. Offering the
     * buttons on an Instagram thread would take a file, upload it and fail
     * at the very end.
     */
    media?: boolean
  }>(),
  { disabled: false, media: true },
)

const emit = defineEmits<{
  'update:modelValue': [text: string]
  send: []
  media: [media: ComposerMedia]
  /** Something to tell the person: too big, no microphone, unreadable. */
  error: [message: string]
}>()

const t = useT()
const textarea = ref<HTMLTextAreaElement>()
const fileInput = ref<HTMLInputElement>()
const text = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('update:modelValue', value),
})

// Inserts at the cursor rather than replacing the text outright, so picking
// a saved reply doesn't clobber anything already typed.
function insertReply(reply: string) {
  const el = textarea.value
  if (!el) {
    text.value += reply
    return
  }
  const start = el.selectionStart ?? text.value.length
  const end = el.selectionEnd ?? text.value.length
  text.value = text.value.slice(0, start) + reply + text.value.slice(end)
  nextTick(() => {
    el.focus()
    const cursor = start + reply.length
    el.setSelectionRange(cursor, cursor)
  })
}

function submit() {
  if (props.sending || props.disabled || !text.value.trim()) return
  emit('send')
}

const MAX_MEDIA_BYTES = 16 * 1024 * 1024
function mediaKindForFile(file: File): ComposerMedia['kind'] {
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
    emit('error', t('File is too large (max 16 MB).', 'El archivo es demasiado grande (máx. 16 MB).'))
    return
  }
  const kind = mediaKindForFile(file)
  if (kind === 'image') {
    try {
      const { blob, mimeType } = await normalizeImageForWhatsApp(file)
      emit('media', { base64: await blobToBase64(blob), mimeType, filename: file.name.replace(/\.\w+$/, '.jpg'), kind })
    } catch (err: any) {
      emit('error', err?.message ?? t('Could not process this image.', 'No se pudo procesar esta imagen.'))
    }
  } else {
    emit('media', { base64: await blobToBase64(file), mimeType: file.type, filename: file.name, kind })
  }
}

const { recording, seconds, start: startRecording, stop: stopRecording, cancel: cancelRecording } = useAudioRecorder()

async function toggleRecording() {
  if (recording.value) {
    const result = await stopRecording()
    if (!result) return
    emit('media', {
      base64: await blobToBase64(result.blob),
      mimeType: result.mimeType,
      filename: `voice-note.${extensionForAudioMimeType(result.mimeType)}`,
      kind: 'audio',
    })
    return
  }
  try {
    await startRecording()
  } catch {
    emit('error', t('Could not access the microphone -- check your browser permissions.', 'No se pudo acceder al micrófono; comprueba los permisos del navegador.'))
  }
}

function recordingLabel(secs: number) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>

<template>
  <div v-if="recording" class="flex items-center gap-3 rounded-ctl border border-line-control bg-surface-subtle px-3 py-2" data-cy="composer-recording">
    <span class="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-danger-text" />
    <span class="flex-1 text-[13.5px] text-ink-700">{{ t('Recording…', 'Grabando…') }} {{ recordingLabel(seconds) }}</span>
    <button type="button" class="shrink-0 text-[12.5px] text-ink-faint hover:text-ink-muted" @click="cancelRecording">{{ t('Cancel', 'Cancelar') }}</button>
    <UiBtn variant="primary" size="sm" @click="toggleRecording">{{ t('Send', 'Enviar') }}</UiBtn>
  </div>
  <!-- On a phone the message box takes the full width on a row of its own,
  with attach, voice, saved replies and Send under it: inline it was left
  about 130px between them. -->
  <div v-else class="flex flex-wrap items-end gap-2 sm:flex-nowrap">
    <button
      v-if="media"
      type="button"
      data-cy="composer-attach"
      class="flex h-9 touch:h-11 w-9 touch:w-11 shrink-0 items-center justify-center rounded-ctl border border-line-control text-ink-500 hover:bg-surface-subtle"
      :disabled="sending || disabled"
      :aria-label="t('Attach a file', 'Adjuntar archivo')"
      @click="fileInput?.click()"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
        <path d="M11.5 5.5L6.4 10.6a2 2 0 002.8 2.8l5.1-5.1a3.5 3.5 0 00-4.95-4.95L4.25 8.45a5 5 0 007.07 7.07" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
    <input v-if="media" ref="fileInput" type="file" class="hidden" accept="image/*,video/*,audio/*,.pdf,.doc,.docx" data-cy="composer-file" @change="onFileChosen" />
    <button
      v-if="media"
      type="button"
      data-cy="composer-voice"
      class="flex h-9 touch:h-11 w-9 touch:w-11 shrink-0 items-center justify-center rounded-ctl border border-line-control text-ink-500 hover:bg-surface-subtle disabled:opacity-50"
      :disabled="sending || disabled"
      :title="t('Record a voice note', 'Grabar una nota de voz')"
      :aria-label="t('Record a voice note', 'Grabar una nota de voz')"
      @click="toggleRecording"
    >
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
        <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
        <path d="M3 8a5 5 0 0 0 10 0M8 13v1.5" stroke-linecap="round" />
      </svg>
    </button>
    <InboxSavedRepliesPicker @insert="insertReply" />
    <textarea
      ref="textarea"
      v-model="text"
      rows="1"
      :placeholder="t('Type a message…', 'Escribe un mensaje…')"
      class="order-first max-h-32 min-h-9 w-full touch:min-h-11 resize-none rounded-ctl border border-line-control bg-surface px-3 py-[10px] text-[15px] text-ink-900 focus:border-brand focus:outline-none sm:order-none sm:w-auto sm:flex-1"
      @keydown.enter.exact.prevent="submit"
    />
    <!-- Anything a thread adds beside Send: a lead's "Draft a reply". -->
    <slot name="actions" />
    <button
      type="button"
      data-cy="thread-send"
      class="ml-auto h-9 touch:h-11 shrink-0 rounded-ctl bg-brand sm:ml-0 px-4 text-[14px] font-bold text-surface hover:bg-brand-hover disabled:opacity-50"
      :disabled="sending || !text.trim() || disabled"
      @click="submit"
    >{{ sending ? '…' : t('Send', 'Enviar') }}</button>
  </div>
</template>

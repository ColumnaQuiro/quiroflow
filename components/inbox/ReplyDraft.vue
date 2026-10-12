<script setup lang="ts">
// "Redactar respuesta" above the message bar in a patient's conversation,
// web Inbox and the staff app's: the receptionist writes a reply from the
// conversation and what the clinic knows about them (next visit, plan, what
// they owe -- server/utils/patientReplyDraft.ts), and it waits here to be
// read. Send it as it is with one tap, take it into the box to change it, or
// throw it away. Nothing goes until a person presses Send.
const props = defineProps<{
  patientId: string
  /** Asks the API for a draft (the web's own fetch, or the app's). */
  draftFor: (patientId: string) => Promise<{ available: boolean; draft: string; refused?: boolean }>
  sending?: boolean
  size?: 'sm' | 'lg'
  /**
   * A draft the receptionist already wrote without being asked (the tick,
   * inbox_reply_drafts), shown as soon as the thread opens, and marked dealt
   * with once it is sent, taken into the box or thrown away. Optional: the
   * staff app does not pass it yet, and keeps the button alone.
   */
  stored?: { load: () => Promise<string | null>; dismiss: () => Promise<void> }
}>()
const emit = defineEmits<{ send: [text: string]; edit: [text: string] }>()

const t = useT()
const drafting = ref(false)
const draft = ref('')
const note = ref('')

// Another conversation: whatever was drafted belongs to the last one, and
// the new one may have a draft waiting.
watch(() => props.patientId, () => {
  draft.value = ''
  note.value = ''
  loadStored()
}, { immediate: true })

async function loadStored() {
  if (!props.stored) return
  const forPatient = props.patientId
  const body = await props.stored.load().catch(() => null)
  // Still the same conversation, and nothing asked for meanwhile.
  if (body && forPatient === props.patientId && !draft.value && !drafting.value) draft.value = body
}

// Dealt with: never shown again, and the tick does not write it again until
// the patient says something new.
function dismissStored() {
  props.stored?.dismiss().catch(() => {})
}

async function ask() {
  drafting.value = true
  note.value = ''
  try {
    const r = await props.draftFor(props.patientId)
    if (!r.available) note.value = t('Reply drafts are not set up on this deployment.', 'Los borradores de respuesta no están configurados en este despliegue.')
    else if (r.refused || !r.draft) note.value = t("The receptionist didn't want to answer this one -- reply yourself.", 'La recepcionista no ha querido responder a este -- respóndele tú.')
    else draft.value = r.draft
  } catch (e) {
    const msg = (e as { data?: { statusMessage?: string }; statusMessage?: string })?.data?.statusMessage ?? (e as { statusMessage?: string })?.statusMessage ?? ''
    note.value = /nothing new/i.test(msg)
      ? t('Nothing new from them to reply to.', 'No hay nada nuevo suyo que responder.')
      : /Growth/i.test(msg)
        ? t('Reply drafts are part of Growth.', 'Los borradores de respuesta son parte de Growth.')
        : t("Couldn't draft a reply. Try again.", 'No se ha podido redactar una respuesta. Inténtalo de nuevo.')
  } finally {
    drafting.value = false
  }
}
function send() {
  const text = draft.value.trim()
  if (!text) return
  draft.value = ''
  dismissStored()
  emit('send', text)
}
function edit() {
  const text = draft.value
  draft.value = ''
  dismissStored()
  emit('edit', text)
}
function discard() {
  draft.value = ''
  dismissStored()
}
const btnH = computed(() => (props.size === 'lg' ? 'h-10' : 'h-8 touch:h-10'))
</script>

<template>
  <div class="mb-2" data-cy="reply-draft">
    <div v-if="draft" class="rounded-ctl border border-brand-tintBorder bg-brand-tint px-3 py-2.5">
      <p class="text-[11.5px] font-semibold uppercase tracking-[.04em] text-brand-text">{{ t('Suggested reply', 'Respuesta sugerida') }}</p>
      <p class="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-[13.5px] leading-snug text-ink-900" data-cy="reply-draft-text">{{ draft }}</p>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" class="flex items-center rounded-ctl bg-brand px-3 text-[13px] font-semibold text-white disabled:opacity-50" :class="btnH" :disabled="sending" data-cy="reply-draft-send" @click="send">{{ t('Send', 'Enviar') }}</button>
        <button type="button" class="flex items-center rounded-ctl border border-line-control bg-surface px-3 text-[13px] font-medium text-ink-700 hover:bg-surface-subtle" :class="btnH" data-cy="reply-draft-edit" @click="edit">{{ t('Edit', 'Editar') }}</button>
        <button type="button" class="flex items-center px-2 text-[13px] text-ink-muted hover:text-ink-700" :class="btnH" data-cy="reply-draft-discard" @click="discard">{{ t('Discard', 'Descartar') }}</button>
      </div>
    </div>
    <div v-else class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-pill border border-brand-tintBorder bg-brand-tint px-3 text-[12.5px] font-semibold text-brand-text disabled:opacity-60"
        :class="btnH"
        :disabled="drafting"
        data-cy="reply-draft-ask"
        @click="ask"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>
        {{ drafting ? t('Drafting…', 'Redactando…') : t('Draft a reply', 'Redactar respuesta') }}
      </button>
      <p v-if="note" class="text-[12.5px] text-ink-muted" data-cy="reply-draft-note">{{ note }}</p>
    </div>
  </div>
</template>

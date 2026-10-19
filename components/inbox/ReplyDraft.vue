<script setup lang="ts">
// "Redactar respuesta" above the message bar in a patient's conversation,
// web Inbox and the staff app's: the receptionist writes a reply from the
// conversation and what the clinic knows about them (next visit, plan, what
// they owe -- server/utils/patientReplyDraft.ts), and it waits here to be
// read, in the same card a lead's draft waits in (InboxAiDraftCard). Approve
// it as it is, edit it in place, or throw it away. Nothing goes until a
// person presses the button.
const props = defineProps<{
  patientId: string
  /** Asks the API for a draft (the web's own fetch, or the app's). */
  draftFor: (patientId: string) => Promise<{ available: boolean; draft: string; refused?: boolean }>
  sending?: boolean
  size?: 'sm' | 'lg'
  /**
   * A draft the receptionist already wrote without being asked (the tick,
   * inbox_reply_drafts), shown as soon as the thread opens, and marked dealt
   * with once it is sent or thrown away. Optional: the staff app does not
   * pass it yet, and keeps the button alone.
   */
  stored?: { load: () => Promise<string | null>; dismiss: () => Promise<void> }
}>()
const emit = defineEmits<{ send: [text: string]; edit: [text: string] }>()

const t = useT()
const drafting = ref(false)
const draft = ref('')
const draftAt = ref<string | null>(null)
const note = ref('')

// Another conversation: whatever was drafted belongs to the last one, and
// the new one may have a draft waiting.
watch(() => props.patientId, () => {
  draft.value = ''
  draftAt.value = null
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
    else {
      draft.value = r.draft
      draftAt.value = new Date().toISOString()
    }
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
function approve(text: string) {
  draft.value = ''
  draftAt.value = null
  dismissStored()
  emit('send', text)
}
function discard() {
  draft.value = ''
  draftAt.value = null
  dismissStored()
}
const btnH = computed(() => (props.size === 'lg' ? 'h-10' : 'h-8 touch:h-10'))
</script>

<template>
  <!-- Sits in a row beside "Internal note" (pages/inbox.vue): the button
  shares it, a drafted reply takes the whole row. -->
  <div :class="draft ? 'basis-full' : ''" data-cy="reply-draft-slot">
    <InboxAiDraftCard v-if="draft" :draft="draft" :at="draftAt" :sending="sending" :size="size" @approve="approve" @discard="discard" />
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

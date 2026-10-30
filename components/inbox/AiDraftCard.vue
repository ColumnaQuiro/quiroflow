<script setup lang="ts">
// A reply the AI receptionist wrote, waiting on a person -- the same card
// whether it is a lead's draft (leads.ai_draft_body) or a patient's
// (inbox_reply_drafts), because it is the same promise: the model writes, a
// human decides, and nothing reaches anyone unread. The two used to be two
// cards with two vocabularies ("Approve and send" / "Send", inline edit /
// edit in the composer), and staff had to learn both.
//
// Shared with the staff app (mobile/ resolves components/ too), so no `~`
// imports here.
const props = defineProps<{
  draft: string
  /** When it was written, shown beside the label. */
  at?: string | null
  sending?: boolean
  /** Bigger controls, for a thumb. */
  size?: 'sm' | 'lg'
}>()
const emit = defineEmits<{ approve: [text: string]; discard: [] }>()

const t = useT()

// Editing happens in the card, not in the composer: they are two different
// messages, and sharing one box is how an edit silently becomes the thing
// you typed earlier.
const editing = ref(false)
const edited = ref('')

// Another draft arrived (another conversation, or the tick rewrote it):
// whatever was being edited belonged to the last one.
watch(() => props.draft, () => {
  editing.value = false
  edited.value = ''
})

function startEditing() {
  edited.value = props.draft
  editing.value = true
}

function approve() {
  const text = (editing.value ? edited.value : props.draft).trim()
  if (!text || props.sending) return
  emit('approve', text)
  editing.value = false
}

const btnH = computed(() => (props.size === 'lg' ? 'h-10' : 'h-8 touch:h-10'))

function time(at: string) {
  return new Date(at).toLocaleString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="flex flex-col gap-2.5 rounded-ctl border border-brand-tintBorder bg-brand-tint p-3" data-test="ai-draft" data-cy="reply-draft">
    <div class="flex flex-wrap items-center gap-2">
      <span class="flex h-[18px] w-[18px] items-center justify-center rounded-[6px] bg-brand text-[11px] font-bold text-brand-on">AI</span>
      <span class="text-[12px] font-semibold text-brand-text">
        {{ t('Drafted by the receptionist · needs your approval', 'Redactado por la recepcionista · requiere tu aprobación') }}
      </span>
      <span v-if="at" class="text-[11px] text-ink-muted">{{ time(at) }}</span>
    </div>

    <textarea
      v-if="editing"
      v-model="edited"
      rows="4"
      class="w-full resize-none rounded-ctl border border-brand-tintBorder bg-surface px-3 py-2.5 text-[13px] leading-[1.5] text-ink-900 focus:border-brand focus:outline-none"
      :aria-label="t('Edit the draft', 'Editar el borrador')"
      data-test="ai-draft-textarea"
    />
    <p v-else class="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-ctl [overflow-wrap:anywhere] border border-brand-tintBorder bg-surface px-3 py-2.5 text-[13px] leading-[1.5] text-ink-900" data-test="ai-draft-text" data-cy="reply-draft-text">
      {{ draft }}
    </p>

    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="flex items-center rounded-ctl bg-brand px-3 text-[13px] font-semibold text-brand-on hover:bg-brand-hover disabled:opacity-50"
        :class="btnH"
        :disabled="sending || (editing && !edited.trim())"
        data-test="ai-draft-approve"
        @click="approve"
      >{{ sending ? t('Sending…', 'Enviando…') : t('Approve and send', 'Aprobar y enviar') }}</button>
      <button
        v-if="!editing"
        type="button"
        class="flex items-center rounded-ctl border border-line-control bg-surface px-3 text-[13px] font-medium text-ink-700 hover:bg-surface-subtle"
        :class="btnH"
        data-test="ai-draft-edit"
        @click="startEditing"
      >{{ t('Edit', 'Editar') }}</button>
      <button
        type="button"
        class="flex items-center px-2 text-[13px] text-ink-muted hover:text-danger-text disabled:opacity-50"
        :class="btnH"
        :disabled="sending"
        data-test="ai-draft-discard"
        @click="emit('discard')"
      >{{ t('Discard', 'Descartar') }}</button>
      <span class="ml-auto text-[11px] text-ink-muted">
        {{ t('Nothing sends without your approval', 'No se envía nada sin tu aprobación') }}
      </span>
    </div>
  </div>
</template>

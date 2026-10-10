<script setup lang="ts">
import { mentionQueryAt, mentionedIn } from '../../utils/inboxNotes'
import { normalizeSearchTerm } from '../../utils/searchText'

// Writing an internal note: amber like the notes themselves, so nobody takes
// it for the message box. "@" suggests colleagues; a colleague still named
// in the text when it is saved is mentioned -- the conversation turns unread
// for them and they get a push.
const props = defineProps<{ team: { id: string; full_name: string }[]; myId: string | null; saving: boolean; error?: string; size?: 'sm' | 'lg' }>()
const emit = defineEmits<{ save: [body: string, mentions: string[]]; cancel: [] }>()
const t = useT()
const text = ref('')
const box = ref<HTMLTextAreaElement>()
const query = ref<{ start: number; query: string } | null>(null)
const others = computed(() => props.team.filter((m) => m.id !== props.myId))
const suggestions = computed(() => {
  if (!query.value) return []
  const q = normalizeSearchTerm(query.value.query)
  return others.value.filter((m) => normalizeSearchTerm(m.full_name).includes(q)).slice(0, 6)
})
function onInput() {
  const el = box.value
  query.value = el ? mentionQueryAt(text.value, el.selectionStart ?? text.value.length) : null
}
function pick(m: { full_name: string }) {
  const q = query.value
  const el = box.value
  if (!q || !el) return
  const caret = el.selectionStart ?? text.value.length
  text.value = `${text.value.slice(0, q.start)}@${m.full_name} ${text.value.slice(caret)}`
  query.value = null
  nextTick(() => {
    const at = q.start + m.full_name.length + 2
    el.focus()
    el.setSelectionRange(at, at)
  })
}
function save() {
  if (!text.value.trim() || props.saving) return
  emit('save', text.value, mentionedIn(text.value, others.value))
}
defineExpose({ clear: () => (text.value = '') })
onMounted(() => box.value?.focus())
const tall = computed(() => (props.size === 'lg' ? 'min-h-11' : 'min-h-9 touch:min-h-11'))
</script>

<template>
  <div class="relative rounded-ctl border border-warning-border bg-warning-bg p-2" data-cy="note-composer">
    <p class="mb-1.5 flex items-center gap-1.5 px-1 text-[12px] font-semibold text-warning-text">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
      {{ t('Internal note — only the team sees it. Type @ to mention someone.', 'Nota interna — solo la ve el equipo. Escribe @ para mencionar.') }}
    </p>
    <div v-if="suggestions.length" class="absolute bottom-[calc(100%+4px)] left-2 z-30 w-64 rounded-card border border-line bg-surface p-1 shadow-popover" role="listbox" data-cy="note-mention-list">
      <button v-for="m in suggestions" :key="m.id" type="button" role="option" class="flex min-h-10 w-full items-center rounded-ctlSm px-2.5 text-left text-[14px] text-ink-900 hover:bg-surface-subtle" data-cy="note-mention-option" @mousedown.prevent="pick(m)">
        {{ m.full_name }}
      </button>
    </div>
    <div class="flex items-end gap-2">
      <textarea
        ref="box"
        v-model="text"
        rows="2"
        :placeholder="t('Write a note for the team…', 'Escribe una nota para el equipo…')"
        class="max-h-32 flex-1 resize-none rounded-ctl border border-warning-border bg-surface px-3 py-2 text-[14px] text-ink-900 focus:border-brand focus:outline-none"
        :class="tall"
        data-cy="note-text"
        @input="onInput"
        @click="onInput"
        @keydown.enter.exact.prevent="suggestions.length ? pick(suggestions[0]!) : save()"
        @keydown.esc="query ? (query = null) : emit('cancel')"
      />
      <div class="flex shrink-0 flex-col gap-1.5">
        <button type="button" class="h-9 rounded-ctl bg-warning-text px-3 text-[13.5px] font-bold text-surface disabled:opacity-50" :class="size === 'lg' ? 'h-11' : 'touch:h-11'" :disabled="saving || !text.trim()" data-cy="note-save" @click="save">
          {{ saving ? '…' : t('Save note', 'Guardar nota') }}
        </button>
        <button type="button" class="text-[12px] text-ink-muted" @click="emit('cancel')">{{ t('Cancel', 'Cancelar') }}</button>
      </div>
    </div>
    <p v-if="error" class="mt-1 px-1 text-[12px] text-danger-text">{{ error }}</p>
  </div>
</template>

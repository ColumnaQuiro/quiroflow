<script setup lang="ts">
import { mentionParts, type InboxNote } from '../../utils/inboxNotes'

// An internal note in the thread: amber, full width, "Nota interna · Ana ·
// 10:42", with its @mentions picked out. Never sent to the patient -- it says
// so, since it sits among the messages that were.
const props = defineProps<{ note: InboxNote; team: { id: string; full_name: string }[]; mine: boolean }>()
const emit = defineEmits<{ delete: [] }>()
const t = useT()
const author = computed(() => props.team.find((m) => m.id === props.note.author_id)?.full_name ?? t('A colleague', 'Un compañero'))
const parts = computed(() => mentionParts(props.note.body, props.team.map((m) => m.full_name)))
const time = computed(() => new Date(props.note.created_at).toLocaleTimeString(t('en-GB', 'es-ES'), { hour: '2-digit', minute: '2-digit' }))
const confirming = ref(false)
</script>

<template>
  <div class="flex justify-center" data-cy="thread-note">
    <div class="w-full max-w-[92%] rounded-card border border-warning-border bg-warning-bg px-3 py-2 text-[13.5px] text-ink-900 shadow-card">
      <p class="flex items-center gap-1.5 text-[11.5px] font-semibold text-warning-text">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
        <span>{{ t('Internal note', 'Nota interna') }} · {{ author }} · {{ time }}</span>
        <span class="flex-1" />
        <template v-if="mine">
          <button v-if="!confirming" type="button" class="text-[11.5px] font-medium text-warning-text underline-offset-2 hover:underline" data-cy="thread-note-delete" @click="confirming = true">{{ t('Delete', 'Borrar') }}</button>
          <template v-else>
            <button type="button" class="text-[11.5px] font-semibold text-danger-text" data-cy="thread-note-delete-confirm" @click="emit('delete')">{{ t('Delete it', 'Borrarla') }}</button>
            <button type="button" class="ml-2 text-[11.5px] text-ink-muted" @click="confirming = false">{{ t('Keep', 'Dejar') }}</button>
          </template>
        </template>
      </p>
      <p class="mt-0.5 whitespace-pre-wrap break-words" data-cy="thread-note-body"><template v-for="(p, i) in parts" :key="i"><span v-if="p.mention" class="font-semibold text-brand-text">{{ p.text }}</span><template v-else>{{ p.text }}</template></template></p>
      <p class="mt-1 text-[11px] text-ink-muted">{{ t('Only the team sees this.', 'Solo lo ve el equipo.') }}</p>
    </div>
  </div>
</template>

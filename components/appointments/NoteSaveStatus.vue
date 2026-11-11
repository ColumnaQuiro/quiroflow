<script setup lang="ts">
// The line under a visit note that says where its text is, so nobody has to
// wonder whether to press anything (useVisitNoteAutosave saves on its own).
// 'dirty' says nothing: it lasts the 800 ms before the save and would only
// flicker.
import type { VisitNoteAutosaveState } from '~/composables/useVisitNoteAutosave'

const props = defineProps<{ state: VisitNoteAutosaveState; errorKind: 'offline' | 'refused' | 'failed' | null }>()
const t = useT()

const text = computed(() => {
  if (props.state === 'saving') return t('Saving…', 'Guardando…')
  if (props.state === 'saved') return t('Saved', 'Guardado')
  if (props.state !== 'error') return ''
  if (props.errorKind === 'offline') return t("No connection. It will save as soon as you're back online.", 'Sin conexión. Se guardará en cuanto vuelva la conexión.')
  if (props.errorKind === 'refused') return t('Not saved: your role cannot change this note.', 'No se ha guardado: tu rol no puede modificar esta nota.')
  return t('Not saved yet. Trying again…', 'Aún no se ha guardado. Reintentando…')
})
</script>

<template>
  <p
    v-if="text"
    :role="state === 'error' ? 'alert' : 'status'"
    class="text-[11.5px]"
    :class="state === 'error' ? 'text-danger-text' : state === 'saved' ? 'text-success-text' : 'text-ink-faint2'"
    data-cy="note-save-status"
  >
    {{ text }}
  </p>
</template>

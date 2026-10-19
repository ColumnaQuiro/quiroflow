<script setup lang="ts">
import type { ReceptionistConfig } from '~/composables/useGrowthReceptionist'

// What it works into the conversation to qualify an enquiry, in the order
// it asks them -- which is why they can be moved, not only added and
// removed: the prompt lists them numbered, and the card says "asked in this
// order".
const props = defineProps<{
  config: ReceptionistConfig
  saving: boolean
  save: (patch: Partial<ReceptionistConfig>) => Promise<boolean>
}>()

const t = useT()
const draft = ref('')
const editingIndex = ref<number | null>(null)
const editText = ref('')

function add() {
  const question = draft.value.trim()
  if (!question) return
  props.save({ qualificationQuestions: [...props.config.qualificationQuestions, question.slice(0, 300)] })
  draft.value = ''
}

function remove(index: number) {
  props.save({ qualificationQuestions: props.config.qualificationQuestions.filter((_, i) => i !== index) })
}

function move(index: number, by: -1 | 1) {
  const list = [...props.config.qualificationQuestions]
  const target = index + by
  if (target < 0 || target >= list.length) return
  ;[list[index], list[target]] = [list[target]!, list[index]!]
  props.save({ qualificationQuestions: list })
}

function startEdit(index: number) {
  editingIndex.value = index
  editText.value = props.config.qualificationQuestions[index] ?? ''
}

async function commitEdit() {
  const index = editingIndex.value
  const text = editText.value.trim()
  if (index === null || !text) return
  const ok = await props.save({ qualificationQuestions: props.config.qualificationQuestions.map((q, i) => (i === index ? text.slice(0, 300) : q)) })
  if (ok) editingIndex.value = null
}

const inputClass = 'h-8 min-w-0 flex-1 rounded-ctl border border-line-control bg-surface px-2.5 text-[12px] text-ink-700 focus:border-brand focus:outline-none'
const iconBtn = 'flex h-6 w-6 items-center justify-center rounded-ctlSm text-[11px] text-ink-muted hover:bg-surface-subtle hover:text-ink-900 disabled:opacity-30'
</script>

<template>
  <GrowthSettingCard :title="t('Qualification questions', 'Preguntas de cualificación')">
    <p v-if="!config.qualificationQuestions.length" class="text-[11.5px] leading-[1.5] text-ink-muted" data-test="questions-empty">
      {{ t(
        'None yet. The receptionist will answer and offer times without finding out what is wrong first.',
        'Ninguna todavía. La recepcionista responderá y ofrecerá horarios sin averiguar antes qué le pasa.',
      ) }}
    </p>
    <ol v-else class="flex flex-col gap-1.5">
      <li
        v-for="(question, i) in config.qualificationQuestions"
        :key="`${question}-${i}`"
        class="flex items-start gap-2 text-[11.5px] text-ink-700"
        data-test="qualification-question"
      >
        <span class="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-chip-bg text-[9.5px] font-semibold text-ink-muted">{{ i + 1 }}</span>
        <template v-if="editingIndex === i">
          <input v-model="editText" type="text" :class="inputClass" :aria-label="t('Question', 'Pregunta')" data-test="edit-question" @keyup.enter="commitEdit">
          <UiBtn variant="primary" size="sm" :disabled="saving || !editText.trim()" data-test="edit-question-save" @click="commitEdit">{{ t('Save', 'Guardar') }}</UiBtn>
          <UiBtn variant="ghost" size="sm" :disabled="saving" @click="editingIndex = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
        </template>
        <template v-else>
          <span class="min-w-0 flex-1">{{ question }}</span>
          <span class="flex shrink-0 items-center gap-0.5">
            <button type="button" :class="iconBtn" :disabled="saving || i === 0" :aria-label="t('Move up', 'Subir')" data-test="question-up" @click="move(i, -1)">↑</button>
            <button type="button" :class="iconBtn" :disabled="saving || i === config.qualificationQuestions.length - 1" :aria-label="t('Move down', 'Bajar')" data-test="question-down" @click="move(i, 1)">↓</button>
            <button type="button" class="px-1 text-[10.5px] font-medium text-brand-text hover:underline" :disabled="saving" data-test="question-edit" @click="startEdit(i)">{{ t('Edit', 'Editar') }}</button>
            <button type="button" class="px-1 text-[10.5px] font-medium text-danger-text hover:underline" :disabled="saving" data-test="question-remove" @click="remove(i)">{{ t('Remove', 'Quitar') }}</button>
          </span>
        </template>
      </li>
    </ol>

    <div class="flex flex-col gap-1.5 border-t border-line-divider pt-2.5">
      <input
        v-model="draft"
        type="text"
        :placeholder="t('e.g. How long have you had it?', 'p. ej. ¿Desde cuándo lo tienes?')"
        class="h-8 rounded-ctl border border-line-control bg-surface px-2.5 text-[12px] text-ink-700 focus:border-brand focus:outline-none"
        data-test="question-text"
        @keyup.enter="add"
      />
      <UiBtn variant="secondary" size="sm" class="self-start" :disabled="saving || !draft.trim()" data-test="add-question" @click="add">
        {{ t('Add question', 'Añadir pregunta') }}
      </UiBtn>
      <p class="text-[10.5px] leading-[1.5] text-ink-muted">
        {{ t('Asked in this order, one at a time, and only once the patient\'s own question has been dealt with.', 'Se preguntan en este orden, de una en una, y solo cuando ya se ha atendido lo que preguntaba el paciente.') }}
      </p>
    </div>
  </GrowthSettingCard>
</template>

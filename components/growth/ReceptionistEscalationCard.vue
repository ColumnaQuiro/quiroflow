<script setup lang="ts">
import type { ReceptionistConfig } from '~/composables/useGrowthReceptionist'

// When it stops and hands the conversation to a person. Each rule is a
// "when" and a "then", and the prompt lists them as such; when it answers
// on its own, a rule that applies makes it call hand_over_to_colleague,
// which notifies the team and leaves a note in the conversation.
const props = defineProps<{
  config: ReceptionistConfig
  saving: boolean
  save: (patch: Partial<ReceptionistConfig>) => Promise<boolean>
}>()

const t = useT()
const newRule = ref('')
const newAction = ref('')
const editingIndex = ref<number | null>(null)
const editRule = ref('')
const editAction = ref('')

function add() {
  const rule = newRule.value.trim()
  const action = newAction.value.trim()
  if (!rule || !action) return
  props.save({ escalationRules: [...props.config.escalationRules, { rule: rule.slice(0, 300), action: action.slice(0, 300) }] })
  newRule.value = ''
  newAction.value = ''
}

function remove(index: number) {
  props.save({ escalationRules: props.config.escalationRules.filter((_, i) => i !== index) })
}

function startEdit(index: number) {
  const rule = props.config.escalationRules[index]
  if (!rule) return
  editingIndex.value = index
  editRule.value = rule.rule
  editAction.value = rule.action
}

async function commitEdit() {
  const index = editingIndex.value
  const rule = editRule.value.trim()
  const action = editAction.value.trim()
  if (index === null || !rule || !action) return
  const ok = await props.save({ escalationRules: props.config.escalationRules.map((r, i) => (i === index ? { rule: rule.slice(0, 300), action: action.slice(0, 300) } : r)) })
  if (ok) editingIndex.value = null
}

const inputClass = 'h-8 min-w-0 rounded-ctl border border-line-control bg-surface px-2.5 text-[12px] text-ink-700 focus:border-brand focus:outline-none'
</script>

<template>
  <GrowthSettingCard :title="t('When it hands over to a person', 'Cuándo pasa a una persona')">
    <p v-if="!config.escalationRules.length" class="text-[11.5px] leading-[1.5] text-ink-muted" data-test="escalation-empty">
      {{ t('None set. The receptionist will answer everything it can, and hand over only what it cannot do.', 'Ninguna definida. La recepcionista responderá todo lo que pueda y solo pasará lo que no pueda hacer.') }}
    </p>
    <ul v-else class="flex flex-col gap-1.5">
      <li
        v-for="(rule, i) in config.escalationRules"
        :key="`${rule.rule}-${i}`"
        class="flex flex-col gap-1.5 rounded-ctl border border-line bg-surface-subtle px-2.5 py-1.5 text-[11.5px] text-ink-700"
        data-test="escalation-rule"
      >
        <template v-if="editingIndex === i">
          <div class="grid gap-1.5 sm:grid-cols-2">
            <input v-model="editRule" type="text" :class="inputClass" :aria-label="t('When', 'Cuando')" data-test="edit-rule-when">
            <input v-model="editAction" type="text" :class="inputClass" :aria-label="t('Then', 'Entonces')" data-test="edit-rule-then">
          </div>
          <div class="flex items-center gap-2">
            <UiBtn variant="primary" size="sm" :disabled="saving || !editRule.trim() || !editAction.trim()" data-test="edit-rule-save" @click="commitEdit">{{ t('Save', 'Guardar') }}</UiBtn>
            <UiBtn variant="ghost" size="sm" :disabled="saving" @click="editingIndex = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
          </div>
        </template>
        <div v-else class="flex items-baseline justify-between gap-2">
          <span class="min-w-0">
            <span class="text-ink-faint">{{ t('When', 'Cuando') }}</span> {{ rule.rule }}
            <span class="text-ink-faint">· {{ t('then', 'entonces') }}</span> {{ rule.action }}
          </span>
          <span class="flex shrink-0 items-center gap-2">
            <button type="button" class="text-[11px] font-medium text-brand-text hover:underline" :disabled="saving" data-test="rule-edit" @click="startEdit(i)">{{ t('Edit', 'Editar') }}</button>
            <button type="button" class="text-[11px] font-medium text-danger-text hover:underline" :disabled="saving" data-test="rule-remove" @click="remove(i)">{{ t('Remove', 'Quitar') }}</button>
          </span>
        </div>
      </li>
    </ul>

    <div class="flex flex-col gap-1.5 border-t border-line-divider pt-2.5">
      <div class="grid gap-1.5 sm:grid-cols-2">
        <input
          v-model="newRule"
          type="text"
          :placeholder="t('When… e.g. they mention chest pain', 'Cuando… p. ej. mencionan dolor torácico')"
          :class="inputClass"
          data-test="rule-when"
        />
        <input
          v-model="newAction"
          type="text"
          :placeholder="t('Then… e.g. hand to a chiropractor now', 'Entonces… p. ej. pasar a un quiropráctico ya')"
          :class="inputClass"
          data-test="rule-then"
        />
      </div>
      <UiBtn variant="secondary" size="sm" class="self-start" :disabled="saving || !newRule.trim() || !newAction.trim()" data-test="add-rule" @click="add">
        {{ t('Add rule', 'Añadir regla') }}
      </UiBtn>
      <p class="text-[11px] leading-[1.5] text-ink-muted">
        {{ t(
          'Whatever the rules say, it also hands over anything it cannot do and anything it is unsure of. A handover notifies the team, leaves a note in the conversation and a task in My day.',
          'Digan lo que digan las reglas, también pasa a una persona lo que no puede hacer y lo que no tiene claro. Un traspaso avisa al equipo, deja una nota en la conversación y una tarea en Mi día.',
        ) }}
      </p>
    </div>
  </GrowthSettingCard>
</template>

<script setup lang="ts">
import type { PatientList } from '~/composables/usePatientLists'

// "Add to list" for a selection on the patient list: one of the lists the
// person may add to, or a new one named here.
const props = defineProps<{
  lists: PatientList[]
  /** How many patients are being added, for the sentence above the choice. */
  count: number
  busy?: boolean
}>()
const emit = defineEmits<{ add: [target: { listId: string } | { newName: string; shared: boolean }]; cancel: [] }>()
const t = useT()

const NEW = '__new__'
const choice = ref(props.lists[0]?.id ?? NEW)
const newName = ref('')
const shared = ref(true)

const valid = computed(() => (choice.value === NEW ? newName.value.trim().length > 0 && newName.value.trim().length <= 80 : !!choice.value))
function add() {
  if (!valid.value || props.busy) return
  emit('add', choice.value === NEW ? { newName: newName.value.trim(), shared: shared.value } : { listId: choice.value })
}
const fieldId = useId()
</script>

<template>
  <UiConfirmDialog
    :title="t('Add to list', 'Añadir a lista')"
    :confirm-label="t('Add', 'Añadir')"
    :cancel-label="t('Cancel', 'Cancelar')"
    :disabled="!valid"
    :busy="busy"
    @confirm="add"
    @cancel="emit('cancel')"
  >
    <p class="text-[13px] text-ink-muted">
      {{ count === 1
        ? t('1 patient will be added. Anyone already on the list stays as they were.', 'Se añadirá 1 paciente. Quien ya esté en la lista no cambia.')
        : t(`${count} patients will be added. Anyone already on the list stays as they were.`, `Se añadirán ${count} pacientes. Quien ya esté en la lista no cambia.`) }}
    </p>
    <label :for="`${fieldId}-list`" class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
      {{ t('List', 'Lista') }}
      <select
        :id="`${fieldId}-list`"
        v-model="choice"
        data-cy="add-to-list-choice"
        class="h-9 rounded-ctl border border-line-control bg-surface px-2 text-[14px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
      >
        <option v-for="list in lists" :key="list.id" :value="list.id">{{ list.name }}</option>
        <option :value="NEW">{{ t('New list…', 'Nueva lista…') }}</option>
      </select>
    </label>
    <template v-if="choice === NEW">
      <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
        {{ t('Name of the new list', 'Nombre de la nueva lista') }}
        <input
          v-model="newName"
          data-cy="add-to-list-new-name"
          maxlength="80"
          class="h-9 rounded-ctl border border-line-control bg-surface px-3 text-[14px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          @keydown.enter.prevent="add"
        />
      </label>
      <label class="flex items-center gap-2 text-[13px] text-ink-700">
        <input v-model="shared" type="checkbox" class="h-4 w-4 accent-brand" />
        {{ t('Share with the team', 'Compartir con el equipo') }}
      </label>
    </template>
  </UiConfirmDialog>
</template>

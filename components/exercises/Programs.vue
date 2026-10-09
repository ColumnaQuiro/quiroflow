<script setup lang="ts">
import type { ProgramItem } from '../../composables/useExercisePrograms'

// Settings > Exercise Library's programmes: a named set of the library's
// exercises with their usual dose, picked on a patient's record to assign
// them all at once. A programme is a template -- assigning copies it -- so
// editing or deleting one changes nothing a patient already has, which is
// why delete needs no archive step.
const props = defineProps<{ accountId: string; exercises: { id: string; name: string }[] }>()
const emit = defineEmits<{ changed: [] }>()

const t = useT()
const { programs, loading, load, save, remove } = useExercisePrograms({ accountId: () => props.accountId })
onMounted(load)

interface DraftItem { exercise_id: string; sets: string; reps: string; frequency: string; notes: string | null }
const editing = ref<{ id: string | null; name: string; description: string; items: DraftItem[] } | null>(null)
const saving = ref(false)
const formError = ref('')
const deleting = ref<{ id: string; name: string } | null>(null)
const deletingBusy = ref(false)

const blankItem = (): DraftItem => ({ exercise_id: '', sets: '', reps: '', frequency: '', notes: null })
function openNew() {
  editing.value = { id: null, name: '', description: '', items: [blankItem()] }
  formError.value = ''
}
function openEdit(p: (typeof programs.value)[number]) {
  editing.value = {
    id: p.id,
    name: p.name,
    description: p.description ?? '',
    items: p.exercise_program_items.map((i) => ({ exercise_id: i.exercise_id, sets: i.sets ? String(i.sets) : '', reps: i.reps ?? '', frequency: i.frequency ?? '', notes: i.notes })),
  }
  formError.value = ''
}

// The picker offers the library's current exercises, plus whatever an
// existing programme already holds (an archived one stays selectable there,
// labelled, rather than vanishing from the row).
function optionsFor(item: DraftItem) {
  const list = [...props.exercises]
  if (item.exercise_id && !list.some((e) => e.id === item.exercise_id)) {
    const held = programs.value.flatMap((p) => p.exercise_program_items).find((i) => i.exercise_id === item.exercise_id)
    list.push({ id: item.exercise_id, name: `${held?.exercises?.name ?? '?'} (${t('archived', 'archivado')})` })
  }
  return list
}

async function submit() {
  const d = editing.value
  if (!d) return
  formError.value = ''
  if (!d.name.trim()) {
    formError.value = t('Give the programme a name.', 'Pon un nombre al programa.')
    return
  }
  const rows = d.items.filter((i) => i.exercise_id)
  if (!rows.length) {
    formError.value = t('Add at least one exercise.', 'Añade al menos un ejercicio.')
    return
  }
  if (new Set(rows.map((i) => i.exercise_id)).size !== rows.length) {
    formError.value = t('An exercise is in it twice.', 'Hay un ejercicio repetido.')
    return
  }
  const items: ProgramItem[] = []
  for (const i of rows) {
    const n = i.sets.trim() ? Number(i.sets) : null
    if (n !== null && (!Number.isInteger(n) || n < 1)) {
      formError.value = t('Sets must be a whole number.', 'Las series deben ser un número entero.')
      return
    }
    items.push({ exercise_id: i.exercise_id, sets: n, reps: i.reps.trim() || null, frequency: i.frequency.trim() || null, notes: i.notes })
  }
  saving.value = true
  const result = await save({ id: d.id, name: d.name, description: d.description.trim() || null, items })
  saving.value = false
  if ('error' in result) {
    formError.value = result.error
    return
  }
  editing.value = null
  emit('changed')
}

async function confirmDelete() {
  if (!deleting.value) return
  deletingBusy.value = true
  await remove(deleting.value.id)
  deletingBusy.value = false
  deleting.value = null
  emit('changed')
}

function dose(i: ProgramItem) {
  const sr = i.sets && i.reps ? `${i.sets} × ${i.reps}` : i.sets ? t(`${i.sets} sets`, `${i.sets} series`) : i.reps ?? ''
  return [sr, i.frequency].filter(Boolean).join(' · ')
}

defineExpose({ reload: load })

const input = 'h-9 touch:h-11 w-full rounded-ctl border border-line-control bg-surface px-2.5 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const iconBtn = 'flex h-9 w-9 touch:h-11 touch:w-11 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle hover:text-ink-700'
</script>

<template>
  <section aria-labelledby="h-programs" class="overflow-hidden rounded-card border border-line bg-surface" data-cy="programs">
    <div class="flex items-baseline gap-3 px-[18px] pb-3 pt-4">
      <div class="flex-1">
        <h2 id="h-programs" class="text-[16px] font-bold text-ink-900">{{ t(`Programmes · ${programs.length}`, `Programas · ${programs.length}`) }}</h2>
        <p class="mt-1 text-[13px] text-ink-muted">{{ t('A set of exercises with their dose, assigned in one go from the record. Editing one does not change what patients already have.', 'Un conjunto de ejercicios con su dosis, que se asigna de una vez desde la ficha. Editarlo no cambia lo que ya tienen los pacientes.') }}</p>
      </div>
      <UiBtn v-if="!editing" data-cy="program-new" :disabled="!exercises.length" @click="openNew">{{ t('New programme', 'Nuevo programa') }}</UiBtn>
    </div>

    <form v-if="editing" class="flex flex-col gap-3 border-t border-line-row bg-surface-subtle px-[18px] py-4" data-cy="program-form" @submit.prevent="submit">
      <label class="block text-[12.5px] font-medium text-ink-700">
        {{ t('Name', 'Nombre') }}
        <input v-model="editing.name" type="text" :class="[input, 'mt-1']" :placeholder="t('e.g. Low back basics', 'p. ej. Lumbalgia básica')" data-cy="program-name" />
      </label>
      <label class="block text-[12.5px] font-medium text-ink-700">
        {{ t('For (optional, only staff see it)', 'Para qué (opcional, solo lo ve el equipo)') }}
        <input v-model="editing.description" type="text" :class="[input, 'mt-1']" data-cy="program-description" />
      </label>
      <div class="space-y-2">
        <p class="text-[12.5px] font-medium text-ink-700">{{ t('Exercises', 'Ejercicios') }}</p>
        <div v-for="(item, idx) in editing.items" :key="idx" class="grid grid-cols-[1fr_auto] gap-2 border-b border-line-row pb-2 sm:border-0 sm:pb-0 sm:grid-cols-[minmax(0,2fr)_4rem_minmax(0,1fr)_minmax(0,1.3fr)_auto]" data-cy="program-item">
          <select v-model="item.exercise_id" :class="input" :aria-label="t('Exercise', 'Ejercicio')" data-cy="program-item-exercise">
            <option value="" disabled>{{ t('Choose…', 'Elige…') }}</option>
            <option v-for="ex in optionsFor(item)" :key="ex.id" :value="ex.id">{{ ex.name }}</option>
          </select>
          <button type="button" :class="[iconBtn, 'sm:order-last']" :aria-label="t('Remove from the programme', 'Quitar del programa')" data-cy="program-item-remove" @click="editing.items.splice(idx, 1)">
            <svg width="15" height="15" viewBox="0 0 14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" /></svg>
          </button>
          <div class="col-span-2 grid grid-cols-3 gap-2 sm:col-span-3 sm:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1.3fr)]">
            <input v-model="item.sets" inputmode="numeric" :class="input" :placeholder="t('Sets', 'Series')" data-cy="program-item-sets" />
            <input v-model="item.reps" :class="input" :placeholder="t('Reps or time', 'Reps o tiempo')" data-cy="program-item-reps" />
            <input v-model="item.frequency" :class="input" :placeholder="t('How often', 'Frecuencia')" data-cy="program-item-frequency" />
          </div>
        </div>
        <button type="button" class="text-[13px] font-medium text-brand-text" data-cy="program-item-add" @click="editing.items.push(blankItem())">{{ t('+ Add exercise', '+ Añadir ejercicio') }}</button>
      </div>
      <p v-if="formError" role="alert" class="text-[12.5px] font-semibold text-danger-text">{{ formError }}</p>
      <div class="flex gap-2">
        <UiBtn type="submit" variant="primary" :disabled="saving" data-cy="program-save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
        <UiBtn type="button" @click="editing = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
      </div>
    </form>

    <template v-if="loading">
      <div v-for="i in 2" :key="i" class="flex items-center gap-4 border-t border-line-row px-[18px] py-4">
        <UiSkeleton class="h-4 w-40 rounded-ctlSm" />
      </div>
    </template>
    <p v-else-if="!programs.length && !editing" class="border-t border-line-row px-[18px] py-6 text-center text-[14px] text-ink-muted">
      {{ exercises.length ? t("No programmes yet. Make one here, or save a patient's exercises as one from their record.", 'Aún no hay programas. Crea uno aquí, o guarda los ejercicios de un paciente como programa desde su ficha.') : t('Add exercises to the library first.', 'Primero añade ejercicios a la biblioteca.') }}
    </p>
    <div v-for="p in programs" :key="p.id" class="flex items-start gap-3 border-t border-line-row py-3 pl-[18px] pr-3" data-cy="program-row">
      <div class="min-w-0 flex-1">
        <p class="flex flex-wrap items-baseline gap-x-2 text-[15px] font-semibold text-ink-900">
          <span data-cy="program-row-name">{{ p.name }}</span>
          <span class="text-[12.5px] font-normal text-ink-muted">{{ p.exercise_program_items.length === 1 ? t('1 exercise', '1 ejercicio') : t(`${p.exercise_program_items.length} exercises`, `${p.exercise_program_items.length} ejercicios`) }}</span>
        </p>
        <p v-if="p.description" class="text-[13px] text-ink-muted">{{ p.description }}</p>
        <ul class="mt-1 space-y-0.5 text-[13px] text-ink-700">
          <li v-for="i in p.exercise_program_items" :key="i.exercise_id">
            {{ i.exercises?.name }}<span v-if="i.exercises?.archived_at" class="text-ink-faint"> ({{ t('archived', 'archivado') }})</span><span v-if="dose(i)" class="text-ink-muted"> · {{ dose(i) }}</span>
          </li>
        </ul>
      </div>
      <button type="button" :class="iconBtn" :aria-label="t(`Edit ${p.name}`, `Editar ${p.name}`)" data-cy="program-edit" @click="openEdit(p)">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
      </button>
      <button type="button" :class="iconBtn" :aria-label="t(`Delete ${p.name}`, `Eliminar ${p.name}`)" data-cy="program-delete" @click="deleting = { id: p.id, name: p.name }">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
      </button>
    </div>

    <UiConfirmDialog
      v-if="deleting"
      tone="danger"
      :title="t(`Delete ${deleting.name}?`, `¿Eliminar ${deleting.name}?`)"
      :confirm-label="deletingBusy ? t('Deleting…', 'Eliminando…') : t('Delete programme', 'Eliminar programa')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="deletingBusy"
      @confirm="confirmDelete"
      @cancel="deleting = null"
    >
      {{ t('Patients who were given it keep their exercises; only the programme goes.', 'Los pacientes a los que se asignó conservan sus ejercicios; solo se elimina el programa.') }}
    </UiConfirmDialog>
  </section>
</template>

<script setup lang="ts">
import { cleanSteps, fromDraftSteps, nextDraftStep, scheduleStepTitle, stepsProblemMessage, toDraftSteps, type DraftScheduleStep } from '../../utils/exerciseSchedule'

// Settings > Exercise Library's schedules ("pautas por visitas"): a
// clinic's plan of which exercises a patient gets at each visit of their
// care -- "from visit 1 these, from visit 6 these, maintenance these". Picked
// on a patient's record, where it is copied and adjusted for them, so
// editing or deleting one here changes nothing a patient already has.
const props = defineProps<{
  accountId: string
  teamMemberId: string | null
  /** The library's current exercises, to pick from. */
  exercises: { id: string; name: string }[]
  /** Every exercise's name, archived ones too, for what a schedule already holds. */
  names: Record<string, string>
}>()

const t = useT()
const { templates, loading, load, save, remove } = useExerciseSchedules({ accountId: () => props.accountId, teamMemberId: () => props.teamMemberId })
const exercisePrograms = useExercisePrograms({ accountId: () => props.accountId })
onMounted(() => Promise.all([load(), exercisePrograms.load()]))

const editing = ref<{ id: string | null; name: string; description: string; steps: DraftScheduleStep[] } | null>(null)
const saving = ref(false)
const formError = ref('')
const deleting = ref<{ id: string; name: string } | null>(null)
const deletingBusy = ref(false)

const nameOf = (id: string) => props.names[id] ?? '?'

function openNew() {
  editing.value = { id: null, name: '', description: '', steps: [nextDraftStep([])] }
  formError.value = ''
}
function openEdit(s: (typeof templates.value)[number]) {
  editing.value = { id: s.id, name: s.name, description: s.description ?? '', steps: toDraftSteps(s.steps) }
  formError.value = ''
}

async function submit() {
  const d = editing.value
  if (!d) return
  formError.value = ''
  if (!d.name.trim()) {
    formError.value = t('Give the schedule a name.', 'Pon un nombre a la pauta.')
    return
  }
  const cleaned = cleanSteps(fromDraftSteps(d.steps))
  if ('problem' in cleaned) {
    formError.value = stepsProblemMessage(cleaned.problem, t)
    return
  }
  saving.value = true
  const result = await save({ id: d.id, name: d.name, description: d.description, steps: cleaned.steps })
  saving.value = false
  if ('error' in result) {
    formError.value = result.error
    return
  }
  editing.value = null
}

async function confirmDelete() {
  if (!deleting.value) return
  deletingBusy.value = true
  await remove(deleting.value.id)
  deletingBusy.value = false
  deleting.value = null
}

defineExpose({ reload: load })

const input = 'h-9 touch:h-11 w-full rounded-ctl border border-line-control bg-surface px-2.5 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const iconBtn = 'flex h-9 w-9 touch:h-11 touch:w-11 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle hover:text-ink-700'
</script>

<template>
  <section aria-labelledby="h-schedules" class="overflow-hidden rounded-card border border-line bg-surface" data-cy="schedules">
    <div class="flex items-baseline gap-3 px-[18px] pb-3 pt-4">
      <div class="flex-1">
        <h2 id="h-schedules" class="text-[16px] font-bold text-ink-900">{{ t(`Schedules by visit · ${templates.length}`, `Pautas por visitas · ${templates.length}`) }}</h2>
        <p class="mt-1 text-[13px] text-ink-muted">{{ t("Which exercises a patient gets at each visit of their care. Chosen on the patient's record, where you can adjust it for them; each step reaches them when they attend that visit.", 'Qué ejercicios recibe el paciente en cada visita de su tratamiento. Se elige en la ficha del paciente, donde puedes ajustarla; cada paso le llega cuando acude a esa visita.') }}</p>
      </div>
      <UiBtn v-if="!editing" data-cy="schedule-new" :disabled="!exercises.length" @click="openNew">{{ t('New schedule', 'Nueva pauta') }}</UiBtn>
    </div>

    <form v-if="editing" class="flex flex-col gap-3 border-t border-line-row bg-surface-subtle px-[18px] py-4" data-cy="schedule-form" @submit.prevent="submit">
      <label class="block text-[12.5px] font-medium text-ink-700">
        {{ t('Name', 'Nombre') }}
        <input v-model="editing.name" type="text" :class="[input, 'mt-1']" :placeholder="t('e.g. Low back pain by visit', 'p. ej. Lumbalgia por fases')" data-cy="schedule-name" />
      </label>
      <label class="block text-[12.5px] font-medium text-ink-700">
        {{ t('For (optional, only staff see it)', 'Para qué (opcional, solo lo ve el equipo)') }}
        <input v-model="editing.description" type="text" :class="[input, 'mt-1']" data-cy="schedule-description" />
      </label>
      <ExercisesScheduleSteps v-model="editing.steps" :exercises="exercises" :names="names" :programs="exercisePrograms.programs.value" />
      <p v-if="formError" role="alert" class="text-[12.5px] font-semibold text-danger-text">{{ formError }}</p>
      <div class="flex gap-2">
        <UiBtn type="submit" variant="primary" :disabled="saving" data-cy="schedule-save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
        <UiBtn type="button" @click="editing = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
      </div>
    </form>

    <template v-if="loading">
      <div v-for="i in 2" :key="i" class="flex items-center gap-4 border-t border-line-row px-[18px] py-4">
        <UiSkeleton class="h-4 w-40 rounded-ctlSm" />
      </div>
    </template>
    <p v-else-if="!templates.length && !editing" class="border-t border-line-row px-[18px] py-6 text-center text-[14px] text-ink-muted">
      {{ exercises.length ? t('No schedules yet.', 'Aún no hay pautas.') : t('Add exercises to the library first.', 'Primero añade ejercicios a la biblioteca.') }}
    </p>
    <div v-for="s in templates" :key="s.id" class="flex items-start gap-3 border-t border-line-row py-3 pl-[18px] pr-3" data-cy="schedule-row">
      <div class="min-w-0 flex-1">
        <p class="flex flex-wrap items-baseline gap-x-2 text-[15px] font-semibold text-ink-900">
          <span data-cy="schedule-row-name">{{ s.name }}</span>
          <span class="text-[12.5px] font-normal text-ink-muted">{{ s.steps.length === 1 ? t('1 step', '1 paso') : t(`${s.steps.length} steps`, `${s.steps.length} pasos`) }}</span>
        </p>
        <p v-if="s.description" class="text-[13px] text-ink-muted">{{ s.description }}</p>
        <ul class="mt-1 space-y-0.5 text-[13px] text-ink-700">
          <li v-for="step in s.steps" :key="step.id">
            <span class="font-medium">{{ scheduleStepTitle(step, t) }}</span><span v-if="step.keep_previous" class="text-ink-muted"> ({{ t('adds', 'añade') }})</span><span class="text-ink-muted">: {{ step.items.map((i) => nameOf(i.exercise_id)).join(' · ') }}</span>
          </li>
        </ul>
      </div>
      <button type="button" :class="iconBtn" :aria-label="t(`Edit ${s.name}`, `Editar ${s.name}`)" data-cy="schedule-edit" @click="openEdit(s)">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
      </button>
      <button type="button" :class="iconBtn" :aria-label="t(`Delete ${s.name}`, `Eliminar ${s.name}`)" data-cy="schedule-delete" @click="deleting = { id: s.id, name: s.name }">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
      </button>
    </div>

    <UiConfirmDialog
      v-if="deleting"
      tone="danger"
      :title="t(`Delete ${deleting.name}?`, `¿Eliminar ${deleting.name}?`)"
      :confirm-label="deletingBusy ? t('Deleting…', 'Eliminando…') : t('Delete schedule', 'Eliminar pauta')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="deletingBusy"
      @confirm="confirmDelete"
      @cancel="deleting = null"
    >
      {{ t('Patients who were given it keep their own copy; only the template goes.', 'Los pacientes que la tienen conservan su copia; solo se elimina la plantilla.') }}
    </UiConfirmDialog>
  </section>
</template>

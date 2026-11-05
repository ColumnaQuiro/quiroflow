<script setup lang="ts">
import { blankScheduleItem, nextDraftStep, MAX_SCHEDULE_STEPS, MAX_STEP_ITEMS, type DraftScheduleStep } from '../../utils/exerciseSchedule'
import type { ExerciseProgram } from '../../composables/useExercisePrograms'

// The steps of an exercise schedule, as an editor: each one "from visit N",
// with an optional name ("Semana 2", "Mantenimiento"), its exercises and
// their dose, and whether it adds to the exercises before it or replaces
// them. Used for a clinic's template (ExercisesSchedules) and for one
// patient's copy (ExercisesPatientSchedule), where a step already given is
// shown but no longer edited: changing it would change nothing they have.
const steps = defineModel<DraftScheduleStep[]>({ required: true })
const props = defineProps<{
  /** What can be picked: the library's current exercises. */
  exercises: { id: string; name: string }[]
  /** Names of anything a step holds that is not offered any more. */
  names?: Record<string, string>
  programs?: ExerciseProgram[]
}>()

const t = useT()

function optionsFor(id: string) {
  if (!id || props.exercises.some((e) => e.id === id)) return props.exercises
  return [...props.exercises, { id, name: `${props.names?.[id] ?? '?'} (${t('no longer in the library', 'ya no está en la biblioteca')})` }]
}
const nameOf = (id: string) => props.exercises.find((e) => e.id === id)?.name ?? props.names?.[id] ?? '?'

function addStep() {
  steps.value.push(nextDraftStep(steps.value))
}

/** A programme's exercises and doses added to a step (any it already has are left). */
function copyProgram(step: DraftScheduleStep, programId: string) {
  const p = props.programs?.find((x) => x.id === programId)
  if (!p) return
  step.items = step.items.filter((i) => i.exercise_id)
  for (const i of p.exercise_program_items) {
    if (step.items.some((x) => x.exercise_id === i.exercise_id) || step.items.length >= MAX_STEP_ITEMS) continue
    step.items.push({ exercise_id: i.exercise_id, sets: i.sets ? String(i.sets) : '', reps: i.reps ?? '', frequency: i.frequency ?? '', notes: i.notes ?? '', progressive: !!i.progressive })
  }
  if (!step.items.length) step.items.push(blankScheduleItem())
}

const fieldId = useId()
const input = 'h-9 touch:h-11 w-full rounded-ctl border border-line-control bg-surface px-2.5 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const iconBtn = 'flex h-9 w-9 touch:h-11 touch:w-11 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle hover:text-ink-700'
</script>

<template>
  <div class="space-y-3" data-cy="schedule-steps">
    <div v-for="(step, sIdx) in steps" :key="step.id" class="rounded-ctl border border-line-row bg-surface p-3" data-cy="schedule-step">
      <template v-if="step.applied_at">
        <div class="flex items-start justify-between gap-2">
          <p class="text-[13px] font-semibold text-ink-900">
            {{ t(`From visit ${step.from_visit}`, `Desde la visita ${step.from_visit}`) }}<span v-if="step.label" class="font-normal text-ink-muted"> · {{ step.label }}</span>
          </p>
          <span class="shrink-0 rounded-full bg-success-bg px-2 py-0.5 text-[11.5px] font-medium text-success-text">{{ t('Given', 'Ya dado') }}</span>
        </div>
        <p class="mt-0.5 text-[12.5px] text-ink-muted">{{ step.items.map((i) => nameOf(i.exercise_id)).join(' · ') }}</p>
      </template>

      <template v-else>
        <div class="flex flex-wrap items-end gap-2">
          <label :for="`${fieldId}-v-${sIdx}`" class="w-24 shrink-0 text-[12.5px] font-medium text-ink-700">
            {{ t('From visit', 'Desde la visita') }}
            <input :id="`${fieldId}-v-${sIdx}`" v-model="step.from_visit" inputmode="numeric" :class="[input, 'mt-1']" data-cy="schedule-step-visit" />
          </label>
          <label :for="`${fieldId}-l-${sIdx}`" class="min-w-[10rem] flex-1 text-[12.5px] font-medium text-ink-700">
            {{ t('Name (optional)', 'Nombre (opcional)') }}
            <input :id="`${fieldId}-l-${sIdx}`" v-model="step.label" maxlength="40" :class="[input, 'mt-1']" :placeholder="t('e.g. Week 2, Maintenance', 'p. ej. Semana 2, Mantenimiento')" data-cy="schedule-step-label" />
          </label>
          <button type="button" :class="iconBtn" :aria-label="t('Remove this step', 'Quitar este paso')" data-cy="schedule-step-remove" @click="steps.splice(sIdx, 1)">
            <svg width="15" height="15" viewBox="0 0 14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" /></svg>
          </button>
        </div>
        <label v-if="sIdx > 0" class="mt-2 flex items-center gap-2 text-[12.5px] text-ink-700">
          <input v-model="step.keep_previous" type="checkbox" class="rounded border-line-control text-brand-text focus:ring-brand" data-cy="schedule-step-keep" />
          {{ t('Keep the exercises from before and add these (otherwise these replace them)', 'Mantener los ejercicios anteriores y añadir estos (si no, estos los sustituyen)') }}
        </label>

        <div class="mt-2 space-y-2">
          <div v-for="(item, iIdx) in step.items" :key="iIdx" class="grid grid-cols-[1fr_auto] gap-2 border-b border-line-row pb-2 last:border-0 sm:grid-cols-[minmax(0,2fr)_4rem_minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:border-0 sm:pb-0" data-cy="schedule-item">
            <select v-model="item.exercise_id" :class="input" :aria-label="t('Exercise', 'Ejercicio')" data-cy="schedule-item-exercise">
              <option value="" disabled>{{ t('Choose…', 'Elige…') }}</option>
              <option v-for="ex in optionsFor(item.exercise_id)" :key="ex.id" :value="ex.id">{{ ex.name }}</option>
            </select>
            <button type="button" :class="[iconBtn, 'sm:order-last']" :aria-label="t('Remove from the step', 'Quitar del paso')" @click="step.items.splice(iIdx, 1)">
              <svg width="15" height="15" viewBox="0 0 14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" /></svg>
            </button>
            <div class="col-span-2 grid grid-cols-3 gap-2 sm:col-span-3 sm:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1.3fr)]">
              <template v-if="!item.progressive">
                <input v-model="item.sets" inputmode="numeric" :class="input" :placeholder="t('Sets', 'Series')" :aria-label="t('Sets', 'Series')" />
                <input v-model="item.reps" :class="input" :placeholder="t('Reps or time', 'Reps o tiempo')" :aria-label="t('Reps or time', 'Reps o tiempo')" />
              </template>
              <span v-else class="col-span-2 flex items-center text-[13px] text-ink-muted">{{ t('Progressive: no fixed number', 'Progresivo: sin número fijo') }}</span>
              <input v-model="item.frequency" :class="input" :placeholder="t('How often', 'Frecuencia')" :aria-label="t('How often', 'Frecuencia')" />
              <label class="col-span-full flex items-center gap-2 text-[12.5px] text-ink-700">
                <input v-model="item.progressive" type="checkbox" class="rounded border-line-control text-brand-text focus:ring-brand" />
                {{ t('Progressive: they build up as they can', 'Progresivo: va aumentando según pueda') }}
              </label>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
            <button v-if="step.items.length < MAX_STEP_ITEMS" type="button" class="text-[13px] font-medium text-brand-text" data-cy="schedule-item-add" @click="step.items.push(blankScheduleItem())">{{ t('+ Add exercise', '+ Añadir ejercicio') }}</button>
            <select v-if="programs?.length" class="h-8 rounded-ctl border border-line-control bg-surface px-2 text-[12.5px] text-ink-700" :aria-label="t('Add a programme to this step', 'Añadir un programa a este paso')" data-cy="schedule-step-program" @change="copyProgram(step, ($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''">
              <option value="">{{ t('+ Add a programme…', '+ Añadir un programa…') }}</option>
              <option v-for="p in programs" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
        </div>
      </template>
    </div>

    <button v-if="steps.length < MAX_SCHEDULE_STEPS" type="button" class="text-[13px] font-semibold text-brand-text" data-cy="schedule-step-add" @click="addStep">{{ t('+ Add step', '+ Añadir paso') }}</button>
  </div>
</template>

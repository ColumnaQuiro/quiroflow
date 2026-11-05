<script setup lang="ts">
import { cleanSteps, copySteps, fromDraftSteps, nextDraftStep, scheduleProgress, scheduleStepTitle, sortSteps, stepsProblemMessage, toDraftSteps, type DraftScheduleStep, type ScheduleStep } from '../../utils/exerciseSchedule'
import type { ExerciseProgram } from '../../composables/useExercisePrograms'

// A patient's exercises by visit, under "Ejercicios en casa" on their record
// (web and staff app): a clinic schedule copied for them and adjusted, whose
// steps each reach the patient when they attend that visit -- given by the
// database when it is saved and by the same-day cron after that (the
// exercise_schedules migration). Visits count from a date, which starts as
// the beginning of their current care plan, so editing the plan later does
// not restart the count.
const props = defineProps<{
  accountId: string
  patientId: string
  teamMemberId: string | null
  /** The library's current exercises, to pick from. */
  library: { id: string; name: string }[]
  programs: ExerciseProgram[]
}>()
const emit = defineEmits<{ changed: [] }>()

const t = useT()
const supabase = useSupabaseClient()
const authedFetch = useAuthedFetch()
const { schedule, attended, loading, load, save, end } = usePatientExerciseSchedule({ accountId: () => props.accountId, patientId: () => props.patientId })
const { templates, load: loadTemplates } = useExerciseSchedules({ accountId: () => props.accountId, teamMemberId: () => props.teamMemberId })

// Names for every exercise a step holds, archived ones too.
const names = ref<Record<string, string>>({})
async function loadNames(steps: ScheduleStep[]) {
  const ids = [...new Set(steps.flatMap((s) => s.items.map((i) => i.exercise_id)))].filter((id) => !(id in names.value) && !props.library.some((e) => e.id === id))
  for (const e of props.library) names.value[e.id] = e.name
  if (!ids.length) return
  const { data } = await supabase.from('exercises').select('id, name').in('id', ids)
  for (const e of (data as { id: string; name: string }[] | null) ?? []) names.value[e.id] = e.name
}
watch(schedule, (s) => s && loadNames(s.steps), { immediate: true })
const nameOf = (id: string) => names.value[id] ?? props.library.find((e) => e.id === id)?.name ?? '…'

const progress = computed(() => (schedule.value ? scheduleProgress(schedule.value.steps, attended.value) : null))
const steps = computed(() => (schedule.value ? sortSteps(schedule.value.steps) : []))

// --- setting one up or editing it ----------------------------------------

const editing = ref<{ id: string | null; scheduleId: string | null; name: string; countsFrom: string; steps: DraftScheduleStep[] } | null>(null)
const templateId = ref('')
const saving = ref(false)
const formError = ref('')
const notice = ref('')
const confirmEnd = ref(false)

/** The start of their current care plan, or today: where visits are counted from. */
async function planStart(): Promise<string> {
  const { data } = await supabase.from('care_plans').select('started_at').eq('patient_id', props.patientId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return (data as { started_at: string } | null)?.started_at ?? new Date().toISOString().slice(0, 10)
}

async function openNew() {
  formError.value = notice.value = ''
  templateId.value = ''
  loadTemplates()
  editing.value = { id: null, scheduleId: null, name: '', countsFrom: await planStart(), steps: [nextDraftStep([])] }
}
function openEdit() {
  const s = schedule.value
  if (!s) return
  formError.value = notice.value = ''
  editing.value = { id: s.id, scheduleId: s.schedule_id, name: s.name, countsFrom: s.counts_from, steps: toDraftSteps(s.steps) }
}
watch(templateId, (id) => pickTemplate(id))
function pickTemplate(id: string) {
  const tpl = templates.value.find((x) => x.id === id)
  if (!editing.value || editing.value.id) return
  if (!tpl) {
    // Back to "Blank".
    editing.value.scheduleId = null
    editing.value.steps = [nextDraftStep([])]
    return
  }
  editing.value.scheduleId = tpl.id
  editing.value.name = tpl.name
  editing.value.steps = toDraftSteps(copySteps(tpl.steps))
  loadNames(tpl.steps)
}

async function submit() {
  const d = editing.value
  if (!d) return
  formError.value = ''
  if (!d.name.trim()) {
    formError.value = t('Give it a name.', 'Ponle un nombre.')
    return
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.countsFrom)) {
    formError.value = t('Choose the date to count visits from.', 'Elige desde qué fecha se cuentan las visitas.')
    return
  }
  const cleaned = cleanSteps(fromDraftSteps(d.steps))
  if ('problem' in cleaned) {
    formError.value = stepsProblemMessage(cleaned.problem, t)
    return
  }
  saving.value = true
  const result = await save({ id: d.id, scheduleId: d.scheduleId, name: d.name, countsFrom: d.countsFrom, steps: cleaned.steps })
  saving.value = false
  if ('error' in result) {
    formError.value = t("Couldn't save it. Try again.", 'No se ha podido guardar. Inténtalo de nuevo.')
    return
  }
  editing.value = null
  if (result.added.length) {
    // One push for what this gave now ("Nuevos ejercicios para casa"); never holds this up.
    authedFetch('/api/exercises/notify-assigned', { method: 'POST', body: { patientExerciseIds: result.added } }).catch(() => {})
    notice.value = result.added.length === 1 ? t('1 exercise given now: they have reached its visit.', '1 ejercicio asignado ya: ha llegado a su visita.') : t(`${result.added.length} exercises given now: they have reached their visit.`, `${result.added.length} ejercicios asignados ya: ha llegado a su visita.`)
  }
  emit('changed')
}

async function stop() {
  confirmEnd.value = false
  if (await end()) emit('changed')
}

const fieldId = useId()
const input = 'h-9 touch:h-11 w-full rounded-ctl border border-line-control bg-surface px-2.5 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const formatDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short' })
</script>

<template>
  <div class="mt-3 border-t border-line-row pt-3" data-cy="patient-schedule">
    <template v-if="!loading && !editing">
      <div v-if="!schedule" class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-[12.5px] text-ink-muted">{{ t('Plan which exercises they get at each visit of their care.', 'Planifica qué ejercicios recibe en cada visita de su tratamiento.') }}</p>
        <UiBtn size="sm" data-cy="patient-schedule-new" @click="openNew">{{ t('Schedule by visit', 'Programar por visitas') }}</UiBtn>
      </div>

      <template v-else>
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="text-[13px] font-semibold text-ink-700">
              {{ t('By visit', 'Por visitas') }}: <span class="text-ink-900" data-cy="patient-schedule-name">{{ schedule.name }}</span>
            </p>
            <p class="text-[12.5px] text-ink-muted" data-cy="patient-schedule-visits">
              <template v-if="attended !== null">{{ attended === 1 ? t(`1 visit since ${formatDay(schedule.counts_from)}`, `1 visita desde el ${formatDay(schedule.counts_from)}`) : t(`${attended} visits since ${formatDay(schedule.counts_from)}`, `${attended} visitas desde el ${formatDay(schedule.counts_from)}`) }}</template>
              <template v-if="progress?.next">
                ·
                <template v-if="progress.visitsToNext === 0">{{ t('next step is being given', 'el siguiente paso se está asignando') }}</template>
                <template v-else-if="progress.visitsToNext !== null">{{ t(`next step at visit ${progress.next.from_visit}`, `siguiente paso en la visita ${progress.next.from_visit}`) }}</template>
              </template>
              <template v-else> · {{ t('every step given', 'todos los pasos asignados') }}</template>
            </p>
          </div>
          <div class="flex shrink-0 gap-3">
            <button type="button" class="text-[12px] font-medium text-brand-text" data-cy="patient-schedule-edit" @click="openEdit">{{ t('Edit', 'Editar') }}</button>
            <button type="button" class="text-[12px] font-medium text-ink-muted hover:text-ink-700" data-cy="patient-schedule-end" @click="confirmEnd = true">{{ t('Stop', 'Detener') }}</button>
          </div>
        </div>
        <ol class="mt-2 space-y-1">
          <li v-for="s in steps" :key="s.id" class="flex gap-2 text-[12.5px]" data-cy="patient-schedule-step">
            <span class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold" :class="s.applied_at ? 'bg-success-accent text-success-on' : s.id === progress?.next?.id ? 'border border-brand text-brand-text' : 'border border-line-control'" aria-hidden="true">{{ s.applied_at ? '✓' : '' }}</span>
            <span class="min-w-0">
              <span class="font-medium" :class="s.applied_at ? 'text-ink-muted' : 'text-ink-900'">{{ scheduleStepTitle(s, t) }}</span>
              <span v-if="s.applied_at" class="sr-only">{{ t('(given)', '(asignado)') }}</span>
              <span class="text-ink-muted">: {{ s.keep_previous ? t('adds ', 'añade ') : '' }}{{ s.items.map((i) => nameOf(i.exercise_id)).join(' · ') }}</span>
            </span>
          </li>
        </ol>
      </template>
      <p v-if="notice" class="mt-1.5 text-[12.5px] text-success-text" data-cy="patient-schedule-notice">{{ notice }}</p>
    </template>

    <form v-if="editing" class="space-y-3" data-cy="patient-schedule-form" @submit.prevent="submit">
      <p class="text-[13px] font-semibold text-ink-700">{{ editing.id ? t('Edit the schedule', 'Editar la pauta') : t('Schedule by visit', 'Programar por visitas') }}</p>
      <label v-if="!editing.id && templates.length" class="block text-[12.5px] font-medium text-ink-700">
        {{ t('Start from', 'Partir de') }}
        <select v-model="templateId" :class="[input, 'mt-1']" data-cy="patient-schedule-template">
          <option value="">{{ t('Blank', 'En blanco') }}</option>
          <option v-for="tpl in templates" :key="tpl.id" :value="tpl.id">{{ tpl.name }}</option>
        </select>
      </label>
      <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <label :for="`${fieldId}-name`" class="block text-[12.5px] font-medium text-ink-700">
          {{ t('Name', 'Nombre') }}
          <input :id="`${fieldId}-name`" v-model="editing.name" :class="[input, 'mt-1']" :placeholder="t('e.g. Low back pain by visit', 'p. ej. Lumbalgia por fases')" data-cy="patient-schedule-name-input" />
        </label>
        <label :for="`${fieldId}-from`" class="block text-[12.5px] font-medium text-ink-700">
          {{ t('Count visits from', 'Contar visitas desde') }}
          <input :id="`${fieldId}-from`" v-model="editing.countsFrom" type="date" :class="[input, 'mt-1']" data-cy="patient-schedule-from" />
        </label>
      </div>
      <p class="text-[12px] text-ink-muted">{{ t('Visits they attend (completed or checked in) from that day count. A step reaches them once they attend its visit; one already reached is given when you save.', 'Cuentan las visitas a las que acude (completadas o con llegada registrada) desde ese día. Cada paso le llega cuando acude a su visita; si ya la ha pasado, se asigna al guardar.') }}</p>
      <ExercisesScheduleSteps v-model="editing.steps" :exercises="library" :names="names" :programs="programs" />
      <p v-if="formError" role="alert" class="text-[12.5px] text-danger-text">{{ formError }}</p>
      <div class="flex gap-2">
        <UiBtn type="submit" variant="primary" :disabled="saving" data-cy="patient-schedule-save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
        <UiBtn type="button" variant="secondary" @click="editing = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
      </div>
    </form>

    <UiConfirmDialog
      v-if="confirmEnd"
      :title="t('Stop this schedule?', '¿Detener esta pauta?')"
      :confirm-label="t('Stop schedule', 'Detener pauta')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="stop"
      @cancel="confirmEnd = false"
    >
      {{ t('No more steps will be given. The exercises it has already given stay; remove any you no longer want from the list.', 'No se asignarán más pasos. Los ejercicios que ya ha asignado se quedan; quita de la lista los que ya no quieras.') }}
    </UiConfirmDialog>
  </div>
</template>

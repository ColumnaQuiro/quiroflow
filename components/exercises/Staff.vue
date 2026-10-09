<script setup lang="ts">
import { exerciseWeek } from '../../utils/exerciseWeek'

// "Ejercicios en casa" on a patient's record, in the web app and the staff
// app: what they have been given, how this week has gone (their ticks), and
// assigning another -- from the clinic's library or new, which saves it to
// the library for next time.
const props = defineProps<{ accountId: string; patientId: string; teamMemberId: string | null }>()

const t = useT()
const { assigned, library, loading, loadError, saving, error, load, assign, end } = useStaffExercises({
  accountId: () => props.accountId,
  patientId: () => props.patientId,
  teamMemberId: () => props.teamMemberId,
})

const open = ref(false)
const pick = ref<string>('')
const name = ref('')
const instructions = ref('')
const mediaUrl = ref('')
const sets = ref('')
const reps = ref('')
const frequency = ref('')
const notes = ref('')
const isNew = computed(() => pick.value === '__new' || library.value.length === 0)
const formError = ref('')

function reset() {
  open.value = false
  pick.value = ''
  name.value = instructions.value = mediaUrl.value = sets.value = reps.value = frequency.value = notes.value = ''
  formError.value = ''
}

async function save() {
  formError.value = ''
  if (isNew.value && !name.value.trim()) {
    formError.value = t('Give the exercise a name.', 'Pon un nombre al ejercicio.')
    return
  }
  if (!isNew.value && !pick.value) {
    formError.value = t('Choose an exercise.', 'Elige un ejercicio.')
    return
  }
  const link = mediaUrl.value.trim()
  if (link && !/^https?:\/\//i.test(link)) {
    formError.value = t('The link must start with https://', 'El enlace debe empezar por https://')
    return
  }
  const n = sets.value.trim() ? Number(sets.value) : null
  if (n !== null && (!Number.isInteger(n) || n < 1)) {
    formError.value = t('Sets must be a whole number.', 'Las series deben ser un número entero.')
    return
  }
  const ok = await assign({
    exerciseId: isNew.value ? null : pick.value,
    newExercise: isNew.value ? { name: name.value, instructions: instructions.value.trim() || null, media_url: link || null } : undefined,
    sets: n,
    reps: reps.value.trim() || null,
    frequency: frequency.value.trim() || null,
    notes: notes.value.trim() || null,
  })
  if (ok) reset()
}

function dose(pe: { sets: number | null; reps: string | null; frequency: string | null }) {
  const sr = pe.sets && pe.reps ? `${pe.sets} × ${pe.reps}` : pe.sets ? t(`${pe.sets} sets`, `${pe.sets} series`) : pe.reps ?? ''
  return [sr, pe.frequency].filter(Boolean).join(' · ')
}

const input = 'h-10 w-full rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
</script>

<template>
  <section class="rounded-card border border-line bg-surface px-3.5 py-3 shadow-card" data-cy="staff-exercises">
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-[11px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('Home exercises', 'Ejercicios en casa') }}</h2>
      <button v-if="!open" type="button" class="text-[12.5px] font-medium text-brand-text" data-cy="exercises-assign-open" @click="open = true">{{ t('+ Assign', '+ Asignar') }}</button>
    </div>

    <div v-if="loading" class="mt-2"><UiSkeleton class="h-4 w-40 rounded-ctlSm" /></div>
    <p v-else-if="loadError" class="mt-2 text-[12.5px] text-danger-text">
      {{ t("Couldn't load them.", 'No se han podido cargar.') }}
      <button type="button" class="ml-1 font-semibold text-brand-text" @click="load">{{ t('Try again', 'Reintentar') }}</button>
    </p>
    <ul v-else-if="assigned.length" class="mt-1.5 divide-y divide-line-row">
      <li v-for="pe in assigned" :key="pe.id" class="flex items-start gap-3 py-2.5" data-cy="exercise-row">
        <div class="min-w-0 flex-1">
          <p class="text-[14px] font-medium text-ink-900">{{ pe.exercises?.name }}</p>
          <p v-if="dose(pe)" class="text-[12.5px] text-ink-muted">{{ dose(pe) }}</p>
          <div class="mt-1.5 flex gap-1" :aria-label="t('Last seven days', 'Últimos siete días')">
            <span v-for="d in exerciseWeek(pe.patient_exercise_logs.map((l) => l.done_on))" :key="d.date" class="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold" :class="d.done ? 'bg-success-accent text-white' : 'bg-chip-bg text-ink-faint'" :title="d.date">{{ d.initial }}</span>
          </div>
        </div>
        <button type="button" class="shrink-0 text-[12px] font-medium text-ink-muted" :data-cy="`exercise-end-${pe.id}`" @click="end(pe.id)">{{ t('Remove', 'Quitar') }}</button>
      </li>
    </ul>
    <p v-else-if="!open" class="mt-1.5 text-[13px] text-ink-faint">{{ t('None assigned yet.', 'Aún no tiene ninguno.') }}</p>

    <form v-if="open" class="mt-3 space-y-2.5 border-t border-line-row pt-3" data-cy="exercises-assign-form" @submit.prevent="save">
      <label v-if="library.length" class="block text-[12.5px] font-medium text-ink-700">
        {{ t('Exercise', 'Ejercicio') }}
        <select v-model="pick" :class="[input, 'mt-1']" data-cy="exercise-pick">
          <option value="" disabled>{{ t('Choose from your library…', 'Elige de tu biblioteca…') }}</option>
          <option v-for="ex in library" :key="ex.id" :value="ex.id">{{ ex.name }}</option>
          <option value="__new">{{ t('+ New exercise', '+ Ejercicio nuevo') }}</option>
        </select>
      </label>
      <template v-if="isNew">
        <input v-model="name" :class="input" :placeholder="t('Name, e.g. Cat-camel', 'Nombre, p. ej. Gato-camello')" data-cy="exercise-name" />
        <textarea v-model="instructions" rows="2" :class="[input, 'h-auto py-2']" :placeholder="t('How to do it (optional)', 'Cómo hacerlo (opcional)')" />
        <input v-model="mediaUrl" type="url" inputmode="url" :class="input" :placeholder="t('Video or image link (optional)', 'Enlace a vídeo o imagen (opcional)')" data-cy="exercise-link" />
      </template>
      <div class="grid grid-cols-3 gap-2">
        <input v-model="sets" inputmode="numeric" :class="input" :placeholder="t('Sets', 'Series')" data-cy="exercise-sets" />
        <input v-model="reps" :class="input" :placeholder="t('Reps or time', 'Reps o tiempo')" data-cy="exercise-reps" />
        <input v-model="frequency" :class="input" :placeholder="t('How often', 'Frecuencia')" data-cy="exercise-frequency" />
      </div>
      <input v-model="notes" :class="input" :placeholder="t('Note for the patient (optional)', 'Nota para el paciente (opcional)')" />
      <p v-if="formError || error" role="alert" class="text-[12.5px] text-danger-text">{{ formError || error }}</p>
      <div class="flex gap-2">
        <UiBtn type="submit" variant="primary" :disabled="saving" data-cy="exercise-save">{{ saving ? t('Saving…', 'Guardando…') : t('Assign', 'Asignar') }}</UiBtn>
        <UiBtn type="button" variant="secondary" @click="reset">{{ t('Cancel', 'Cancelar') }}</UiBtn>
      </div>
    </form>
  </section>
</template>

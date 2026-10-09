<script setup lang="ts">
import { exerciseWeek } from '../../utils/exerciseWeek'

// "Tus ejercicios", in the app and the portal: what the clinic gave this
// patient to do at home, how to do it, the last week at a glance, and "Hecho
// hoy" to tick today off (the practitioner sees the ticks on the record).
const props = defineProps<{ patientId: string }>()

const t = useT()
const { items, loading, loadError, busyId, error, load, doneToday, toggleToday } = usePatientExercises(() => props.patientId)
const openId = ref<string | null>(null)

function dose(pe: { sets: number | null; reps: string | null; frequency: string | null }) {
  const sr = pe.sets && pe.reps ? `${pe.sets} × ${pe.reps}` : pe.sets ? t(`${pe.sets} sets`, `${pe.sets} series`) : pe.reps ?? ''
  return [sr, pe.frequency].filter(Boolean).join(' · ')
}
function openMedia(url: string) {
  openWhenReady(async () => url)
}
</script>

<template>
  <div data-cy="patient-exercises">
    <div v-if="loading" class="space-y-3"><UiSkeleton class="h-24 w-full rounded-card" /></div>
    <PatientLoadError v-else-if="loadError" @retry="load" />
    <PatientEmpty v-else-if="!items.length" :text="t('Your clinic has not given you any exercises yet.', 'Tu clínica aún no te ha dado ejercicios.')" />
    <div v-else class="space-y-3">
      <article v-for="pe in items" :key="pe.id" class="rounded-card border border-line bg-surface p-4 shadow-card" data-cy="patient-exercise">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-[15px] font-semibold text-ink-900">{{ pe.exercises?.name }}</p>
            <p v-if="dose(pe)" class="mt-0.5 text-[13px] text-ink-muted">{{ dose(pe) }}</p>
          </div>
          <button
            type="button"
            class="min-h-9 shrink-0 rounded-ctl px-3 text-[12.5px] font-semibold"
            :class="doneToday(pe) ? 'bg-success-bg text-success-text' : 'bg-brand text-white'"
            :disabled="busyId === pe.id"
            :aria-pressed="doneToday(pe)"
            data-cy="exercise-done-today"
            @click="toggleToday(pe)"
          >
            {{ doneToday(pe) ? t('✓ Done today', '✓ Hecho hoy') : t('Done today', 'Hecho hoy') }}
          </button>
        </div>
        <p v-if="pe.notes" class="mt-2 rounded-ctl bg-surface-subtle px-3 py-2 text-[12.5px] text-ink-700">{{ pe.notes }}</p>
        <div class="mt-2.5 flex gap-1" :aria-label="t('Last seven days', 'Últimos siete días')">
          <span v-for="d in exerciseWeek(pe.patient_exercise_logs.map((l) => l.done_on))" :key="d.date" class="flex h-6 w-6 items-center justify-center rounded-full text-[10.5px] font-semibold" :class="[d.done ? 'bg-success-accent text-white' : 'bg-chip-bg text-ink-faint', d.isToday ? 'ring-2 ring-brand/40' : '']">{{ d.initial }}</span>
        </div>
        <div v-if="pe.exercises?.instructions || pe.exercises?.media_url" class="mt-2.5 flex flex-wrap items-center gap-3">
          <button v-if="pe.exercises?.instructions" type="button" class="text-[12.5px] font-medium text-brand-text" @click="openId = openId === pe.id ? null : pe.id">
            {{ openId === pe.id ? t('Hide how to do it', 'Ocultar cómo hacerlo') : t('How to do it', 'Cómo hacerlo') }}
          </button>
          <button v-if="pe.exercises?.media_url" type="button" class="text-[12.5px] font-medium text-brand-text" data-cy="exercise-media" @click="openMedia(pe.exercises!.media_url!)">{{ t('Watch the video', 'Ver el vídeo') }}</button>
        </div>
        <p v-if="openId === pe.id && pe.exercises?.instructions" class="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-ink-700">{{ pe.exercises.instructions }}</p>
      </article>
      <p v-if="error" role="alert" class="text-[12.5px] text-danger-text">{{ error }}</p>
    </div>
  </div>
</template>

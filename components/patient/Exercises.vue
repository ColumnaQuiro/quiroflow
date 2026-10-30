<script setup lang="ts">
import { exerciseWeek } from '../../utils/exerciseWeek'
import { exerciseDoseLabel, exerciseProgressiveHint } from '../../utils/exerciseDose'

// "Tus ejercicios", in the app and the portal: what the clinic gave this
// patient to do at home, how to do it, the last week at a glance, and "Hecho
// hoy" to tick today off (the practitioner sees the ticks on the record).
// A video or photo the clinic uploaded plays right here, from a signed URL;
// a link they pasted opens outside the app as before. An exercise copied from
// QuiroFlow's catalogue shows its demonstration as a picture to tap, so it
// is plain that there is a video, unless the clinic uploaded its own. A
// progressive one says how to build up instead of giving numbers.
const props = defineProps<{ patientId: string }>()

const t = useT()
const { items, loading, loadError, busyId, error, load, doneToday, toggleToday } = usePatientExercises(() => props.patientId)
const openId = ref<string | null>(null)

const dose = (pe: Parameters<typeof exerciseDoseLabel>[0]) => exerciseDoseLabel(pe, t)
const catalog = useExerciseCatalog()
function openMedia(url: string) {
  openWhenReady(async () => url)
}

const exerciseMedia = useExerciseMedia()
const playingId = ref<string | null>(null)
const mediaSrc = ref<Record<string, string>>({})
const mediaError = ref<string | null>(null)
async function toggleUpload(pe: { id: string; exercises: { media_path?: string | null } | null }) {
  if (playingId.value === pe.id) {
    playingId.value = null
    return
  }
  mediaError.value = null
  playingId.value = pe.id
  const path = pe.exercises?.media_path
  if (!path || mediaSrc.value[pe.id]) return
  const url = await exerciseMedia.signedUrl(path)
  if (url) mediaSrc.value = { ...mediaSrc.value, [pe.id]: url }
  else mediaError.value = pe.id
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
            <p v-if="dose(pe)" class="mt-0.5 text-[13px] text-ink-muted" data-cy="exercise-dose">{{ dose(pe) }}</p>
          </div>
          <button
            type="button"
            class="min-h-9 shrink-0 rounded-ctl px-3 text-[12.5px] font-semibold"
            :class="doneToday(pe) ? 'bg-success-bg text-success-text' : 'bg-brand text-brand-on'"
            :disabled="busyId === pe.id"
            :aria-pressed="doneToday(pe)"
            data-cy="exercise-done-today"
            @click="toggleToday(pe)"
          >
            {{ doneToday(pe) ? t('✓ Done today', '✓ Hecho hoy') : t('Done today', 'Hecho hoy') }}
          </button>
        </div>
        <p v-if="pe.progressive" class="mt-2 text-[12.5px] leading-relaxed text-ink-700" data-cy="exercise-progressive-hint">{{ exerciseProgressiveHint(t) }}</p>
        <p v-if="pe.notes" class="mt-2 rounded-ctl bg-surface-subtle px-3 py-2 text-[12.5px] text-ink-700">{{ pe.notes }}</p>
        <div class="mt-2.5 flex gap-1" :aria-label="t('Last seven days', 'Últimos siete días')">
          <span v-for="d in exerciseWeek(pe.patient_exercise_logs.map((l) => l.done_on))" :key="d.date" class="flex h-6 w-6 items-center justify-center rounded-full text-[10.5px] font-semibold" :class="[d.done ? 'bg-success-accent text-success-on' : 'bg-chip-bg text-ink-faint', d.isToday ? 'ring-2 ring-brand/40' : '']">{{ d.initial }}</span>
        </div>
        <div v-if="pe.exercises?.instructions || pe.exercises?.media_url || pe.exercises?.media_path" class="mt-2.5 flex flex-wrap items-center gap-3">
          <button v-if="pe.exercises?.instructions" type="button" class="text-[12.5px] font-medium text-brand-text" @click="openId = openId === pe.id ? null : pe.id">
            {{ openId === pe.id ? t('Hide how to do it', 'Ocultar cómo hacerlo') : t('How to do it', 'Cómo hacerlo') }}
          </button>
          <button v-if="pe.exercises?.media_path" type="button" class="text-[12.5px] font-medium text-brand-text" data-cy="exercise-upload-toggle" @click="toggleUpload(pe)">
            {{ playingId === pe.id ? t('Hide', 'Ocultar') : exerciseMediaKind(pe.exercises.media_path) === 'video' ? t('▶ Watch the video', '▶ Ver el vídeo') : t('See the photo', 'Ver la foto') }}
          </button>
          <button v-if="pe.exercises?.media_url" type="button" class="text-[12.5px] font-medium text-brand-text" data-cy="exercise-media" @click="openMedia(pe.exercises!.media_url!)">{{ pe.exercises?.media_path ? t('Open the link', 'Abrir el enlace') : t('Watch the video', 'Ver el vídeo') }}</button>
        </div>
        <div v-if="playingId === pe.id && pe.exercises?.media_path" class="mt-2.5 overflow-hidden rounded-ctl bg-black/5" data-cy="exercise-upload-player">
          <p v-if="mediaError === pe.id" class="px-3 py-2 text-[12.5px] text-danger-text">{{ t("Couldn't load it. Try again.", 'No se ha podido cargar. Inténtalo de nuevo.') }}</p>
          <UiSkeleton v-else-if="!mediaSrc[pe.id]" class="aspect-video w-full" />
          <video v-else-if="exerciseMediaKind(pe.exercises.media_path) === 'video'" :src="mediaSrc[pe.id]" controls playsinline preload="metadata" class="max-h-[60vh] w-full bg-black" />
          <img v-else :src="mediaSrc[pe.id]" :alt="pe.exercises?.name ?? ''" class="max-h-[60vh] w-full object-contain" />
        </div>
        <template v-if="!pe.exercises?.media_path && pe.exercises?.starter_key">
          <div v-if="playingId === pe.id" class="mt-2.5" data-cy="exercise-catalog-player">
            <ExercisesCatalogVideo :slug="pe.exercises.starter_key" :label="pe.exercises.name" autoplay />
          </div>
          <button v-else type="button" class="relative mt-2.5 block w-full overflow-hidden rounded-ctl bg-surface-subtle" :aria-label="t(`Watch how to do ${pe.exercises.name}`, `Ver cómo se hace ${pe.exercises.name}`)" data-cy="exercise-catalog-toggle" @click="playingId = pe.id">
            <img :src="catalog.media(pe.exercises.starter_key).poster" alt="" loading="lazy" class="aspect-video w-full object-contain" />
            <span class="absolute inset-0 flex items-center justify-center">
              <span class="flex h-12 w-12 items-center justify-center rounded-full bg-brand/90 text-white shadow-card">
                <svg viewBox="0 0 16 16" aria-hidden="true" class="ml-0.5 h-5 w-5 fill-current"><path d="M4 2.5v11l9-5.5z" /></svg>
              </span>
            </span>
          </button>
        </template>
        <p v-if="openId === pe.id && pe.exercises?.instructions" class="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-ink-700">{{ pe.exercises.instructions }}</p>
      </article>
      <p v-if="error" role="alert" class="text-[12.5px] text-danger-text">{{ error }}</p>
    </div>
  </div>
</template>

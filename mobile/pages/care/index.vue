<script setup lang="ts">
import { dayState, isoWeekday, thisWeek } from '../../../utils/careStreak'
import { habitLabel, remindersOn } from '../../../utils/habits'

// "Cuidarme", the patient's tab for looking after themselves at home: the
// streak, what is for today (home exercises with "Hecho hoy", and their own
// habits), what their practitioner sent them, and the clinic's "Hábitos y
// consejos". Ticking the last thing of the day says so, once
// (CareDayComplete).
definePageMeta({ layout: 'patient' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const t = useT()
const { patient } = useIdentity()
const patientId = computed(() => patient.value?.id ?? '')

const { streak, today, active, load: reloadProgress } = useCareProgress(() => patientId.value)
const { items: exercises, doneToday: exerciseDone, toggleToday, busyId } = usePatientExercises(() => patientId.value)
const { habits, doneToday: habitDone, tick } = useHabits(() => patientId.value)

const WEEK_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const week = computed(() => thisWeek(today.value).map((d, i) => ({ day: d, letter: WEEK_LETTERS[i]!, state: dayState(d, today.value, active.value, streak.value.free) })))
const freeThisWeek = computed(() => week.value.find((d) => d.state === 'free'))
const dayNames = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

const todaysHabits = computed(() => habits.value.filter((h) => remindersOn(h, isoWeekday(today.value)) > 0))

// The day is complete when every exercise and every habit reminder due today
// is ticked -- and there was something to do at all.
const dayComplete = computed(() => {
  const ex = exercises.value
  const hb = todaysHabits.value
  if (!ex.length && !hb.length) return false
  return ex.every((e) => exerciseDone(e)) && hb.every((h) => habitDone(h) >= remindersOn(h, isoWeekday(today.value)))
})
const celebrate = ref(false)
const celebratedKey = () => `quiroflow.dayComplete.${patientId.value}`
function maybeCelebrate() {
  if (!dayComplete.value) return
  try {
    if (localStorage.getItem(celebratedKey()) === today.value) return
    localStorage.setItem(celebratedKey(), today.value)
  } catch {
    // No storage: celebrating twice is the lesser harm.
  }
  celebrate.value = true
}

async function toggleExercise(e: (typeof exercises.value)[number]) {
  await toggleToday(e)
  await reloadProgress()
  maybeCelebrate()
}
const tickingId = ref<string | null>(null)
async function tickHabit(h: (typeof habits.value)[number]) {
  tickingId.value = h.id
  await tick(h)
  tickingId.value = null
  await reloadProgress()
  maybeCelebrate()
}
</script>

<template>
  <PatientScreen :title="t('Self-care', 'Cuidarme')">
    <div v-if="patientId" class="flex flex-col gap-3" data-cy="care">
      <NuxtLink to="/care/progress" class="block rounded-card border border-line bg-surface p-4 shadow-card" data-cy="care-streak">
        <div class="flex items-center gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-ctl bg-brand-tint text-brand-text" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.7 2.2-4.8.2 1.6 1 2.8 2.3 3.3C11 8 11.3 4.8 12 2z" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-[17px] font-bold text-ink-900" data-cy="care-streak-days">{{ streak.current === 1 ? t('1 day in a row', '1 día seguido') : t(`${streak.current} days in a row`, `${streak.current} días seguidos`) }}</span>
            <span v-if="streak.best > streak.current" class="block text-[12.5px] text-ink-muted">{{ t(`Your best: ${streak.best} days`, `Tu mejor racha: ${streak.best} días`) }}</span>
            <span v-else-if="!streak.current" class="block text-[12.5px] text-ink-muted">{{ t('Tick anything below to start one.', 'Marca cualquier cosa de abajo para empezar.') }}</span>
          </span>
          <AppChevron class="text-ink-faint" />
        </div>
        <ol class="mt-3 grid grid-cols-7 gap-1.5" :aria-label="t('This week', 'Esta semana')">
          <li v-for="d in week" :key="d.day" class="flex flex-col items-center gap-1 text-[11px]" :class="d.day === today ? 'font-semibold text-ink-900' : 'text-ink-muted'">
            <span
              class="flex h-[30px] w-[30px] items-center justify-center rounded-full"
              :class="{
                'bg-brand text-white': d.state === 'done',
                'border-2 border-dashed border-brand/50': d.state === 'free',
                'border-2 border-brand': d.state === 'today',
                'bg-surface-subtle': d.state === 'missed' || d.state === 'future',
              }"
              :aria-label="`${d.letter}: ${d.state === 'done' ? t('done', 'hecho') : d.state === 'free' ? t('day off', 'día libre') : d.state === 'today' ? t('today', 'hoy') : ''}`"
            >
              <svg v-if="d.state === 'done'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
            </span>
            {{ d.letter }}
          </li>
        </ol>
        <p v-if="freeThisWeek" class="mt-2 text-[12.5px] text-ink-muted">{{ t('Your day off this week: it does not break the streak.', `El ${dayNames[thisWeek(today).indexOf(freeThisWeek.day)]} fue tu día libre: no rompe la racha.`) }}</p>
      </NuxtLink>

      <h2 class="mt-2 text-[16px] font-bold text-ink-900">{{ t('Today', 'Hoy') }}</h2>
      <article v-for="e in exercises" :key="e.id" class="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 shadow-card" data-cy="care-exercise">
        <NuxtLink to="/exercises" class="min-w-0 flex-1">
          <span class="block text-[14.5px] font-semibold text-ink-900">{{ e.exercises?.name }}</span>
          <span class="block text-[12.5px] text-ink-muted">{{ [e.sets && e.reps ? `${e.sets} × ${e.reps}` : e.reps, e.frequency].filter(Boolean).join(' · ') }}</span>
        </NuxtLink>
        <button
          type="button"
          class="min-h-9 shrink-0 rounded-ctl px-3 text-[12.5px] font-semibold"
          :class="exerciseDone(e) ? 'bg-success-bg text-success-text' : 'bg-brand text-white'"
          :aria-pressed="exerciseDone(e)"
          :disabled="busyId === e.id"
          data-cy="care-exercise-done"
          @click="toggleExercise(e)"
        >
          {{ t('Done today', 'Hecho hoy') }}
        </button>
      </article>

      <section class="rounded-card border border-line bg-surface px-4 py-1 shadow-card" data-cy="care-habits">
        <div v-for="h in todaysHabits" :key="h.id" class="flex items-center gap-3 border-b border-line-row py-2.5" data-cy="care-habit">
          <span class="min-w-0 flex-1 text-[14px] text-ink-900">{{ habitLabel(h) }}</span>
          <span class="h-1.5 w-16 overflow-hidden rounded-full bg-surface-subtle" aria-hidden="true">
            <span class="block h-1.5 bg-brand" :style="{ width: `${Math.min(100, (habitDone(h) / remindersOn(h, isoWeekday(today))) * 100)}%` }" />
          </span>
          <span class="w-9 text-right font-mono text-[13px] text-ink-900" data-cy="care-habit-count">{{ habitDone(h) }}/{{ remindersOn(h, isoWeekday(today)) }}</span>
          <button type="button" class="min-h-9 rounded-ctl bg-brand-tint px-3 text-[12.5px] font-semibold text-brand-text disabled:opacity-60" :disabled="tickingId === h.id" data-cy="care-habit-tick" @click="tickHabit(h)">{{ t('Done', 'Hecho') }}</button>
        </div>
        <p v-if="!habits.length" class="py-3 text-[13.5px] text-ink-muted">{{ t('Reminders to drink water, stretch or breathe, when and where you choose.', 'Recordatorios para beber agua, estirar o respirar, cuando y donde tú elijas.') }}</p>
        <NuxtLink to="/care/habits" class="flex min-h-11 items-center text-[14px] font-semibold text-brand-text" data-cy="care-habits-link">
          {{ habits.length ? t('My habits', 'Mis hábitos') : t('Create your first habit', 'Crea tu primer hábito') }}
          <AppChevron class="ml-auto" />
        </NuxtLink>
      </section>

      <PatientLearnCard class="mt-2" :patient-id="patientId" :link-to="(id) => `/learn/${id}`" />
      <PatientLearnLibrary class="mt-2" :link-to="(id) => `/learn/${id}`" />
    </div>
    <CareDayComplete v-if="celebrate" :streak="streak.current" :week-done="week.filter((d) => d.state === 'done').length" @close="celebrate = false" />
  </PatientScreen>
</template>

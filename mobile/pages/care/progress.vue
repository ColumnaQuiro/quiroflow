<script setup lang="ts">
import { addDays, dayState, isoWeekday } from '../../../utils/careStreak'

// "Tu constancia", opened from the streak on Cuidarme: the streak and the
// best one, this month day by day, and the achievements -- milestones that
// say when they were reached or how far there is to go. Nothing here
// compares one patient with another.
definePageMeta({ layout: 'patient' })

const t = useT()
const { patient } = useIdentity()
const patientId = computed(() => patient.value?.id ?? '')
const { streak, today, active, achievements, loaded } = useCareProgress(() => patientId.value)
const { preference: lang } = useLang()

const month = computed(() => {
  const first = `${today.value.slice(0, 7)}-01`
  const cells: { day: string | null; n: number; state: string }[] = Array.from({ length: isoWeekday(first) - 1 }, () => ({ day: null, n: 0, state: '' }))
  for (let d = first; d.slice(0, 7) === first.slice(0, 7); d = addDays(d, 1)) cells.push({ day: d, n: Number(d.slice(8)), state: dayState(d, today.value, active.value, streak.value.free) })
  const past = cells.filter((c) => c.day && c.day < today.value)
  const name = new Date(`${first}T12:00:00`).toLocaleDateString(t('en-GB', 'es-ES'), { month: 'long' })
  return { name: name.charAt(0).toUpperCase() + name.slice(1), cells, done: cells.filter((c) => c.state === 'done').length, of: past.length + (active.value.has(today.value) ? 1 : 0) }
})
const earned = computed(() => achievements.value.filter((a) => a.done).length)
const detail = (a: (typeof achievements.value)[number]) =>
  a.pain ? t(`From ${a.pain[0]} to ${a.pain[1]}`, `De ${a.pain[0]} a ${a.pain[1]}`) : a.progress ? t(`${a.progress[0]} of ${a.progress[1]}`, `${a.progress[0]} de ${a.progress[1]}`) : null
const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short' })
</script>

<template>
  <PatientScreen :title="t('Your consistency', 'Tu constancia')">
    <div v-if="loaded" class="flex flex-col gap-3" data-cy="care-progress">
      <section class="flex items-end gap-4 rounded-card border border-line bg-surface p-4 shadow-card">
        <div><p class="text-[44px] font-bold leading-none tracking-tight text-ink-900" data-cy="care-progress-streak">{{ streak.current }}</p><p class="mt-1 text-[12.5px] text-ink-muted">{{ t('days in a row', 'días seguidos') }}</p></div>
        <div class="ml-auto text-right"><p class="font-mono text-[18px] text-ink-900">{{ streak.best }}</p><p class="text-[12.5px] text-ink-muted">{{ t('your best', 'tu mejor racha') }}</p></div>
      </section>

      <section class="rounded-card border border-line bg-surface p-4 shadow-card">
        <div class="mb-3 flex items-baseline"><h2 class="flex-1 text-[15px] font-bold text-ink-900">{{ month.name }}</h2><span class="text-[12.5px] text-ink-muted">{{ t(`${month.done} of ${month.of} days`, `${month.done} de ${month.of} días`) }}</span></div>
        <div class="grid grid-cols-7 gap-1.5 text-center" :aria-label="month.name">
          <span v-for="(l, i) in (lang === 'en' ? 'MTWTFSS' : 'LMXJVSD').split('')" :key="i" class="text-[11px] font-semibold text-ink-muted">{{ l }}</span>
          <span
            v-for="(c, i) in month.cells"
            :key="i"
            class="mx-auto flex h-[34px] w-[34px] items-center justify-center rounded-full font-mono text-[12px]"
            :class="{
              invisible: !c.day,
              'bg-brand text-white': c.state === 'done',
              'border-2 border-dashed border-brand/50 text-brand-text': c.state === 'free',
              'bg-surface-subtle text-ink-700': c.state === 'missed',
              'border-2 border-brand font-semibold text-ink-900': c.state === 'today',
              'text-ink-muted': c.state === 'future',
            }"
          >{{ c.day ? c.n : '' }}</span>
        </div>
        <p class="mt-3 flex flex-wrap gap-3 text-[12px] text-ink-muted">
          <span class="inline-flex items-center gap-1.5"><i class="inline-block h-3 w-3 rounded-full bg-brand" />{{ t('Done', 'Hecho') }}</span>
          <span class="inline-flex items-center gap-1.5"><i class="inline-block h-3 w-3 rounded-full border-2 border-dashed border-brand/50" />{{ t('Day off', 'Día libre') }}</span>
          <span class="inline-flex items-center gap-1.5"><i class="inline-block h-3 w-3 rounded-full bg-surface-subtle" />{{ t('Not done', 'Sin hacer') }}</span>
        </p>
        <p class="mt-2 text-[12.5px] text-ink-muted">{{ t('One day off a week does not break your streak.', 'Un día libre por semana no rompe la racha.') }}</p>
      </section>

      <div class="mt-2 flex items-baseline"><h2 class="flex-1 text-[16px] font-bold text-ink-900">{{ t('Achievements', 'Logros') }}</h2><span class="text-[12.5px] text-ink-muted">{{ t(`${earned} of ${achievements.length}`, `${earned} de ${achievements.length}`) }}</span></div>
      <ul class="grid grid-cols-2 gap-2.5">
        <li v-for="a in achievements" :key="a.key" class="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-3" :data-cy="`care-achievement-${a.key}`" :data-done="a.done">
          <span class="flex h-11 w-11 items-center justify-center rounded-full" :class="a.done ? 'bg-brand text-white' : 'bg-surface-subtle text-ink-muted'" aria-hidden="true">
            <svg v-if="a.done" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l5 5L20 7" /></svg>
            <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="9" r="6" /><path d="M8.5 14l-1.5 8 5-3 5 3-1.5-8" /></svg>
          </span>
          <span class="text-[13.5px] font-semibold leading-snug text-ink-900">{{ lang === 'en' ? a.title[0] : a.title[1] }}</span>
          <span v-if="a.progress" class="h-1.5 overflow-hidden rounded-full bg-surface-subtle" aria-hidden="true"><span class="block h-1.5 bg-brand" :style="{ width: `${(a.progress[0] / a.progress[1]) * 100}%` }" /></span>
          <span class="text-[12px] text-ink-muted">{{ [detail(a), a.done && a.on ? fmt(a.on) : null].filter(Boolean).join(' · ') || (a.done ? t('Done', 'Conseguido') : '') }}</span>
        </li>
      </ul>
    </div>
  </PatientScreen>
</template>

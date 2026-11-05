<script setup lang="ts">
import { MAX_REMINDERS_PER_DAY, habitLabel, habitSummary, remindersPerDay, type HabitKind } from '../../../utils/habits'

// "Mis hábitos": the patient's own reminders, on this phone only
// (useHabits), each switched on or off here and edited at /care/habit/<id>.
// The meter is the daily cap (utils/habits.ts says why there is one).
definePageMeta({ layout: 'patient' })

const t = useT()
const { patient } = useIdentity()
const patientId = computed(() => patient.value?.id ?? '')
const { habits, places, save, reminders } = useHabits(() => patientId.value)

const perDay = computed(() => remindersPerDay(habits.value))
const full = computed(() => perDay.value >= MAX_REMINDERS_PER_DAY)
const error = ref('')
async function toggle(id: string) {
  error.value = ''
  const next = habits.value.map((h) => (h.id === id ? { ...h, enabled: !h.enabled } : h))
  const r = await save(next)
  if ('error' in r) error.value = r.error
}
const placeNames = (ids: string[]) => ids.map((id) => places.value.find((p) => p.id === id)?.name).filter(Boolean).join(' o ')

const ICONS: Record<HabitKind, { path: string; tone: string }> = {
  agua: { path: 'M12 2.7s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z', tone: 'bg-info-bg text-info-text' },
  estirar: { path: 'M12 6.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 7v7M8 21l4-7 4 7M5 10l7-2 7 2', tone: 'bg-success-bg text-success-text' },
  respirar: { path: 'M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7', tone: 'bg-brand-tint text-brand-text' },
  postura: { path: 'M12 3v18M8 7l4-4 4 4', tone: 'bg-warning-bg text-warning-text' },
  levantarse: { path: 'M13 4a2 2 0 1 0 0-.1M10 21l2-7 3 3v5M9 12l3-4 3 3 3 1', tone: 'bg-success-bg text-success-text' },
  otro: { path: 'M12 8v4l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', tone: 'bg-surface-subtle text-ink-700' },
}
</script>

<template>
  <PatientScreen :title="t('My habits', 'Mis hábitos')" :lead="t('Your own reminders. They stay on this phone: your clinic does not see their times.', 'Tus propios recordatorios. Se quedan en este teléfono: la clínica no ve sus horas.')">
    <div class="flex flex-col gap-2.5" data-cy="habits">
      <p v-if="!reminders.available" class="rounded-card border border-line bg-surface-subtle p-4 text-[13.5px] text-ink-700">{{ t('Reminders work in the QuiroFlow app on your phone.', 'Los recordatorios funcionan en la app de QuiroFlow en tu teléfono.') }}</p>
      <article v-for="h in habits" :key="h.id" class="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 shadow-card" data-cy="habit-row">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-ctl" :class="ICONS[h.kind].tone" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path :d="ICONS[h.kind].path" /></svg>
        </span>
        <NuxtLink :to="`/care/habit/${h.id}`" class="min-w-0 flex-1">
          <span class="block text-[14.5px] font-semibold text-ink-900">{{ habitLabel(h) }}</span>
          <span class="block text-[12.5px] text-ink-muted">{{ h.enabled ? habitSummary(h) : t('Paused', 'Pausado') }}</span>
          <span v-if="h.enabled && h.placeIds.length" class="flex items-center gap-1 text-[12.5px] text-brand-text">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
            {{ t(`Only at ${placeNames(h.placeIds)}`, `Solo en ${placeNames(h.placeIds)}`) }}
          </span>
        </NuxtLink>
        <button
          type="button"
          role="switch"
          :aria-checked="h.enabled"
          :aria-label="habitLabel(h)"
          class="relative h-7 w-[46px] shrink-0 rounded-full transition-colors"
          :class="h.enabled ? 'bg-brand' : 'bg-line-control'"
          data-cy="habit-toggle"
          @click="toggle(h.id)"
        >
          <span class="absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white transition-all" :class="h.enabled ? 'right-[3px]' : 'left-[3px]'" />
        </button>
      </article>

      <div v-if="habits.length" class="flex flex-col gap-1.5 px-0.5 pt-1">
        <div class="flex justify-between text-[12.5px] text-ink-muted"><span>{{ t('Reminders a day', 'Avisos al día') }}</span><span class="font-mono text-ink-900" data-cy="habits-per-day">{{ perDay }} {{ t('of', 'de') }} {{ MAX_REMINDERS_PER_DAY }}</span></div>
        <div class="h-1.5 overflow-hidden rounded-full bg-surface-subtle"><div class="h-1.5 bg-brand" :style="{ width: `${(perDay / MAX_REMINDERS_PER_DAY) * 100}%` }" /></div>
        <p v-if="full" class="text-[12.5px] text-ink-muted">{{ t('That is the most. Pause one or lower the times to add another.', 'Has llegado al máximo. Pausa uno o baja las veces para añadir otro.') }}</p>
      </div>
      <p v-if="error" role="alert" class="text-[13px] font-semibold text-danger-text">{{ error }}</p>
      <NuxtLink v-if="!full" to="/care/habit/new" class="mt-1 flex h-12 items-center justify-center rounded-card border border-dashed border-brand/50 bg-surface text-[14.5px] font-semibold text-brand-text" data-cy="habit-add">
        {{ t('+ Add a habit', '+ Añadir hábito') }}
      </NuxtLink>
    </div>
  </PatientScreen>
</template>

<script setup lang="ts">
import { addDays, careStreak, dayOf } from '../../utils/careStreak'

// How the patient is doing at home, on the record under "Ejercicios en
// casa": the streak their app shows them (Cuidarme, utils/careStreak.ts),
// the days this month, and habit ticks this week. Counted from home
// exercises and habit check-ins alike; never the habits' times or places,
// which stay on the patient's phone. Nothing at all until there is something.
const props = defineProps<{ patientId: string }>()

const t = useT()
const supabase = useSupabaseClient()
const active = ref<Set<string>>(new Set())
const habitsThisWeek = ref(0)
async function load() {
  const since = addDays(dayOf(new Date()), -400)
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString()
  const [ex, hb] = await Promise.all([
    supabase.from('patient_exercise_logs').select('done_on, patient_exercises!inner(patient_id)').eq('patient_exercises.patient_id', props.patientId).gte('done_on', since),
    supabase.from('habit_checkins').select('done_at').eq('patient_id', props.patientId).gte('done_at', `${since}T00:00:00Z`),
  ])
  const days = new Set<string>()
  for (const r of (ex.data as { done_on: string }[] | null) ?? []) days.add(r.done_on)
  const ticks = (hb.data as { done_at: string }[] | null) ?? []
  for (const r of ticks) days.add(dayOf(new Date(r.done_at)))
  active.value = days
  habitsThisWeek.value = ticks.filter((r) => r.done_at >= weekAgo).length
}
watch(() => props.patientId, load, { immediate: true })

const today = computed(() => dayOf(new Date()))
const streak = computed(() => careStreak(active.value, today.value))
const month = computed(() => {
  const prefix = today.value.slice(0, 7)
  const done = [...active.value].filter((d) => d.startsWith(prefix)).length
  return { done, of: Number(today.value.slice(8)) }
})
const line = computed(() =>
  [
    streak.value.current ? t(`${streak.value.current}-day streak`, `racha de ${streak.value.current} días`) : null,
    t(`${month.value.done} of ${month.value.of} days this month`, `${month.value.done} de ${month.value.of} días este mes`),
    habitsThisWeek.value ? t(`${habitsThisWeek.value} habits ticked this week`, `${habitsThisWeek.value} hábitos marcados esta semana`) : null,
  ]
    .filter(Boolean)
    .join(' · '),
)
</script>

<template>
  <p v-if="active.size" class="mt-0.5 text-[12.5px] text-ink-muted" data-cy="care-consistency">
    <span class="font-medium text-ink-700">{{ t('At home', 'En casa') }}:</span> {{ line }}
  </p>
</template>

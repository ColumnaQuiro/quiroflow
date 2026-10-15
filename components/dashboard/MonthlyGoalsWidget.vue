<script setup lang="ts">
import { GOAL_LABELS, GOAL_METRICS, goalPace, goalValue, type GoalMetric, type GoalProgress } from '../../utils/monthlyGoals'
import { parseEurosToCents } from '../../utils/appointmentTypes'

// Monthly goals on the Dashboard: what the owner aims for this month (new
// patients, visits, money collected, care plans started) against the month
// so far, with whether each is on track for where an even month would be by
// now. Owners only -- the widget is offered only to them (dashboardWidgets'
// ownerOnly) and /api/goals refuses anyone else. Set and changed in place.
const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()
const authedFetch = useAuthedFetch()

const loading = ref(true)
const month = ref('')
const elapsed = ref(0)
const goals = ref<GoalProgress[]>([])
const editing = ref(false)
const draft = ref<Record<GoalMetric, string>>({ new_patients: '', visits: '', collected_cents: '', plans_started: '' })
const saving = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  try {
    const r = await authedFetch<{ month: string; elapsed: number; goals: GoalProgress[] }>('/api/goals')
    month.value = r.month
    elapsed.value = r.elapsed
    goals.value = r.goals
  } catch {
    goals.value = []
  }
  loading.value = false
}
onMounted(load)

function startEditing() {
  for (const k of GOAL_METRICS) {
    const g = goals.value.find((x) => x.metric === k)
    draft.value[k] = g ? (k === 'collected_cents' ? String(g.target / 100) : String(g.target)) : ''
  }
  editing.value = true
}

async function save() {
  saving.value = true
  error.value = ''
  const day = `${month.value}-01`
  const upserts: { account_id: string; month: string; metric: GoalMetric; target: number; updated_at: string }[] = []
  const removed: GoalMetric[] = []
  for (const k of GOAL_METRICS) {
    const raw = draft.value[k].trim()
    const n = k === 'collected_cents' ? parseEurosToCents(raw) : Math.round(Number(raw))
    if (!raw || !n || n <= 0) removed.push(k)
    else upserts.push({ account_id: store.accountId!, month: day, metric: k, target: n, updated_at: new Date().toISOString() })
  }
  const [up, del] = await Promise.all([
    upserts.length ? supabase.from('monthly_goals').upsert(upserts as never, { onConflict: 'account_id,month,metric' }) : Promise.resolve({ error: null }),
    removed.length ? supabase.from('monthly_goals').delete().eq('month', day).in('metric', removed) : Promise.resolve({ error: null }),
  ])
  saving.value = false
  if (up.error || del.error) {
    error.value = t("Couldn't save the goals. Try again.", 'No se han podido guardar los objetivos. Inténtalo de nuevo.')
    return
  }
  editing.value = false
  await load()
}

const monthName = computed(() => (month.value ? new Date(`${month.value}-15T12:00:00Z`).toLocaleDateString(t('en-GB', 'es-ES'), { month: 'long', timeZone: 'UTC' }) : ''))
const PACE: Record<string, { label: [string, string]; bar: string; text: string }> = {
  done: { label: ['Reached', 'Conseguido'], bar: 'bg-success-accent', text: 'text-success-text' },
  on_track: { label: ['On track', 'En camino'], bar: 'bg-brand', text: 'text-brand-text' },
  behind: { label: ['Behind', 'Por detrás'], bar: 'bg-warning-accent', text: 'text-warning-text' },
}
</script>

<template>
  <div data-cy="monthly-goals" :data-ready="loading ? undefined : 'true'">
    <div v-if="loading" class="space-y-2"><UiSkeleton v-for="i in 3" :key="i" class="h-8 w-full rounded-ctlSm" /></div>

    <form v-else-if="editing" class="grid grid-cols-1 gap-2.5 sm:grid-cols-2" data-cy="monthly-goals-form" @submit.prevent="save">
      <label v-for="k in GOAL_METRICS" :key="k" class="flex flex-col gap-1 text-[12px] text-ink-muted">
        {{ t(...GOAL_LABELS[k]) }}{{ k === 'collected_cents' ? ' (€)' : '' }}
        <input v-model="draft[k]" inputmode="decimal" class="h-9 rounded-ctl border border-line-control bg-surface px-2.5 text-[13.5px] text-ink-900" :placeholder="t('No goal', 'Sin objetivo')" :data-cy="`monthly-goal-${k}`" />
      </label>
      <p v-if="error" role="alert" class="text-[12px] text-danger-text sm:col-span-2">{{ error }}</p>
      <div class="flex gap-2 sm:col-span-2">
        <UiBtn type="submit" variant="primary" size="sm" :disabled="saving" data-cy="monthly-goals-save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
        <UiBtn type="button" variant="secondary" size="sm" @click="editing = false">{{ t('Cancel', 'Cancelar') }}</UiBtn>
      </div>
    </form>

    <div v-else-if="!goals.length" class="flex flex-col items-start gap-2">
      <p class="text-[13px] text-ink-muted">{{ t(`No goals for ${monthName} yet.`, `Aún no hay objetivos para ${monthName}.`) }}</p>
      <UiBtn size="sm" variant="secondary" data-cy="monthly-goals-set" @click="startEditing">{{ t('Set goals', 'Poner objetivos') }}</UiBtn>
    </div>

    <div v-else class="flex flex-col gap-3">
      <div v-for="g in goals" :key="g.metric" :data-cy="`monthly-goal-row-${g.metric}`">
        <div class="flex items-baseline justify-between gap-2 text-[12.5px]">
          <span class="font-medium text-ink-700">{{ t(...GOAL_LABELS[g.metric]) }}</span>
          <span>
            <span class="font-mono font-semibold text-ink-900">{{ goalValue(g.metric, g.actual) }}</span>
            <span class="text-ink-muted"> / {{ goalValue(g.metric, g.target) }}</span>
            <span class="ml-1.5 text-[11.5px] font-semibold" :class="PACE[goalPace(g, elapsed)]!.text" data-cy="monthly-goal-pace">{{ t(...PACE[goalPace(g, elapsed)]!.label) }}</span>
          </span>
        </div>
        <div class="relative mt-1 h-2 overflow-hidden rounded-pill bg-line-divider">
          <span class="block h-full rounded-pill" :class="PACE[goalPace(g, elapsed)]!.bar" :style="{ width: `${Math.min(100, (g.actual / g.target) * 100)}%` }" />
          <!-- Where an even month would be by today. -->
          <span class="absolute top-0 h-full w-px bg-ink-faint" :style="{ left: `${Math.round(elapsed * 100)}%` }" aria-hidden="true" />
        </div>
      </div>
      <button type="button" class="self-start text-[12px] font-semibold text-brand-text" data-cy="monthly-goals-edit" @click="startEditing">{{ t('Change goals', 'Cambiar objetivos') }}</button>
    </div>
  </div>
</template>

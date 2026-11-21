<script setup lang="ts">
import { exerciseCatalogItem } from '../../utils/exerciseCatalog'
import type { ExerciseSuggestion } from '../../utils/postureSuggestions'

// "Ejercicios sugeridos" under a posture or squat assessment on the record:
// what the measurements suggest (utils/postureSuggestions.ts), as exercises
// from QuiroFlow's starter catalogue, ticked by default. "Asignar" adds the
// ones ticked to the clinic's library if it does not have them yet
// (useExerciseCatalog) and gives them to the patient with the catalogue's
// dose (useStaffExercises.assignProgram) -- one push to their app for the
// lot. One they already have is shown as such and skipped.
//
// Nothing is sent without the practitioner pressing the button. Shared with
// the staff app, which has no web account store: the account and who is
// assigning are read here.
const props = defineProps<{ patientId: string; suggestions: ExerciseSuggestion[] }>()

const t = useT()
const supabase = useSupabaseClient()
const { showToast } = useToast()
const catalog = useExerciseCatalog()
const accountId = ref<string | null>(null)
const teamMemberId = ref<string | null>(null)
const exercises = useStaffExercises({ accountId: () => accountId.value, patientId: () => props.patientId, teamMemberId: () => teamMemberId.value })

onMounted(async () => {
  const { data: p } = await supabase.from('patients').select('account_id').eq('id', props.patientId).maybeSingle()
  accountId.value = (p as { account_id: string } | null)?.account_id ?? null
  const { data: auth } = await supabase.auth.getUser()
  if (accountId.value && auth.user) {
    const { data: tm } = await supabase.from('team_members').select('id').eq('account_id', accountId.value).eq('user_id', auth.user.id).maybeSingle()
    teamMemberId.value = (tm as { id: string } | null)?.id ?? null
  }
})

const has = computed(() => new Set(exercises.assigned.value.map((a) => a.exercises?.starter_key).filter(Boolean) as string[]))
const off = ref<Set<string>>(new Set())
const picked = computed(() => [...new Set(props.suggestions.flatMap((s) => s.slugs))].filter((slug) => !has.value.has(slug) && !off.value.has(slug)))
function toggle(slug: string) {
  const next = new Set(off.value)
  if (next.has(slug)) next.delete(slug)
  else next.add(slug)
  off.value = next
}
const name = (slug: string) => {
  const item = exerciseCatalogItem(slug)
  return item ? t(item.name.en, item.name.es) : slug
}
const num = (n: number) => n.toLocaleString(t('en-GB', 'es-ES'), { maximumFractionDigits: 1 })

const busy = ref(false)
async function assign() {
  if (!accountId.value || !picked.value.length) return
  busy.value = true
  try {
    const items = []
    for (const slug of picked.value) {
      const id = await catalog.addToLibrary(accountId.value, slug, teamMemberId.value)
      const item = exerciseCatalogItem(slug)
      if (!id || !item) throw new Error(slug)
      items.push({ exercise_id: id, ...catalog.dose(item), notes: null })
    }
    const result = await exercises.assignProgram(items)
    if (!result) throw new Error('assign')
    // The record's own exercise list catches up (useStaffExercises watches it).
    useState<number>('patientExercisesBump', () => 0).value++
    showToast(t(`${result.added} exercises given. The patient has them in their app.`, `${result.added} ejercicios asignados. El paciente ya los tiene en su app.`), 'success')
  } catch {
    showToast(t('Could not assign them. Try again.', 'No se han podido asignar. Inténtalo de nuevo.'), 'error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section v-if="suggestions.length" class="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-3.5" data-pdf-skip data-cy="posture-suggestions">
    <div class="flex flex-wrap items-baseline gap-2">
      <h4 class="text-[14px] font-semibold text-ink-900">{{ t('Suggested exercises', 'Ejercicios sugeridos') }}</h4>
      <span class="text-[12px] text-ink-muted">{{ t('From what was measured. Tick what to give; you decide.', 'Según lo medido. Marca los que quieras darle; decides tú.') }}</span>
    </div>
    <ul class="flex flex-col gap-2.5">
      <li v-for="s in suggestions" :key="s.key" class="flex flex-col gap-1.5" :data-cy="`posture-suggestion-${s.key}`">
        <p class="text-[13px] text-ink-700"><span class="font-semibold text-ink-900">{{ t(s.finding.en, s.finding.es) }}</span> · <span class="font-mono">{{ num(s.value) }}{{ s.unit === '°' ? '°' : ` ${s.unit}` }}</span></p>
        <div class="flex flex-wrap gap-1.5">
          <label
            v-for="slug in s.slugs"
            :key="slug"
            class="flex h-9 items-center gap-1.5 rounded-pill border px-3 text-[12.5px] font-semibold touch:h-11"
            :class="has.has(slug) ? 'border-line bg-surface-subtle text-ink-muted' : off.has(slug) ? 'border-line-control bg-surface text-ink-700' : 'border-brand bg-brand-tint text-brand-text'"
            :data-cy="`posture-suggestion-exercise-${slug}`"
          >
            <input type="checkbox" class="size-4 accent-brand" :checked="!has.has(slug) && !off.has(slug)" :disabled="has.has(slug)" @change="toggle(slug)" />
            {{ name(slug) }}<template v-if="has.has(slug)"> · {{ t('already has it', 'ya lo tiene') }}</template>
          </label>
        </div>
      </li>
    </ul>
    <div class="flex items-center gap-2">
      <UiBtn variant="primary" :disabled="busy || !picked.length || !accountId" data-cy="posture-suggestions-assign" @click="assign">{{ busy ? t('Assigning…', 'Asignando…') : t(`Give ${picked.length} exercises`, `Asignar ${picked.length} ejercicios`) }}</UiBtn>
    </div>
  </section>
</template>

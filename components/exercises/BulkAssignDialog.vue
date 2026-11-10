<script setup lang="ts">
import type { PatientSelection } from '~/composables/usePatientTypes'
import { normalizeSearchTerm } from '~/utils/searchText'
import { exerciseDoseLabel } from '~/utils/exerciseDose'

// "Assign exercises" for many patients at once: a programme, loose
// exercises from the library, or a schedule by visit. Before anything is
// written it says what will not happen the way one expects: who has no app
// (and so will not see them), who already has some (skipped, not doubled),
// and, for a schedule, who already follows one (left as it is).
const props = defineProps<{ selection: PatientSelection; count: number }>()
const emit = defineEmits<{ done: [summary: string]; cancel: [] }>()
const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()

const mode = ref<'program' | 'exercises' | 'schedule'>('program')
const programs = useExercisePrograms({ accountId: () => store.accountId })
const schedules = useExerciseSchedules({ accountId: () => store.accountId })
const library = ref<{ id: string; name: string }[]>([])
onMounted(async () => {
  programs.load()
  schedules.load()
  const { data } = await supabase.from('exercises').select('id, name').is('archived_at', null).order('name')
  library.value = (data ?? []) as { id: string; name: string }[]
})

const programId = ref('')
const scheduleId = ref('')
const picked = ref<string[]>([])
const query = ref('')
const notify = ref(true)
const busy = ref(false)
const error = ref('')

const program = computed(() => programs.programs.value.find((p) => p.id === programId.value) ?? null)
const shownLibrary = computed(() => {
  const q = normalizeSearchTerm(query.value)
  return q ? library.value.filter((e) => normalizeSearchTerm(e.name).includes(q)) : library.value
})
function togglePick(id: string) {
  picked.value = picked.value.includes(id) ? picked.value.filter((x) => x !== id) : [...picked.value, id]
}

const items = computed(() => {
  if (mode.value === 'program') {
    return (program.value?.exercise_program_items ?? [])
      .filter((i) => !i.exercises?.archived_at)
      .map((i) => ({ exercise_id: i.exercise_id, sets: i.sets, reps: i.reps, frequency: i.frequency, notes: i.notes, progressive: !!i.progressive }))
  }
  if (mode.value === 'exercises') return picked.value.map((id) => ({ exercise_id: id, sets: null, reps: null, frequency: null, notes: null, progressive: false }))
  return []
})
const ready = computed(() => (mode.value === 'schedule' ? !!scheduleId.value : items.value.length > 0))

// The preview, asked again whenever what is chosen changes.
const preview = ref<{ patients: number; without_app: number; already_have: number; with_schedule: number } | null>(null)
const who = computed(() =>
  'patientIds' in props.selection
    ? { p_patient_ids: props.selection.patientIds, p_filters: null, p_clinic_id: null }
    : { p_patient_ids: null, p_filters: props.selection.filters, p_clinic_id: props.selection.clinicId },
)
watch(
  () => [mode.value, items.value.map((i) => i.exercise_id).join(',')],
  async () => {
    if (!store.accountId) return
    const { data } = await supabase.rpc('assign_exercises_preview', {
      p_account_id: store.accountId,
      ...(who.value as Record<string, unknown>),
      p_exercise_ids: items.value.map((i) => i.exercise_id),
    } as never)
    preview.value = (data as typeof preview.value) ?? null
  },
  { immediate: true },
)

const patientsLabel = computed(() => (props.count === 1 ? t('1 patient', '1 paciente') : t(`${props.count} patients`, `${props.count} pacientes`)))

async function confirm() {
  if (!ready.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const r = await useStaffFetch<{ patients: number; patientsGiven: number; exercises: number; started: number; skipped: number }>('/api/exercises/bulk-assign', {
      method: 'POST',
      body: {
        ...props.selection,
        items: mode.value === 'schedule' ? [] : items.value,
        scheduleId: mode.value === 'schedule' ? scheduleId.value : null,
        notify: notify.value,
      },
    })
    const summary =
      mode.value === 'schedule'
        ? t(`Schedule started for ${r.started} · ${r.skipped} already had one`, `Pauta iniciada a ${r.started} · ${r.skipped} ya tenían una`)
        : t(`${r.exercises} exercises assigned to ${r.patientsGiven} patients`, `${r.exercises} ejercicios asignados a ${r.patientsGiven} pacientes`)
    emit('done', summary)
  } catch (e) {
    error.value = serverMessage(e) ?? t("Couldn't assign them. Try again.", 'No se han podido asignar. Inténtalo de nuevo.')
  } finally {
    busy.value = false
  }
}

const select = 'h-9 touch:h-11 w-full rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
</script>

<template>
  <UiConfirmDialog
    :title="t(`Assign exercises to ${patientsLabel}`, `Asignar ejercicios a ${patientsLabel}`)"
    :confirm-label="t(`Assign to ${patientsLabel}`, `Asignar a ${patientsLabel}`)"
    :cancel-label="t('Cancel', 'Cancelar')"
    :disabled="!ready"
    :busy="busy"
    @confirm="confirm"
    @cancel="emit('cancel')"
  >
    <div class="flex flex-wrap gap-1" role="group" :aria-label="t('What to assign', 'Qué asignar')">
      <button
        v-for="m in (['program', 'exercises', 'schedule'] as const)"
        :key="m"
        type="button"
        :aria-pressed="mode === m"
        class="h-9 rounded-ctl border px-3 text-[13px] font-medium touch:h-11"
        :class="mode === m ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-700 hover:bg-surface-subtle'"
        :data-cy="`bulk-assign-mode-${m}`"
        @click="mode = m"
      >
        {{ m === 'program' ? t('Programme', 'Programa') : m === 'exercises' ? t('Exercises', 'Ejercicios sueltos') : t('Schedule by visit', 'Pauta por visita') }}
      </button>
    </div>

    <template v-if="mode === 'program'">
      <select v-model="programId" :class="select" :aria-label="t('Programme', 'Programa')" data-cy="bulk-assign-program">
        <option value="">{{ t('Choose a programme…', 'Elige un programa…') }}</option>
        <option v-for="p in programs.programs.value" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <ul v-if="program" class="divide-y divide-line-divider rounded-ctl border border-line">
        <li v-for="i in program.exercise_program_items" :key="i.exercise_id" class="flex items-center gap-3 px-3 py-2 text-[13px]" :class="i.exercises?.archived_at ? 'text-ink-faint line-through' : 'text-ink-700'">
          <span class="min-w-0 flex-1 truncate">{{ i.exercises?.name }}</span>
          <span class="shrink-0 font-mono text-[12px] text-ink-muted">{{ exerciseDoseLabel(i, t) }}</span>
        </li>
      </ul>
      <p v-if="programs.programs.value.length === 0 && !programs.loading.value" class="text-[13px] text-ink-muted">
        {{ t('No programmes yet. Make one in the Library tab.', 'Aún no hay programas. Crea uno en la pestaña Biblioteca.') }}
      </p>
    </template>

    <template v-else-if="mode === 'exercises'">
      <input v-model="query" type="search" :class="select" :placeholder="t('Search the library', 'Buscar en la biblioteca')" data-cy="bulk-assign-search" />
      <ul class="max-h-[240px] divide-y divide-line-divider overflow-y-auto rounded-ctl border border-line">
        <li v-for="e in shownLibrary" :key="e.id">
          <label class="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13px] text-ink-700 hover:bg-surface-subtle">
            <input type="checkbox" class="h-4 w-4 accent-brand" :checked="picked.includes(e.id)" data-cy="bulk-assign-exercise" @change="togglePick(e.id)" />
            <span class="min-w-0 flex-1 truncate">{{ e.name }}</span>
          </label>
        </li>
      </ul>
      <p class="text-[12px] text-ink-faint">{{ t('Assigned without a fixed dose; adjust it on each record if needed.', 'Se asignan sin dosis fija; ajústala en cada ficha si hace falta.') }}</p>
    </template>

    <template v-else>
      <select v-model="scheduleId" :class="select" :aria-label="t('Schedule', 'Pauta')" data-cy="bulk-assign-schedule">
        <option value="">{{ t('Choose a schedule…', 'Elige una pauta…') }}</option>
        <option v-for="s in schedules.templates.value" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
      <p class="text-[12px] text-ink-faint">{{ t("Counts visits from the start of each patient's latest care plan, or from today.", 'Cuenta las visitas desde el inicio del último plan de cada paciente, o desde hoy.') }}</p>
    </template>

    <div v-if="preview" class="flex flex-col gap-1.5" data-cy="bulk-assign-preview">
      <p v-if="preview.without_app > 0" class="rounded-ctl bg-warning-bg px-3 py-2 text-[12.5px] text-warning-text">
        {{ t(`${preview.without_app} do not use the app and will not see them until they install it.`, `${preview.without_app} no usan la app y no los verán hasta que la instalen.`) }}
      </p>
      <p v-if="mode !== 'schedule' && preview.already_have > 0" class="rounded-ctl bg-surface-subtle px-3 py-2 text-[12.5px] text-ink-700">
        {{ t(`${preview.already_have} already have some of these: those are kept, not doubled.`, `${preview.already_have} ya tienen alguno: se mantienen sin duplicar.`) }}
      </p>
      <p v-if="mode === 'schedule' && preview.with_schedule > 0" class="rounded-ctl bg-surface-subtle px-3 py-2 text-[12.5px] text-ink-700">
        {{ t(`${preview.with_schedule} already follow a schedule and are left as they are.`, `${preview.with_schedule} ya siguen una pauta y se dejan como están.`) }}
      </p>
    </div>

    <label class="flex items-center gap-2 text-[13px] text-ink-700">
      <input v-model="notify" type="checkbox" class="h-4 w-4 accent-brand" data-cy="bulk-assign-notify" />
      {{ t('Tell the patients with a notification in the app', 'Avisar a los pacientes con una notificación en la app') }}
    </label>
    <p v-if="error" role="alert" class="text-[12.5px] font-semibold text-danger-text">{{ error }}</p>
  </UiConfirmDialog>
</template>

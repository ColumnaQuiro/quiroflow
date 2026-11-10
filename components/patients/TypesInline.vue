<script setup lang="ts">
// A patient's types, in the record's banner: the chips, and for whoever may
// edit the patient, "+ Type" to give one and × to take one away. A type that
// brings exercises asks, when taken away, whether to end what it brought.
// Exercises shown elsewhere on the record reload after a change
// (patientExercisesBump, read by useStaffExercises).
const props = defineProps<{ patientId: string; canEdit: boolean }>()
const t = useT()
const supabase = useSupabaseClient()
const { showToast } = useToast()
const types = usePatientTypes()
const bump = useState<number>('patientExercisesBump', () => 0)

const mine = ref<string[]>([])
async function loadMine() {
  const { data } = await supabase.from('patient_type_members').select('type_id').eq('patient_id', props.patientId)
  mine.value = ((data ?? []) as { type_id: string }[]).map((r) => r.type_id)
}
onMounted(() => Promise.all([types.load(), loadMine()]))
watch(() => props.patientId, loadMine)

const shown = computed(() => mine.value.map((id) => types.byId.value.get(id)).filter((x): x is NonNullable<typeof x> => !!x))
const offered = computed(() => types.active.value.filter((x) => !mine.value.includes(x.id)))

const open = ref(false)
const busy = ref(false)
const removing = ref<{ id: string; name: string; brings: boolean } | null>(null)
const endExercises = ref(true)

async function change(add: string[], remove: string[], endTypeExercises = true) {
  busy.value = true
  try {
    const r = await types.assign({ patientIds: [props.patientId] }, { add, remove, endTypeExercises })
    await loadMine()
    bump.value++
    if (r.exercises) showToast(t(`${r.exercises} exercises assigned`, `${r.exercises} ejercicios asignados`))
  } catch (e) {
    showToast(serverMessage(e) ?? t('The type could not be changed.', 'No se ha podido cambiar el tipo.'), 'error')
  } finally {
    busy.value = false
  }
}
function give(id: string) {
  open.value = false
  change([id], [])
}
function askRemove(id: string) {
  const ty = types.byId.value.get(id)
  if (!ty) return
  if (!ty.exercise_program_id && !ty.exercise_schedule_id) return change([], [id])
  endExercises.value = true
  removing.value = { id, name: ty.name, brings: true }
}
async function confirmRemove() {
  if (!removing.value) return
  const id = removing.value.id
  await change([], [id], endExercises.value)
  removing.value = null
}

const menu = ref<HTMLElement | null>(null)
function closeOutside(e: MouseEvent) {
  if (menu.value && !menu.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('click', closeOutside))
onUnmounted(() => document.removeEventListener('click', closeOutside))
</script>

<template>
  <span v-if="shown.length || (canEdit && types.active.value.length)" class="inline-flex flex-wrap items-center gap-1.5" data-cy="patient-types">
    <span aria-hidden="true" class="hidden h-3 w-px bg-line lg:block" />
    <PatientsTypeChip v-for="ty in shown" :key="ty.id" :name="ty.name" :color="ty.color" :removable="canEdit && !busy" @remove="askRemove(ty.id)" />
    <span v-if="canEdit && offered.length" ref="menu" class="relative">
      <button
        type="button"
        class="flex h-6 items-center rounded-pill border border-dashed border-line-control px-2 text-[12px] font-medium text-ink-muted hover:border-line-controlHover hover:text-ink-700 touch:h-8"
        :aria-expanded="open"
        :disabled="busy"
        data-cy="patient-types-add"
        @click="open = !open"
      >
        + {{ t('Type', 'Tipo') }}
      </button>
      <div v-if="open" class="absolute left-0 top-full z-30 mt-1 min-w-[200px] rounded-ctl border border-line bg-surface py-1 shadow-popover" role="menu">
        <button
          v-for="ty in offered"
          :key="ty.id"
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink-700 hover:bg-surface-subtle"
          data-cy="patient-types-option"
          @click="give(ty.id)"
        >
          <span class="h-2 w-2 shrink-0 rounded-full" :style="{ background: PATIENT_TYPE_DOT[ty.color] }" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate">{{ ty.name }}</span>
          <span v-if="ty.exercise_program_id || ty.exercise_schedule_id" class="shrink-0 text-[11px] text-ink-faint">{{ t('brings exercises', 'trae ejercicios') }}</span>
        </button>
      </div>
    </span>
    <UiConfirmDialog
      v-if="removing"
      :title="t(`Take away “${removing.name}”?`, `¿Quitar «${removing.name}»?`)"
      :confirm-label="t('Take it away', 'Quitar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="busy"
      @confirm="confirmRemove"
      @cancel="removing = null"
    >
      <label class="flex items-start gap-2 text-[13px] text-ink-700">
        <input v-model="endExercises" type="checkbox" class="mt-0.5 h-4 w-4 accent-brand" data-cy="patient-types-end-exercises" />
        <span>
          {{ t('Also end the exercises this type brought', 'Finalizar también los ejercicios que trajo este tipo') }}
          <span class="block text-[12px] text-ink-faint">{{ t('Exercises added by hand stay.', 'Los añadidos a mano se quedan.') }}</span>
        </span>
      </label>
    </UiConfirmDialog>
  </span>
</template>

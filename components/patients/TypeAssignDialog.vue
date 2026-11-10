<script setup lang="ts">
import type { PatientSelection } from '~/composables/usePatientTypes'

// Give or take away patient types for many patients at once, from the
// Patients list or the Exercises section. What each type brings (its
// programme and schedule) comes with it; taking one away can end what it
// brought.
const props = defineProps<{ selection: PatientSelection; count: number }>()
const emit = defineEmits<{ done: [summary: string]; cancel: [] }>()
const t = useT()
const { active, load, assign, loading } = usePatientTypes()
onMounted(load)

const mode = ref<'add' | 'remove'>('add')
const chosen = ref<string[]>([])
const endExercises = ref(true)
const busy = ref(false)
const error = ref('')

function toggle(id: string) {
  chosen.value = chosen.value.includes(id) ? chosen.value.filter((x) => x !== id) : [...chosen.value, id]
}
const bringsSomething = computed(() => active.value.some((x) => chosen.value.includes(x.id) && (x.exercise_program_id || x.exercise_schedule_id)))
const patientsLabel = computed(() => (props.count === 1 ? t('1 patient', '1 paciente') : t(`${props.count} patients`, `${props.count} pacientes`)))

async function confirm() {
  if (!chosen.value.length || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const r = await assign(props.selection, mode.value === 'add' ? { add: chosen.value } : { remove: chosen.value, endTypeExercises: endExercises.value })
    const parts = [
      mode.value === 'add'
        ? t(`Type given to ${r.added} patients`, `Tipo puesto a ${r.added} pacientes`)
        : t(`Type taken from ${r.removed} patients`, `Tipo quitado a ${r.removed} pacientes`),
    ]
    if (r.exercises) parts.push(t(`${r.exercises} exercises assigned`, `${r.exercises} ejercicios asignados`))
    emit('done', parts.join(' · '))
  } catch (e) {
    error.value = serverMessage(e) ?? t('The types could not be changed.', 'No se han podido cambiar los tipos.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UiConfirmDialog
    :title="t(`Patient type for ${patientsLabel}`, `Tipo de paciente para ${patientsLabel}`)"
    :confirm-label="mode === 'add' ? t('Give the type', 'Poner el tipo') : t('Take the type away', 'Quitar el tipo')"
    :cancel-label="t('Cancel', 'Cancelar')"
    :disabled="chosen.length === 0"
    :busy="busy"
    @confirm="confirm"
    @cancel="emit('cancel')"
  >
    <div class="flex gap-1" role="group" :aria-label="t('Give or take away', 'Poner o quitar')">
      <button
        v-for="m in (['add', 'remove'] as const)"
        :key="m"
        type="button"
        :aria-pressed="mode === m"
        class="h-9 rounded-ctl border px-3 text-[13px] font-medium touch:h-11"
        :class="mode === m ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-700 hover:bg-surface-subtle'"
        :data-cy="`type-assign-mode-${m}`"
        @click="mode = m"
      >
        {{ m === 'add' ? t('Give', 'Poner') : t('Take away', 'Quitar') }}
      </button>
    </div>
    <p v-if="loading" class="text-[13px] text-ink-muted">{{ t('Loading…', 'Cargando…') }}</p>
    <p v-else-if="active.length === 0" class="text-[13px] text-ink-muted">
      {{ t('No patient types yet. Create them in Settings > Patient types.', 'Aún no hay tipos de paciente. Créalos en Ajustes › Tipos de paciente.') }}
    </p>
    <div v-else class="flex flex-wrap gap-2">
      <button
        v-for="ty in active"
        :key="ty.id"
        type="button"
        :aria-pressed="chosen.includes(ty.id)"
        class="flex h-9 items-center gap-2 rounded-ctl border px-3 text-[13px] touch:h-11"
        :class="chosen.includes(ty.id) ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-700 hover:bg-surface-subtle'"
        data-cy="type-assign-option"
        @click="toggle(ty.id)"
      >
        <span class="h-2 w-2 rounded-full" :style="{ background: PATIENT_TYPE_DOT[ty.color] }" aria-hidden="true" />
        {{ ty.name }}
      </button>
    </div>
    <p v-if="mode === 'add' && bringsSomething" class="rounded-ctl bg-brand-tint px-3 py-2 text-[12.5px] text-brand-text">
      {{ t('The exercises and schedule this type brings are assigned too, without repeating what they already have.', 'También se asignan los ejercicios y la pauta que trae el tipo, sin repetir lo que ya tengan.') }}
    </p>
    <label v-if="mode === 'remove'" class="flex items-start gap-2 text-[13px] text-ink-700">
      <input v-model="endExercises" type="checkbox" class="mt-0.5 h-4 w-4 accent-brand" data-cy="type-assign-end-exercises" />
      <span>
        {{ t('Also end the exercises this type brought', 'Finalizar también los ejercicios que trajo este tipo') }}
        <span class="block text-[12px] text-ink-faint">{{ t('Exercises added by hand stay.', 'Los añadidos a mano se quedan.') }}</span>
      </span>
    </label>
    <p v-if="error" role="alert" class="text-[12.5px] font-semibold text-danger-text">{{ error }}</p>
  </UiConfirmDialog>
</template>

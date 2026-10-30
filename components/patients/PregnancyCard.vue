<script setup lang="ts">
import type { Tables } from '~/types/database.types'
import { clinicDateOf, DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'

import { pregnancyProgress, pregnancyWeeksLabel } from '~/utils/pregnancy'

// Pregnancy on the patient's Overview: weeks + days, the trimester, a bar
// along the 40 weeks, the due date, twins or more, and a note. Only the due
// date is stored (20261021062333_patient_pregnancy.sql); the rest is counted
// from it, so it is right whichever day the record is opened.
//
// Recording, editing and ending one need patients_edit, like the rest of the
// record. With no pregnancy recorded the card is a single "Record a
// pregnancy" link, so it costs the many patients it does not apply to one
// line.
const props = defineProps<{ patient: Tables<'patients'> }>()
const emit = defineEmits<{ updated: [] }>()

const supabase = useSupabaseClient()
const t = useT()
const { formatLongDate } = useDates()
const { can } = usePermission()
const { showToast } = useToast()

// Day granularity in the clinics' zone: every clinic is in Spain today.
const today = computed(() => clinicDateOf(new Date(), DEFAULT_CLINIC_TIMEZONE))
const progress = computed(() => (props.patient.pregnancy_due_date ? pregnancyProgress(props.patient.pregnancy_due_date, today.value) : null))

const editing = ref(false)
const dueDate = ref('')
const multiples = ref<number | null>(null)
const notes = ref('')
const saving = ref(false)

function startEditing() {
  dueDate.value = props.patient.pregnancy_due_date ?? ''
  multiples.value = props.patient.pregnancy_multiples
  notes.value = props.patient.pregnancy_notes ?? ''
  editing.value = true
}

async function write(values: { pregnancy_due_date: string | null; pregnancy_multiples: number | null; pregnancy_notes: string | null }, done: string) {
  saving.value = true
  const { error } = await supabase.from('patients').update(values).eq('id', props.patient.id).select('id').single()
  saving.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  editing.value = false
  showToast(done)
  emit('updated')
}

function save() {
  if (!dueDate.value) {
    showToast(t('A due date is needed.', 'Hace falta la fecha prevista de parto.'), 'error')
    return
  }
  write({ pregnancy_due_date: dueDate.value, pregnancy_multiples: multiples.value, pregnancy_notes: notes.value.trim() || null }, t('Pregnancy saved', 'Embarazo guardado'))
}
function end() {
  write({ pregnancy_due_date: null, pregnancy_multiples: null, pregnancy_notes: null }, t('Pregnancy ended', 'Embarazo finalizado'))
}

const TRIMESTER = computed(() => ({
  1: t('1st trimester', '1.er trimestre'),
  2: t('2nd trimester', '2.º trimestre'),
  3: t('3rd trimester', '3.er trimestre'),
}))
const multiplesLabel = (n: number) => (n === 2 ? t('Twins', 'Gemelos') : n === 3 ? t('Triplets', 'Trillizos') : t(`${n} babies`, `${n} bebés`))
const inputClass = 'h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-2.5 text-[14px] text-ink-900 focus:border-brand focus:outline-none'
</script>

<template>
  <section v-if="progress || editing" aria-labelledby="ov-pregnancy" class="rounded-card border border-line bg-surface p-4 shadow-card" data-cy="pregnancy-card">
    <div class="flex items-center justify-between gap-2">
      <h2 id="ov-pregnancy" class="text-[13.5px] font-semibold text-ink-700">{{ t('Pregnancy', 'Embarazo') }}</h2>
      <button v-if="progress && !editing && can('patients_edit')" type="button" class="text-[12.5px] font-medium text-brand-text hover:underline" data-cy="pregnancy-edit" @click="startEditing">{{ t('Edit', 'Editar') }}</button>
    </div>

    <template v-if="!editing && progress">
      <p class="mt-2 flex items-baseline gap-2">
        <span class="font-mono text-[20px] font-semibold text-ink-900" data-cy="pregnancy-weeks">{{ pregnancyWeeksLabel(progress, t) }}</span>
        <span class="text-[13px] text-ink-muted">{{ TRIMESTER[progress.trimester] }}</span>
        <UiPill v-if="patient.pregnancy_multiples" tone="neutral">{{ multiplesLabel(patient.pregnancy_multiples) }}</UiPill>
      </p>
      <!-- Three segments, one per trimester, filled to today. -->
      <div class="mt-2 flex h-2 gap-0.5 overflow-hidden rounded-full" role="progressbar" :aria-valuenow="Math.round(progress.fraction * 100)" aria-valuemin="0" aria-valuemax="100" :aria-label="t('Weeks of pregnancy', 'Semanas de embarazo')">
        <div v-for="(span, i) in [[0, 14], [14, 28], [28, 40]]" :key="i" class="relative h-full bg-chip-bg" :style="{ flex: `${span[1]! - span[0]!} 1 0` }">
          <div class="absolute inset-y-0 left-0 bg-brand" :style="{ width: `${Math.max(0, Math.min(1, (progress.weeks + progress.days / 7 - span[0]!) / (span[1]! - span[0]!))) * 100}%` }" />
        </div>
      </div>
      <p class="mt-2 text-[12.5px] text-ink-muted" data-cy="pregnancy-due">
        {{ t('Due', 'Fecha prevista') }} {{ formatLongDate(patient.pregnancy_due_date!) }}
        · <template v-if="progress.daysToDue > 0">{{ t(`in ${progress.daysToDue} days`, `en ${progress.daysToDue} días`) }}</template>
        <template v-else-if="progress.daysToDue === 0">{{ t('today', 'hoy') }}</template>
        <template v-else>{{ t(`${-progress.daysToDue} days past`, `hace ${-progress.daysToDue} días`) }}</template>
      </p>
      <p v-if="patient.pregnancy_notes" class="mt-2 whitespace-pre-line text-[13px] text-ink-700">{{ patient.pregnancy_notes }}</p>
    </template>

    <form v-else class="mt-3 flex flex-col gap-2.5" @submit.prevent="save">
      <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-600">
        {{ t('Due date', 'Fecha prevista de parto') }}
        <input v-model="dueDate" type="date" data-cy="pregnancy-due-input" :class="inputClass" />
      </label>
      <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-600">
        {{ t('Babies', 'Bebés') }}
        <select v-model="multiples" data-cy="pregnancy-multiples" :class="inputClass">
          <option :value="null">{{ t('One', 'Uno') }}</option>
          <option :value="2">{{ t('Twins', 'Gemelos') }}</option>
          <option :value="3">{{ t('Triplets', 'Trillizos') }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-600">
        {{ t('Note', 'Nota') }}
        <textarea v-model="notes" rows="2" maxlength="1000" data-cy="pregnancy-notes" class="resize-y rounded-ctl border border-line-control bg-surface px-2.5 py-2 text-[14px] text-ink-900 focus:border-brand focus:outline-none" />
      </label>
      <div class="flex flex-wrap items-center gap-2">
        <UiBtn variant="primary" :disabled="saving" data-cy="pregnancy-save" @click="save">{{ t('Save', 'Guardar') }}</UiBtn>
        <UiBtn variant="ghost" type="button" @click="editing = false">{{ t('Cancel', 'Cancelar') }}</UiBtn>
        <button v-if="progress" type="button" class="ml-auto text-[12.5px] font-medium text-danger-text hover:underline" :disabled="saving" data-cy="pregnancy-end" @click="end">{{ t('End pregnancy', 'Finalizar embarazo') }}</button>
      </div>
    </form>
  </section>
  <button
    v-else-if="can('patients_edit') && !patient.is_minor && patient.gender !== 'male'"
    type="button"
    class="self-start text-[12.5px] font-medium text-brand-text hover:underline"
    data-cy="pregnancy-record"
    @click="startEditing"
  >
    + {{ t('Record a pregnancy', 'Registrar embarazo') }}
  </button>
</template>

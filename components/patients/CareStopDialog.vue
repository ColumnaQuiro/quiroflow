<script setup lang="ts">
import type { CareStop, CareStopReason } from '~/composables/useCareStopReasons'

// Record, change or clear why a patient stopped care -- from their record
// (CareStopCard) and from Recalls > Dismissed. record_care_stop updates the
// current stop or starts a new one (20261022171626); clearing deletes it.
const props = defineProps<{ patientId: string; patientName: string; reasons: CareStopReason[]; current: CareStop | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const supabase = useSupabaseClient()
const t = useT()
const { showToast } = useToast()

const reasonId = ref(props.current?.reason_id ?? '')
const note = ref(props.current?.note ?? '')
const busy = ref(false)

async function save() {
  if (!reasonId.value) return
  busy.value = true
  const { error } = await supabase.rpc('record_care_stop', { p_patient_ids: [props.patientId], p_reason_id: reasonId.value, p_note: note.value })
  busy.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  showToast(t('Reason recorded.', 'Motivo registrado.'))
  emit('saved')
}
async function clear() {
  if (!props.current) return
  busy.value = true
  const { error } = await supabase.from('patient_care_stops').delete().eq('id', props.current.id)
  busy.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  showToast(t('Reason cleared.', 'Motivo quitado.'))
  emit('saved')
}
</script>

<template>
  <UiConfirmDialog
    :title="t(`Why did ${patientName} stop coming?`, `¿Por qué ha dejado de venir ${patientName}?`)"
    :confirm-label="t('Save', 'Guardar')"
    :cancel-label="t('Cancel', 'Cancelar')"
    :busy="busy"
    :disabled="!reasonId"
    @confirm="save"
    @cancel="emit('close')"
  >
    <p class="text-[13.5px] leading-snug text-ink-500">{{ t('Only what they told you. It counts in Reports › Retention, and stops applying if they come back.', 'Solo lo que te haya dicho. Cuenta en Informes › Retención, y deja de aplicarse si vuelve.') }}</p>
    <PatientsCareStopFields v-model:reason-id="reasonId" v-model:note="note" :reasons="reasons" />
    <button v-if="current" type="button" class="self-start text-[13px] font-semibold text-danger-text hover:underline disabled:opacity-50" :disabled="busy" data-cy="care-stop-clear" @click="clear">
      {{ t('Clear the reason', 'Quitar el motivo') }}
    </button>
  </UiConfirmDialog>
</template>

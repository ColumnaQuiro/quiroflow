<script setup lang="ts">
import type { PatientAppointmentRow } from '../../composables/usePatientAppointments'

// "Confirmar asistencia" on an upcoming visit, in the app and the portal --
// or "Asistencia confirmada" once it is. Offered for a booked visit in the
// next CONFIRM_WITHIN_DAYS days, which is when the clinic's reminder goes
// out and asks; a visit months away is not worth confirming yet.
const CONFIRM_WITHIN_DAYS = 7

const props = defineProps<{ appt: PatientAppointmentRow; busy: boolean }>()
const emit = defineEmits<{ confirm: [appt: PatientAppointmentRow] }>()
const t = useT()

const soon = computed(() => new Date(props.appt.starts_at).getTime() - Date.now() < CONFIRM_WITHIN_DAYS * 86_400_000)
</script>

<template>
  <span v-if="appt.confirmation_status === 'confirmed'" class="inline-flex items-center gap-1 rounded-pill bg-success-bg px-2.5 py-1 text-[12px] font-semibold text-success-text" data-cy="patient-visit-confirmed">
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
    {{ t('Attendance confirmed', 'Asistencia confirmada') }}
  </span>
  <button
    v-else-if="appt.status === 'booked' && soon"
    type="button"
    class="min-h-9 rounded-ctl bg-brand px-3 text-[12.5px] font-semibold text-white disabled:opacity-60"
    :disabled="busy"
    data-cy="patient-confirm-visit"
    @click="emit('confirm', appt)"
  >
    {{ busy ? t('Confirming…', 'Confirmando…') : t("Confirm I'm coming", 'Confirmar asistencia') }}
  </button>
</template>

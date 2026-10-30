<script setup lang="ts">
import { canSelfCheckIn } from '../../utils/selfCheckIn'

// "Ya estoy aquí" on the day of a visit, in the app and the portal: the
// patient tells the clinic they have arrived (check_in_my_appointment, via
// /api/portal/appointments/check-in), the practitioner gets "Ha llegado" and
// the visit shows as arrived on My Day. Only from 90 minutes before the visit
// until it ends (utils/selfCheckIn.ts); once done it says so instead, and
// asks for today's pain (PatientPainAsk).
const props = defineProps<{ appt: { id: string; starts_at: string; ends_at: string; status: string; checked_in_at?: string | null } }>()
const emit = defineEmits<{ 'checked-in': [at: string] }>()

const t = useT()
const authedFetch = useAuthedFetch()
const busy = ref(false)
const error = ref('')
const arrivedAt = ref<string | null>(props.appt.checked_in_at ?? null)
// Re-read every minute, so the button appears on its own as the time comes.
const now = ref(new Date())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => (timer = setInterval(() => (now.value = new Date()), 60_000)))
onBeforeUnmount(() => clearInterval(timer))
const open = computed(() => !arrivedAt.value && canSelfCheckIn(props.appt, now.value))

async function checkIn() {
  busy.value = true
  error.value = ''
  try {
    const r = await authedFetch<{ checkedInAt: string }>('/api/portal/appointments/check-in', { method: 'POST', body: { appointmentId: props.appt.id } })
    arrivedAt.value = r.checkedInAt
    emit('checked-in', r.checkedInAt)
  } catch {
    error.value = t("Couldn't check you in. Tell the front desk you're here.", 'No se ha podido registrar tu llegada. Avisa en recepción.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="arrivedAt">
    <div class="flex items-center gap-2 rounded-ctl bg-success-bg px-3 py-2.5 text-[13.5px] font-medium text-success-text" data-cy="patient-checked-in">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      {{ t("You're checked in. Take a seat, we'll call you.", 'Llegada registrada. Toma asiento, te llamamos.') }}
    </div>
    <PatientPainAsk class="mt-3" :appointment-id="appt.id" />
  </div>
  <div v-else-if="open">
    <button type="button" class="flex min-h-11 w-full items-center justify-center gap-2 rounded-ctl bg-brand px-4 text-[15px] font-semibold text-brand-on disabled:opacity-60" :disabled="busy" data-cy="patient-check-in" @click="checkIn">
      {{ busy ? t('Checking in…', 'Registrando…') : t("I'm here", 'Ya estoy aquí') }}
    </button>
    <p v-if="error" role="alert" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
  </div>
</template>

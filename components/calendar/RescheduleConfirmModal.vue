<script setup lang="ts">
import { formatEur, formatTime } from '~/utils/billing'
import type { Tables } from '~/types/database.types'

const props = defineProps<{
  appointmentId: string
  patientId: string
  patientName: string
  appointmentTypeName: string | null
  origStartsAt: string
  newStartsAt: string
}>()

const emit = defineEmits<{ close: []; confirm: [payload: { reasonId: string | null; note: string; applyFee: boolean; resendConfirmation: boolean }] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

// A modal dialog: focus stays inside it, Escape closes it, and focus goes
// back to whatever opened it (useFocusTrap).
const dialogPanel = ref<HTMLElement | null>(null)
const dialogTitleId = useId()
useFocusTrap(dialogPanel, () => emit('close'))

const reasons = ref<Tables<'reschedule_reasons'>[]>([])
const reasonId = ref('')
const note = ref('')
const applyFee = ref(false)
const resendConfirmation = ref(true)
const confirming = ref(false)

interface NearbyAppointment { starts_at: string }
const nearbyAppointment = ref<NearbyAppointment | null>(null)

onMounted(async () => {
  const [{ data: reasonRows }, { data: future }, { data: past }] = await Promise.all([
    supabase.from('reschedule_reasons').select('*').order('name'),
    supabase
      .from('appointments')
      .select('starts_at')
      .eq('patient_id', props.patientId)
      .neq('id', props.appointmentId)
      .neq('status', 'cancelled')
      .gt('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('appointments')
      .select('starts_at')
      .eq('patient_id', props.patientId)
      .neq('id', props.appointmentId)
      .neq('status', 'cancelled')
      .lte('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  reasons.value = reasonRows ?? []

  const now = Date.now()
  const candidates = [future, past].filter((c): c is NearbyAppointment => !!c)
  candidates.sort((a, b) => Math.abs(new Date(a.starts_at).getTime() - now) - Math.abs(new Date(b.starts_at).getTime() - now))
  nearbyAppointment.value = candidates[0] ?? null
})

// "Thursday 1 October 2026, 10:00" / "jueves, 1 de octubre de 2026, 10:00",
// in the staff member's language, with the clinic's 24-hour times.
function formatFullDate(iso: string) {
  const day = new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return `${day}, ${formatTime(iso)}`
}
function relativeLabel(iso: string) {
  const diffMs = new Date(iso).getTime() - Date.now()
  const future = diffMs > 0
  const abs = Math.abs(diffMs)
  const minutes = Math.round(abs / 60000)
  const hours = Math.round(abs / 3600000)
  const days = Math.round(abs / 86400000)
  let magEn: string
  let magEs: string
  if (minutes < 60) {
    magEn = `${minutes} minute${minutes === 1 ? '' : 's'}`
    magEs = `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`
  } else if (hours < 24) {
    magEn = `${hours} hour${hours === 1 ? '' : 's'}`
    magEs = `${hours} ${hours === 1 ? 'hora' : 'horas'}`
  } else {
    magEn = `${days} day${days === 1 ? '' : 's'}`
    magEs = `${days} ${days === 1 ? 'día' : 'días'}`
  }
  const text = future ? t(`in ${magEn}`, `en ${magEs}`) : t(`${magEn} ago`, `hace ${magEs}`)
  return { future, text }
}

const nearbyLabel = computed(() => {
  if (!nearbyAppointment.value) return null
  const { future, text } = relativeLabel(nearbyAppointment.value.starts_at)
  const dateStr = formatFullDate(nearbyAppointment.value.starts_at)
  return future
    ? t(`Their next appointment: ${dateStr} (${text})`, `Su próxima cita: ${dateStr} (${text})`)
    : t(`Their last appointment: ${dateStr} (${text})`, `Su última cita: ${dateStr} (${text})`)
})

async function confirmMove() {
  confirming.value = true
  emit('confirm', { reasonId: reasonId.value || null, note: note.value.trim(), applyFee: applyFee.value, resendConfirmation: resendConfirmation.value })
}

// Ties each visible <label> to the field under it (for/id), so a screen
// reader announces the field by its name.
const fieldId = useId()
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-scrim/30 p-4" @click.self="emit('close')">
    <div ref="dialogPanel" role="dialog" aria-modal="true" :aria-labelledby="dialogTitleId" class="max-h-full w-full overflow-y-auto max-w-md rounded-card border border-line bg-surface p-6 shadow-popover">
      <div class="flex items-center justify-between">
        <h2 :id="dialogTitleId" class="text-[16px] font-[640] text-ink-900">{{ t('Reschedule appointment', 'Reprogramar la cita') }}</h2>
        <button type="button" :aria-label="t('Close', 'Cerrar')" class="text-ink-faint hover:text-ink-600 -m-2 p-2 touch:-m-3 touch:p-3" @click="emit('close')">✕</button>
      </div>

      <div class="mt-4 space-y-1 text-[13px]">
        <p><span class="font-semibold text-ink-900">{{ t('Patient:', 'Paciente:') }}</span> {{ patientName }}</p>
        <p><span class="font-semibold text-ink-900">{{ t('Booked for:', 'Reservada para:') }}</span> {{ formatFullDate(origStartsAt) }}</p>
        <p v-if="appointmentTypeName"><span class="font-semibold text-ink-900">{{ t('Type:', 'Tipo:') }}</span> {{ appointmentTypeName }}</p>
      </div>

      <div v-if="nearbyLabel" class="mt-4 rounded-ctl bg-success-bg px-3 py-2 text-[13px] font-medium text-success-text">
        {{ nearbyLabel }}
      </div>

      <p class="mt-4 text-[13px] text-ink-600">
        {{ t('Move it to', 'Moverla a') }}<br />
        <span class="font-semibold text-ink-900">{{ formatFullDate(newStartsAt) }}</span>
      </p>

      <div class="mt-4">
        <label :for="`${fieldId}-reasonId`" class="block text-[12.5px] font-medium text-ink-600">{{ t('Reason (optional)', 'Motivo (opcional)') }}</label>
        <select :id="`${fieldId}-reasonId`" v-model="reasonId" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none">
          <option value="">{{ t('No reason given', 'Sin motivo') }}</option>
          <option v-for="r in reasons" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </div>

      <div class="mt-4">
        <label :for="`${fieldId}-note`" class="block text-[12.5px] font-medium text-ink-600">{{ t('Note (optional)', 'Nota (opcional)') }}</label>
        <textarea :id="`${fieldId}-note`"
          v-model="note"
          rows="2"
          :placeholder="t('Anything worth remembering about the change…', 'Algo que convenga recordar del cambio…')"
          class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none"
        />
      </div>

      <label v-if="store.schedulingPolicyFeeCents" class="mt-4 flex items-center gap-2 text-[13px] text-ink-600">
        <input v-model="applyFee" type="checkbox" class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand" />
        {{ t('Add the reschedule fee to their balance', 'Añadir el cargo por reprogramación a su saldo') }} ({{ formatEur(store.schedulingPolicyFeeCents) }})
      </label>

      <label class="mt-2 flex items-center gap-2 text-[13px] text-ink-600">
        <input v-model="resendConfirmation" type="checkbox" class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand" />
        {{ t('Tell the patient the new time (your “Appointment rescheduled” automations)', 'Avisar al paciente de la nueva hora (tus automatizaciones de «Cita reprogramada»)') }}
      </label>

      <div class="mt-5 flex justify-end gap-2">
        <UiBtn variant="secondary" :disabled="confirming" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</UiBtn>
        <UiBtn variant="primary" :disabled="confirming" @click="confirmMove">{{ confirming ? t('Moving…', 'Moviendo…') : t('Move appointment', 'Mover la cita') }}</UiBtn>
      </div>
    </div>
  </div>
</template>

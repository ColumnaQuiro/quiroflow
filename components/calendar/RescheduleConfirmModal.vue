<script setup lang="ts">
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

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
function formatFullDate(iso: string) {
  const d = new Date(iso)
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' })
  const month = d.toLocaleDateString('en-US', { month: 'short' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '')
  return `${weekday} ${month} ${ordinal(d.getDate())} ${d.getFullYear()} @ ${time}`
}
function relativeLabel(iso: string) {
  const diffMs = new Date(iso).getTime() - Date.now()
  const future = diffMs > 0
  const abs = Math.abs(diffMs)
  const minutes = Math.round(abs / 60000)
  const hours = Math.round(abs / 3600000)
  const days = Math.round(abs / 86400000)
  let mag: string
  if (minutes < 60) mag = `${minutes} minute${minutes === 1 ? '' : 's'}`
  else if (hours < 24) mag = `${hours} hour${hours === 1 ? '' : 's'}`
  else mag = `${days} day${days === 1 ? '' : 's'}`
  return { future, text: future ? `in ${mag}` : `${mag} ago` }
}

const nearbyLabel = computed(() => {
  if (!nearbyAppointment.value) return null
  const { future, text } = relativeLabel(nearbyAppointment.value.starts_at)
  return `${future ? 'Next' : 'Last'} appointment - ${formatFullDate(nearbyAppointment.value.starts_at)} (${text})`
})

async function confirmMove() {
  confirming.value = true
  emit('confirm', { reasonId: reasonId.value || null, note: note.value.trim(), applyFee: applyFee.value, resendConfirmation: resendConfirmation.value })
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/30 p-4" @click.self="emit('close')">
    <div class="w-full max-w-md rounded-card border border-line bg-surface p-6 shadow-popover">
      <div class="flex items-center justify-between">
        <h2 class="text-[16px] font-[640] text-ink-900">Rescheduling Appointment</h2>
        <button type="button" class="text-ink-faint hover:text-ink-600" @click="emit('close')">✕</button>
      </div>

      <div class="mt-4 space-y-1 text-[13px]">
        <p><span class="font-semibold text-ink-900">Patient Name:</span> {{ patientName }}</p>
        <p><span class="font-semibold text-ink-900">Appt Date:</span> {{ formatFullDate(origStartsAt) }}</p>
        <p v-if="appointmentTypeName"><span class="font-semibold text-ink-900">Appt Type:</span> {{ appointmentTypeName }}</p>
      </div>

      <div v-if="nearbyLabel" class="mt-4 rounded-ctl bg-success-bg px-3 py-2 text-[13px] font-medium text-success-text">
        {{ nearbyLabel }}
      </div>

      <p class="mt-4 text-[13px] text-ink-600">
        Please confirm you wish to move the appointment to<br />
        <span class="font-semibold text-ink-900">{{ formatFullDate(newStartsAt) }}</span>
      </p>

      <div class="mt-4">
        <label class="block text-[12.5px] font-medium text-ink-600">Reason</label>
        <select v-model="reasonId" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none">
          <option value="">Select a reason</option>
          <option v-for="r in reasons" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </div>

      <div class="mt-4">
        <label class="block text-[12.5px] font-medium text-ink-600">Note</label>
        <textarea
          v-model="note"
          rows="2"
          placeholder="Optional note about the change…"
          class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none"
        />
      </div>

      <label v-if="store.schedulingPolicyFeeCents" class="mt-4 flex items-center gap-2 text-[13px] text-ink-600">
        <input v-model="applyFee" type="checkbox" class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand" />
        Apply a scheduling policy fee to patient file (€{{ (store.schedulingPolicyFeeCents / 100).toFixed(2) }})
      </label>

      <label class="mt-2 flex items-center gap-2 text-[13px] text-ink-600">
        <input v-model="resendConfirmation" type="checkbox" class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand" />
        Resend confirmation (if enabled)
      </label>

      <div class="mt-5 flex justify-end gap-2">
        <UiBtn variant="secondary" :disabled="confirming" @click="emit('close')">Cancel</UiBtn>
        <UiBtn variant="primary" :disabled="confirming" @click="confirmMove">{{ confirming ? 'Confirming…' : 'Confirm' }}</UiBtn>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computePresetRange, rangeBounds } from '~/composables/useDateRangePresets'
import { fetchAllRows } from '~/composables/useFetchAllRows'

interface WhatsappMessageRow {
  id: string
  patient_id: string | null
  status: string
  purpose: string | null
  error_code: string | null
  error_message: string | null
  created_at: string
}
interface AppointmentRow {
  id: string
  patient_id: string
  starts_at: string
  confirmation_status: string | null
  status: string
}
interface PatientRow { id: string; first_name: string; last_name: string | null }

const supabase = useSupabaseClient()

const range = ref(computePresetRange({ months: 1 }))
const loading = ref(true)
const messages = ref<WhatsappMessageRow[]>([])
const appointments = ref<AppointmentRow[]>([])
const patients = ref<PatientRow[]>([])

async function load() {
  loading.value = true
  const { from, to } = rangeBounds(range.value)

  const [msgs, appts, pts] = await Promise.all([
    fetchAllRows<WhatsappMessageRow>((f, t) =>
      supabase
        .from('whatsapp_messages')
        .select('id, patient_id, status, purpose, error_code, error_message, created_at')
        .eq('direction', 'outbound')
        .gte('created_at', from.toISOString())
        .lte('created_at', to.toISOString())
        .range(f, t),
    ),
    fetchAllRows<AppointmentRow>((f, t) =>
      supabase
        .from('appointments')
        .select('id, patient_id, starts_at, confirmation_status, status')
        .eq('status', 'booked')
        .gte('starts_at', new Date().toISOString())
        .not('confirmation_status', 'is', null)
        .range(f, t),
    ),
    fetchAllRows<PatientRow>((f, t) => supabase.from('patients').select('id, first_name, last_name').range(f, t)),
  ])
  messages.value = msgs
  appointments.value = appts
  patients.value = pts
  loading.value = false
}
onMounted(load)
watch(range, load)

const patientById = computed(() => new Map(patients.value.map((p) => [p.id, `${p.first_name} ${p.last_name ?? ''}`.trim()])))

const byStatus = computed(() => {
  const counts = { sent: 0, delivered: 0, read: 0, failed: 0 }
  for (const m of messages.value) {
    if (m.status in counts) counts[m.status as keyof typeof counts]++
  }
  return counts
})
const failedMessages = computed(() =>
  messages.value.filter((m) => m.status === 'failed').sort((a, b) => b.created_at.localeCompare(a.created_at)),
)

function failureReason(m: WhatsappMessageRow) {
  if (m.error_message) return m.error_message
  if (m.error_code) return `Error code ${m.error_code}`
  return 'Unknown error'
}

const confirmed = computed(() => appointments.value.filter((a) => a.confirmation_status === 'confirmed'))
const pending = computed(() => appointments.value.filter((a) => a.confirmation_status === 'pending'))
const rescheduleRequested = computed(() => appointments.value.filter((a) => a.confirmation_status === 'reschedule_requested'))

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Scheduled Reminders</h1>
      <NuxtLink to="/reports" class="text-sm text-gray-500 hover:text-gray-700">&larr; Reports</NuxtLink>
    </div>
    <p class="mt-1 text-sm text-gray-500">Did every WhatsApp actually send, and who has confirmed, is pending, or asked to reschedule.</p>

    <div class="mt-4">
      <ReportsDateRangeSelect v-model="range" />
    </div>

    <div v-if="loading" class="mt-6 text-sm text-gray-400">Loading…</div>

    <template v-else>
      <div class="mt-4 rounded-lg border border-gray-200 bg-white p-4">
        <h3 class="text-sm font-semibold text-gray-900">WhatsApp delivery status</h3>
        <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div class="rounded-md bg-gray-50 p-3 text-center">
            <p class="text-2xl font-semibold text-gray-900">{{ byStatus.sent }}</p>
            <p class="text-xs text-gray-500">Sent</p>
          </div>
          <div class="rounded-md bg-gray-50 p-3 text-center">
            <p class="text-2xl font-semibold text-gray-900">{{ byStatus.delivered }}</p>
            <p class="text-xs text-gray-500">Delivered</p>
          </div>
          <div class="rounded-md bg-gray-50 p-3 text-center">
            <p class="text-2xl font-semibold text-gray-900">{{ byStatus.read }}</p>
            <p class="text-xs text-gray-500">Read</p>
          </div>
          <div class="rounded-md p-3 text-center" :class="byStatus.failed > 0 ? 'bg-red-50' : 'bg-gray-50'">
            <p class="text-2xl font-semibold" :class="byStatus.failed > 0 ? 'text-red-700' : 'text-gray-900'">{{ byStatus.failed }}</p>
            <p class="text-xs" :class="byStatus.failed > 0 ? 'text-red-600' : 'text-gray-500'">Failed</p>
          </div>
        </div>

        <div v-if="failedMessages.length > 0" class="mt-4">
          <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Failed sends — bad number or no WhatsApp account</p>
          <ul class="mt-2 divide-y divide-gray-100 text-sm">
            <li v-for="m in failedMessages" :key="m.id" class="flex items-center justify-between py-1.5">
              <NuxtLink v-if="m.patient_id" :to="`/patients/${m.patient_id}`" class="text-gray-700 hover:text-indigo-600">
                {{ patientById.get(m.patient_id) ?? 'Unknown patient' }}
              </NuxtLink>
              <span v-else class="text-gray-400">Unknown patient</span>
              <span class="text-xs text-red-600">{{ failureReason(m) }}</span>
            </li>
          </ul>
        </div>
        <p v-if="messages.length === 0" class="mt-3 text-sm text-gray-400">No WhatsApp messages sent in this range yet.</p>
      </div>

      <div class="mt-4 rounded-lg border border-gray-200 bg-white p-4">
        <h3 class="text-sm font-semibold text-gray-900">Appointment confirmations</h3>
        <p class="text-xs text-gray-400">Only counts appointments that had a confirmation message sent — requires the WhatsApp reply webhook to be configured (Settings &rarr; WhatsApp).</p>

        <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="rounded-md bg-green-50 p-3">
            <p class="text-xs font-medium uppercase tracking-wide text-green-700">Confirmed ({{ confirmed.length }})</p>
            <ul class="mt-1 max-h-40 space-y-1 overflow-y-auto text-sm">
              <li v-for="a in confirmed" :key="a.id">
                <NuxtLink :to="`/patients/${a.patient_id}`" class="text-gray-700 hover:text-indigo-600">{{ patientById.get(a.patient_id) }}</NuxtLink>
                <span class="text-xs text-gray-400"> — {{ fmt(a.starts_at) }}</span>
              </li>
            </ul>
          </div>
          <div class="rounded-md bg-amber-50 p-3">
            <p class="text-xs font-medium uppercase tracking-wide text-amber-700">Pending ({{ pending.length }})</p>
            <ul class="mt-1 max-h-40 space-y-1 overflow-y-auto text-sm">
              <li v-for="a in pending" :key="a.id">
                <NuxtLink :to="`/patients/${a.patient_id}`" class="text-gray-700 hover:text-indigo-600">{{ patientById.get(a.patient_id) }}</NuxtLink>
                <span class="text-xs text-gray-400"> — {{ fmt(a.starts_at) }}</span>
              </li>
            </ul>
          </div>
          <div class="rounded-md bg-red-50 p-3">
            <p class="text-xs font-medium uppercase tracking-wide text-red-700">Wants to reschedule ({{ rescheduleRequested.length }})</p>
            <ul class="mt-1 max-h-40 space-y-1 overflow-y-auto text-sm">
              <li v-for="a in rescheduleRequested" :key="a.id">
                <NuxtLink :to="`/patients/${a.patient_id}`" class="text-gray-700 hover:text-indigo-600">{{ patientById.get(a.patient_id) }}</NuxtLink>
                <span class="text-xs text-gray-400"> — {{ fmt(a.starts_at) }}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

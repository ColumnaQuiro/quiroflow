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
  <div class="flex h-full flex-col">
    <PageHeader title="Scheduled Reminders" meta="WhatsApp delivery and confirmation status">
      <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; Reports</NuxtLink>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <p class="text-[13px] text-ink-muted2">Did every WhatsApp actually send, and who has confirmed, is pending, or asked to reschedule.</p>

      <div class="mt-4">
        <ReportsDateRangeSelect v-model="range" />
      </div>

      <div v-if="loading" class="mt-6 text-[13px] text-ink-faint2">Loading…</div>

      <template v-else>
        <div class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
          <h3 class="text-[13.5px] font-semibold text-ink-800">WhatsApp delivery status</h3>
          <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div class="rounded-ctl bg-surface-subtle p-3 text-center">
              <p class="font-mono text-[23px] font-semibold text-ink-900">{{ byStatus.sent }}</p>
              <p class="text-[12px] text-ink-muted2">Sent</p>
            </div>
            <div class="rounded-ctl bg-surface-subtle p-3 text-center">
              <p class="font-mono text-[23px] font-semibold text-ink-900">{{ byStatus.delivered }}</p>
              <p class="text-[12px] text-ink-muted2">Delivered</p>
            </div>
            <div class="rounded-ctl bg-surface-subtle p-3 text-center">
              <p class="font-mono text-[23px] font-semibold text-ink-900">{{ byStatus.read }}</p>
              <p class="text-[12px] text-ink-muted2">Read</p>
            </div>
            <div class="rounded-ctl p-3 text-center" :class="byStatus.failed > 0 ? 'bg-danger-bg' : 'bg-surface-subtle'">
              <p class="font-mono text-[23px] font-semibold" :class="byStatus.failed > 0 ? 'text-danger-text' : 'text-ink-900'">{{ byStatus.failed }}</p>
              <p class="text-[12px]" :class="byStatus.failed > 0 ? 'text-danger-text' : 'text-ink-muted2'">Failed</p>
            </div>
          </div>

          <div v-if="failedMessages.length > 0" class="mt-4">
            <p class="text-[11px] font-medium uppercase tracking-wide text-ink-muted2">Failed sends — bad number or no WhatsApp account</p>
            <ul class="mt-2 divide-y divide-line-row text-[13px]">
              <li v-for="m in failedMessages" :key="m.id" class="flex items-center justify-between py-1.5">
                <NuxtLink v-if="m.patient_id" :to="`/patients/${m.patient_id}`" class="text-ink-600 hover:text-brand-text">
                  {{ patientById.get(m.patient_id) ?? 'Unknown patient' }}
                </NuxtLink>
                <span v-else class="text-ink-faint2">Unknown patient</span>
                <span class="text-[12px] text-danger-text">{{ failureReason(m) }}</span>
              </li>
            </ul>
          </div>
          <p v-if="messages.length === 0" class="mt-3 text-[13px] text-ink-faint2">No WhatsApp messages sent in this range yet.</p>
        </div>

        <div class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
          <h3 class="text-[13.5px] font-semibold text-ink-800">Appointment confirmations</h3>
          <p class="text-[12px] text-ink-faint2">Only counts appointments that had a confirmation message sent — requires the WhatsApp reply webhook to be configured (Settings &rarr; WhatsApp).</p>

          <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div class="rounded-ctl bg-success-bg p-3">
              <p class="text-[11px] font-medium uppercase tracking-wide text-success-text">Confirmed ({{ confirmed.length }})</p>
              <ul class="mt-1 max-h-40 space-y-1 overflow-y-auto text-[13px]">
                <li v-for="a in confirmed" :key="a.id">
                  <NuxtLink :to="`/patients/${a.patient_id}`" class="text-ink-600 hover:text-brand-text">{{ patientById.get(a.patient_id) }}</NuxtLink>
                  <span class="text-[12px] text-ink-faint2"> — {{ fmt(a.starts_at) }}</span>
                </li>
              </ul>
            </div>
            <div class="rounded-ctl bg-warning-bg p-3">
              <p class="text-[11px] font-medium uppercase tracking-wide text-warning-text">Pending ({{ pending.length }})</p>
              <ul class="mt-1 max-h-40 space-y-1 overflow-y-auto text-[13px]">
                <li v-for="a in pending" :key="a.id">
                  <NuxtLink :to="`/patients/${a.patient_id}`" class="text-ink-600 hover:text-brand-text">{{ patientById.get(a.patient_id) }}</NuxtLink>
                  <span class="text-[12px] text-ink-faint2"> — {{ fmt(a.starts_at) }}</span>
                </li>
              </ul>
            </div>
            <div class="rounded-ctl bg-info-bg p-3">
              <p class="text-[11px] font-medium uppercase tracking-wide text-info-text">Wants to reschedule ({{ rescheduleRequested.length }})</p>
              <ul class="mt-1 max-h-40 space-y-1 overflow-y-auto text-[13px]">
                <li v-for="a in rescheduleRequested" :key="a.id">
                  <NuxtLink :to="`/patients/${a.patient_id}`" class="text-ink-600 hover:text-brand-text">{{ patientById.get(a.patient_id) }}</NuxtLink>
                  <span class="text-[12px] text-ink-faint2"> — {{ fmt(a.starts_at) }}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

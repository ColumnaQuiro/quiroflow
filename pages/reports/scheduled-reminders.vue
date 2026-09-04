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
const t = useT()

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
  if (m.error_code) return t(`Error code ${m.error_code}`, `Código de error ${m.error_code}`)
  return t('Unknown error', 'Error desconocido')
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
    <PageHeader :title="t('Scheduled Reminders', 'Recordatorios programados')" :meta="t('WhatsApp delivery and confirmation status', 'Estado de entrega y confirmación de WhatsApp')">
      <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Reports', 'Informes') }}</NuxtLink>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <p class="text-[13px] text-ink-muted2">{{ t('Did every WhatsApp actually send, and who has confirmed, is pending, or asked to reschedule.', 'Si todos los WhatsApp se enviaron realmente, y quién ha confirmado, está pendiente o ha pedido reprogramar.') }}</p>

      <div class="mt-4">
        <ReportsDateRangeSelect v-model="range" />
      </div>

      <div v-if="loading" class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
        <UiSkeleton class="h-4 w-48 rounded-ctlSm" />
        <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div v-for="i in 4" :key="i" class="space-y-2 rounded-ctl bg-surface-subtle p-3 text-center">
            <UiSkeleton class="mx-auto h-[23px] w-10 rounded-ctlSm" />
            <UiSkeleton class="mx-auto h-3 w-16 rounded-ctlSm" />
          </div>
        </div>
      </div>

      <template v-else>
        <div class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
          <h3 class="text-[13.5px] font-semibold text-ink-800">{{ t('WhatsApp delivery status', 'Estado de entrega de WhatsApp') }}</h3>
          <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div class="rounded-ctl bg-surface-subtle p-3 text-center">
              <p class="font-mono text-[23px] font-semibold text-ink-900">{{ byStatus.sent }}</p>
              <p class="text-[12px] text-ink-muted2">{{ t('Sent', 'Enviados') }}</p>
            </div>
            <div class="rounded-ctl bg-surface-subtle p-3 text-center">
              <p class="font-mono text-[23px] font-semibold text-ink-900">{{ byStatus.delivered }}</p>
              <p class="text-[12px] text-ink-muted2">{{ t('Delivered', 'Entregados') }}</p>
            </div>
            <div class="rounded-ctl bg-surface-subtle p-3 text-center">
              <p class="font-mono text-[23px] font-semibold text-ink-900">{{ byStatus.read }}</p>
              <p class="text-[12px] text-ink-muted2">{{ t('Read', 'Leídos') }}</p>
            </div>
            <div class="rounded-ctl p-3 text-center" :class="byStatus.failed > 0 ? 'bg-danger-bg' : 'bg-surface-subtle'">
              <p class="font-mono text-[23px] font-semibold" :class="byStatus.failed > 0 ? 'text-danger-text' : 'text-ink-900'">{{ byStatus.failed }}</p>
              <p class="text-[12px]" :class="byStatus.failed > 0 ? 'text-danger-text' : 'text-ink-muted2'">{{ t('Failed', 'Fallidos') }}</p>
            </div>
          </div>

          <div v-if="failedMessages.length > 0" class="mt-4">
            <p class="text-[11px] font-medium uppercase tracking-wide text-ink-muted2">{{ t('Failed sends — bad number or no WhatsApp account', 'Envíos fallidos — número incorrecto o sin cuenta de WhatsApp') }}</p>
            <ul class="mt-2 divide-y divide-line-row text-[13px]">
              <li v-for="m in failedMessages" :key="m.id" class="flex items-center justify-between py-1.5">
                <NuxtLink v-if="m.patient_id" :to="`/patients/${m.patient_id}`" class="text-ink-600 hover:text-brand-text">
                  {{ patientById.get(m.patient_id) ?? t('Unknown patient', 'Paciente desconocido') }}
                </NuxtLink>
                <span v-else class="text-ink-faint2">{{ t('Unknown patient', 'Paciente desconocido') }}</span>
                <span class="text-[12px] text-danger-text">{{ failureReason(m) }}</span>
              </li>
            </ul>
          </div>
          <p v-if="messages.length === 0" class="mt-3 text-[13px] text-ink-faint2">{{ t('No WhatsApp messages sent in this range yet.', 'Todavía no se han enviado mensajes de WhatsApp en este periodo.') }}</p>
        </div>

        <div class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
          <h3 class="text-[13.5px] font-semibold text-ink-800">{{ t('Appointment confirmations', 'Confirmaciones de citas') }}</h3>
          <p class="text-[12px] text-ink-faint2">{{ t('Only counts appointments that had a confirmation message sent — requires the WhatsApp reply webhook to be configured (Settings → WhatsApp).', 'Solo cuenta citas a las que se envió un mensaje de confirmación — requiere tener configurado el webhook de respuestas de WhatsApp (Ajustes → WhatsApp).') }}</p>

          <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div class="rounded-ctl bg-success-bg p-3">
              <p class="text-[11px] font-medium uppercase tracking-wide text-success-text">{{ t(`Confirmed (${confirmed.length})`, `Confirmadas (${confirmed.length})`) }}</p>
              <ul class="mt-1 max-h-40 space-y-1 overflow-y-auto text-[13px]">
                <li v-for="a in confirmed" :key="a.id">
                  <NuxtLink :to="`/patients/${a.patient_id}`" class="text-ink-600 hover:text-brand-text">{{ patientById.get(a.patient_id) }}</NuxtLink>
                  <span class="text-[12px] text-ink-faint2"> — {{ fmt(a.starts_at) }}</span>
                </li>
              </ul>
            </div>
            <div class="rounded-ctl bg-warning-bg p-3">
              <p class="text-[11px] font-medium uppercase tracking-wide text-warning-text">{{ t(`Pending (${pending.length})`, `Pendientes (${pending.length})`) }}</p>
              <ul class="mt-1 max-h-40 space-y-1 overflow-y-auto text-[13px]">
                <li v-for="a in pending" :key="a.id">
                  <NuxtLink :to="`/patients/${a.patient_id}`" class="text-ink-600 hover:text-brand-text">{{ patientById.get(a.patient_id) }}</NuxtLink>
                  <span class="text-[12px] text-ink-faint2"> — {{ fmt(a.starts_at) }}</span>
                </li>
              </ul>
            </div>
            <div class="rounded-ctl bg-info-bg p-3">
              <p class="text-[11px] font-medium uppercase tracking-wide text-info-text">{{ t(`Wants to reschedule (${rescheduleRequested.length})`, `Quiere reprogramar (${rescheduleRequested.length})`) }}</p>
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

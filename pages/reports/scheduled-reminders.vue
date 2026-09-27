<script setup lang="ts">
import { computePresetRange, rangeBounds } from '~/composables/useDateRangePresets'
import { fetchAllRows, fetchByIds } from '~/composables/useFetchAllRows'

const { can } = usePermission()
const canReadMessages = computed(() => can('inbox_access'))

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
// The two cards load independently: delivery status comes from this range's
// messages, confirmations from upcoming appointments, and neither waits for
// the other.
const messagesLoading = ref(true)
const confirmationsLoading = ref(true)
const messages = ref<WhatsappMessageRow[]>([])
const appointments = ref<AppointmentRow[]>([])
const patientById = ref(new Map<string, string>())

// Only the patients either card names. This used to download every patient in
// the clinic -- thousands of rows, page by page -- to label a handful of
// failed sends and upcoming confirmations.
async function addPatientNames(ids: (string | null)[]) {
  const missing = [...new Set(ids.filter((id): id is string => !!id && !patientById.value.has(id)))]
  const rows = await fetchByIds<PatientRow>(missing, (chunk) => supabase.from('patients').select('id, first_name, last_name').in('id', chunk))
  if (rows.length === 0) return
  const next = new Map(patientById.value)
  for (const p of rows) next.set(p.id, `${p.first_name} ${p.last_name ?? ''}`.trim())
  patientById.value = next
}

// Every row of this report comes from whatsapp_messages, which 0164 gates
// on inbox_access -- so without it the report is not "no reminders were
// sent", it is "you cannot see them".
let messagesRun = 0
async function loadMessages() {
  if (!canReadMessages.value) {
    messagesLoading.value = false
    return
  }
  // A range picked while this is in flight starts another run; only the
  // latest may write.
  const mine = ++messagesRun
  messagesLoading.value = true
  const { from, to } = rangeBounds(range.value)
  const msgs = await fetchAllRows<WhatsappMessageRow>((f, t) =>
    supabase
      .from('whatsapp_messages')
      .select('id, patient_id, status, purpose, error_code, error_message, created_at')
      .eq('direction', 'outbound')
      .gte('created_at', from.toISOString())
      .lte('created_at', to.toISOString())
      .range(f, t),
  )
  await addPatientNames(msgs.filter((m) => m.status === 'failed').map((m) => m.patient_id))
  if (mine !== messagesRun) return
  messages.value = msgs
  messagesLoading.value = false
}

// Upcoming appointments -- not tied to the range, so loaded once.
async function loadConfirmations() {
  if (!canReadMessages.value) {
    confirmationsLoading.value = false
    return
  }
  const appts = await fetchAllRows<AppointmentRow>((f, t) =>
    supabase
      .from('appointments')
      .select('id, patient_id, starts_at, confirmation_status, status')
      .eq('status', 'booked')
      .gte('starts_at', new Date().toISOString())
      .not('confirmation_status', 'is', null)
      .range(f, t),
  )
  await addPatientNames(appts.map((a) => a.patient_id))
  appointments.value = appts
  confirmationsLoading.value = false
}
onMounted(() => {
  loadMessages()
  loadConfirmations()
})
watch(range, loadMessages)

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

      <p v-if="!canReadMessages" class="mt-4 rounded-ctl border border-line bg-surface-subtle px-3 py-2 text-[13px] text-ink-muted">
        {{ t('This report needs Inbox access — ask an owner to enable it for your role.', 'Este informe requiere acceso a la Bandeja de entrada — pide a un propietario que lo active para tu rol.') }}
      </p>

      <div v-else class="mt-4">
        <ReportsDateRangeSelect v-model="range" />
      </div>

      <ReportsModule class="mt-4" :title="t('WhatsApp delivery status', 'Estado de entrega de WhatsApp')" :loading="messagesLoading">
        <template #skeleton>
          <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div v-for="i in 4" :key="i" class="space-y-2 rounded-ctl bg-surface-subtle p-3 text-center">
              <UiSkeleton class="mx-auto h-[23px] w-10 rounded-ctlSm" />
              <UiSkeleton class="mx-auto h-3 w-16 rounded-ctlSm" />
            </div>
          </div>
        </template>
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
      </ReportsModule>

      <ReportsModule
        class="mt-4"
        :title="t('Appointment confirmations', 'Confirmaciones de citas')"
        :description="t('Only counts appointments that had a confirmation message sent — requires the WhatsApp reply webhook to be configured (Settings → WhatsApp).', 'Solo cuenta citas a las que se envió un mensaje de confirmación — requiere tener configurado el webhook de respuestas de WhatsApp (Ajustes → WhatsApp).')"
        :loading="confirmationsLoading"
      >
        <template #skeleton>
          <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div v-for="i in 3" :key="i" class="space-y-2.5 rounded-ctl bg-surface-subtle p-3">
              <UiSkeleton class="h-3 w-24 rounded-ctlSm" />
              <UiSkeleton v-for="j in 3" :key="j" class="h-3.5 w-full rounded-ctlSm" />
            </div>
          </div>
        </template>
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
      </ReportsModule>
    </div>
  </div>
</template>

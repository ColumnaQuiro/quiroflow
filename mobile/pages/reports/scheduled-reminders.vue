<script setup lang="ts">
// Recordatorios programados, on the phone: the web's pages/reports/scheduled-
// reminders.vue -- the same two reads (the range's outbound WhatsApp messages,
// and upcoming booked appointments with a confirmation status) and the same
// counts, behind the same inbox_access check. Reshaped for a phone: the four
// delivery counts as a 2x2 grid, the failed sends as a list, and the web's
// three side-by-side confirmation columns stacked, each a list showing the
// first ten with "Ver más". Left out: the PDF button (no PDF on the app yet).
import { computePresetRange, rangeBounds } from '../../../composables/useDateRangePresets'
import { fetchAllRows } from '../../../composables/useFetchAllRows'

definePageMeta({ layout: 'practitioner' })

interface WhatsappMessageRow {
  id: string
  patient_id: string | null
  status: string
  purpose: string | null
  error_code: string | null
  error_message: string | null
  created_at: string
  patients: PatientName | null
}
interface AppointmentRow {
  id: string
  patient_id: string
  starts_at: string
  confirmation_status: string | null
  status: string
  patients: PatientName | null
}
interface PatientName { first_name: string; last_name: string | null }

const PATH = '/reports/scheduled-reminders'
const supabase = useSupabaseClient()
const t = useT()
const { canOpen, context } = useReportAccess()
const { shown } = usePrivacyMode()
// Every row of this report comes from whatsapp_messages, which 0164 gates on
// inbox_access -- so without it the report is not "no reminders were sent",
// it is "you cannot see them". usePermission's can(), from the context.
const canReadMessages = computed(() => !!context.value && (context.value.isOwner || context.value.permissions.inbox_access === true))

const range = ref(computePresetRange({ months: 1 }))
// The two cards load independently: delivery status comes from this range's
// messages, confirmations from upcoming appointments, and neither waits for
// the other.
const messagesLoading = ref(true)
const confirmationsLoading = ref(true)
const messagesFailed = ref(false)
const confirmationsFailed = ref(false)
const messages = ref<WhatsappMessageRow[]>([])
const appointments = ref<AppointmentRow[]>([])
const patientById = ref(new Map<string, string>())

// Names for the rows that show one, from the patient each row already
// carries (embedded in its own query). The patients' row-level security
// applies: a patient this person cannot see comes back without a name.
function addPatientNames(rows: { patient_id: string | null; patients: PatientName | null }[]) {
  const next = new Map(patientById.value)
  let added = false
  for (const row of rows) {
    if (!row.patient_id || !row.patients || next.has(row.patient_id)) continue
    next.set(row.patient_id, `${row.patients.first_name} ${row.patients.last_name ?? ''}`.trim())
    added = true
  }
  if (added) patientById.value = next
}

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
  messagesFailed.value = false
  const { from, to } = rangeBounds(range.value)
  try {
    const msgs = await fetchAllRows<WhatsappMessageRow>((f, tt) =>
      supabase
        .from('whatsapp_messages')
        .select('id, patient_id, status, purpose, error_code, error_message, created_at, patients(first_name, last_name)')
        .eq('direction', 'outbound')
        .gte('created_at', from.toISOString())
        .lte('created_at', to.toISOString())
        .range(f, tt),
    )
    addPatientNames(msgs.filter((m) => m.status === 'failed'))
    if (mine !== messagesRun) return
    messages.value = msgs
    shownFailed.value = PAGE
  } catch {
    if (mine !== messagesRun) return
    messagesFailed.value = true
  }
  messagesLoading.value = false
}

// Upcoming appointments -- not tied to the range, so loaded once.
async function loadConfirmations() {
  if (!canReadMessages.value) {
    confirmationsLoading.value = false
    return
  }
  confirmationsLoading.value = true
  confirmationsFailed.value = false
  try {
    const appts = await fetchAllRows<AppointmentRow>((f, tt) =>
      supabase
        .from('appointments')
        .select('id, patient_id, starts_at, confirmation_status, status, patients(first_name, last_name)')
        .eq('status', 'booked')
        .gte('starts_at', new Date().toISOString())
        .not('confirmation_status', 'is', null)
        .range(f, tt),
    )
    addPatientNames(appts)
    appointments.value = appts
  } catch {
    confirmationsFailed.value = true
  }
  confirmationsLoading.value = false
}

const PAGE = 10
const shownFailed = ref(PAGE)
const shownGroup = ref<Record<string, number>>({})

// Only once the role is known to include it.
watch(
  () => !!context.value && canOpen(PATH),
  (ok) => {
    if (!ok) return
    loadMessages()
    loadConfirmations()
  },
  { immediate: true },
)
watch(range, () => { if (context.value && canOpen(PATH)) loadMessages() })

const byStatus = computed(() => {
  const counts = { sent: 0, delivered: 0, read: 0, failed: 0 }
  for (const m of messages.value) {
    if (m.status in counts) counts[m.status as keyof typeof counts]++
  }
  return counts
})
const failedMessages = computed(() => messages.value.filter((m) => m.status === 'failed').sort((a, b) => b.created_at.localeCompare(a.created_at)))

function failureReason(m: WhatsappMessageRow) {
  if (m.error_message) return m.error_message
  if (m.error_code) return t(`Error code ${m.error_code}`, `Código de error ${m.error_code}`)
  return t('Unknown error', 'Error desconocido')
}

const groups = computed(() => {
  const of = (s: string) => appointments.value.filter((a) => a.confirmation_status === s)
  const confirmed = of('confirmed')
  const pending = of('pending')
  const reschedule = of('reschedule_requested')
  return [
    { key: 'confirmed', label: t(`Confirmed (${confirmed.length})`, `Confirmadas (${confirmed.length})`), tone: 'text-success-text', dot: 'bg-success-accent', rows: confirmed, empty: t('Nobody has confirmed yet.', 'Nadie ha confirmado todavía.') },
    { key: 'pending', label: t(`Pending (${pending.length})`, `Pendientes (${pending.length})`), tone: 'text-warning-text', dot: 'bg-warning-accent', rows: pending, empty: t('Nothing pending.', 'Nada pendiente.') },
    { key: 'reschedule', label: t(`Wants to reschedule (${reschedule.length})`, `Quiere reprogramar (${reschedule.length})`), tone: 'text-info-text', dot: 'bg-info-accent', rows: reschedule, empty: t('Nobody has asked to reschedule.', 'Nadie ha pedido reprogramar.') },
  ]
})

const locale = computed(() => t('en-GB', 'es-ES'))
function fmt(iso: string) {
  return new Date(iso).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' })
}
</script>

<template>
  <ReportScreen :title="t('Scheduled Reminders', 'Recordatorios programados')" path="/reports/scheduled-reminders" :description="t('Did every WhatsApp actually send, and who has confirmed, is pending, or asked to reschedule.', 'Si todos los WhatsApp se enviaron realmente, y quién ha confirmado, está pendiente o ha pedido reprogramar.')">
    <template v-if="canReadMessages" #filters>
      <ReportRangePicker v-model="range" />
    </template>

    <p v-if="!canReadMessages" class="rounded-card border border-line bg-surface px-3.5 py-3 text-[13.5px] text-ink-muted" data-cy="report-scheduled-reminders-no-inbox">
      {{ t('This report needs Inbox access — ask an owner to enable it for your role.', 'Este informe requiere acceso a la Bandeja de entrada — pide a un propietario que lo active para tu rol.') }}
    </p>

    <template v-else>
      <ReportsModule :title="t('WhatsApp delivery status', 'Estado de entrega de WhatsApp')" :loading="messagesLoading" skeleton="list" :rows="3">
        <p v-if="messagesFailed" class="mt-2 rounded-ctl bg-danger-bg px-3 py-2.5 text-[13.5px] text-danger-text" role="alert">
          {{ t('Could not load the report.', 'No se ha podido cargar el informe.') }}
          <button type="button" class="ml-1 font-semibold underline" @click="loadMessages">{{ t('Try again', 'Reintentar') }}</button>
        </p>
        <template v-else>
          <div class="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-4" data-cy="report-scheduled-reminders-status">
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
              <p class="font-mono text-[23px] font-semibold" :class="byStatus.failed > 0 ? 'text-danger-text' : 'text-ink-900'" data-cy="report-scheduled-reminders-failed-count">{{ byStatus.failed }}</p>
              <p class="text-[12px]" :class="byStatus.failed > 0 ? 'text-danger-text' : 'text-ink-muted2'">{{ t('Failed', 'Fallidos') }}</p>
            </div>
          </div>

          <div v-if="failedMessages.length > 0" class="mt-4">
            <p class="text-[11.5px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('Failed sends — bad number or no WhatsApp account', 'Envíos fallidos — número incorrecto o sin cuenta de WhatsApp') }}</p>
            <ul class="mt-1" data-cy="report-scheduled-reminders-failed">
              <ReportRow
                v-for="m in failedMessages.slice(0, shownFailed)"
                :key="m.id"
                :to="m.patient_id ? `/patients/${m.patient_id}` : undefined"
                :title="m.patient_id && patientById.get(m.patient_id) ? shown(patientById.get(m.patient_id)!) : t('Unknown patient', 'Paciente desconocido')"
                :subtitle="`${fmt(m.created_at)} · ${failureReason(m)}`"
              />
            </ul>
            <AppButton v-if="failedMessages.length > shownFailed" class="mt-2 w-full" @click="shownFailed += PAGE">
              {{ t(`Show more (${failedMessages.length - shownFailed})`, `Ver más (${failedMessages.length - shownFailed})`) }}
            </AppButton>
          </div>
          <p v-if="messages.length === 0" class="mt-3 text-[13.5px] text-ink-faint">{{ t('No WhatsApp messages sent in this range yet.', 'Todavía no se han enviado mensajes de WhatsApp en este periodo.') }}</p>
        </template>
      </ReportsModule>

      <ReportsModule
        :title="t('Appointment confirmations', 'Confirmaciones de citas')"
        :description="t('Only counts appointments that had a confirmation message sent — requires the WhatsApp reply webhook to be configured (Settings → WhatsApp).', 'Solo cuenta citas a las que se envió un mensaje de confirmación — requiere tener configurado el webhook de respuestas de WhatsApp (Ajustes → WhatsApp).')"
        :loading="confirmationsLoading"
        skeleton="list"
        :rows="5"
      >
        <p v-if="confirmationsFailed" class="mt-2 rounded-ctl bg-danger-bg px-3 py-2.5 text-[13.5px] text-danger-text" role="alert">
          {{ t('Could not load the report.', 'No se ha podido cargar el informe.') }}
          <button type="button" class="ml-1 font-semibold underline" @click="loadConfirmations">{{ t('Try again', 'Reintentar') }}</button>
        </p>
        <div v-else class="mt-2 flex flex-col gap-3">
          <section v-for="g in groups" :key="g.key" :data-cy="`report-scheduled-reminders-${g.key}`">
            <p class="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[.05em]" :class="g.tone">
              <span class="h-[7px] w-[7px] rounded-full" :class="g.dot" aria-hidden="true" />
              {{ g.label }}
            </p>
            <p v-if="g.rows.length === 0" class="py-2 text-[12.5px] text-ink-faint">{{ g.empty }}</p>
            <ul v-else>
              <ReportRow
                v-for="a in g.rows.slice(0, shownGroup[g.key] ?? PAGE)"
                :key="a.id"
                :to="`/patients/${a.patient_id}`"
                :title="patientById.get(a.patient_id) ? shown(patientById.get(a.patient_id)!) : t('Unknown patient', 'Paciente desconocido')"
                :subtitle="fmt(a.starts_at)"
              />
            </ul>
            <AppButton v-if="g.rows.length > (shownGroup[g.key] ?? PAGE)" class="mt-1 w-full" @click="shownGroup = { ...shownGroup, [g.key]: (shownGroup[g.key] ?? PAGE) + PAGE }">
              {{ t(`Show more (${g.rows.length - (shownGroup[g.key] ?? PAGE)})`, `Ver más (${g.rows.length - (shownGroup[g.key] ?? PAGE)})`) }}
            </AppButton>
          </section>
        </div>
      </ReportsModule>
    </template>
  </ReportScreen>
</template>

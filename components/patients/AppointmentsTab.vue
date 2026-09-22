<script setup lang="ts">
import { dateBlock, formatEur, formatTime } from '~/utils/billing'
import { resolveVisitPayment, type VisitPayment } from '~/utils/visitPayment'

// Every visit this patient has had or has booked, and -- the part that was
// missing -- how each one was paid for.
//
// A row that says only "Completed" leaves the front desk to open Money and
// work out whether the visit drew on a bono, was settled by card, or is
// still owed. That question is asked constantly and the answer lives four
// tables away, so the row answers it. See utils/visitPayment for the rules.
//
// The four counters at the top used to be a KPI strip on Overview, where
// they sat above a patient's contact details answering a question nobody
// had asked yet. They belong to this tab, which is the one about visits.
const props = defineProps<{ patientId: string; firstName?: string; lastName?: string | null; preferredLanguage?: string }>()

interface AppointmentRow {
  id: string
  starts_at: string
  ends_at: string
  status: string
  source: string
  confirmation_status: string | null
  clinic_id: string | null
  practitioner_name: string | null
  appointment_types: { name: string } | null
  team_members: { full_name: string } | null
  calendar_resources: { name: string } | null
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { preference: langPreference } = useLang()

const appointments = ref<AppointmentRow[]>([])
const paymentByAppointment = ref<Record<string, VisitPayment>>({})
const loading = ref(true)

const counts = ref({ completed: 0, cancelled: 0, no_show: 0, visits12mo: 0 })
const attendance = computed(() => {
  const denom = counts.value.completed + counts.value.no_show
  if (denom === 0) return null
  return Math.round((counts.value.completed / denom) * 100)
})

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('appointments')
    .select(
      'id, starts_at, ends_at, status, source, confirmation_status, clinic_id, practitioner_name, appointment_types(name), team_members(full_name), calendar_resources(name)',
    )
    .eq('patient_id', props.patientId)
    .is('deleted_at', null)
    .order('starts_at', { ascending: false })
  appointments.value = (data as unknown as AppointmentRow[]) ?? []

  const twelveMonthsAgo = new Date()
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1)
  const next = { completed: 0, cancelled: 0, no_show: 0, visits12mo: 0 }
  for (const a of appointments.value) {
    if (a.status in next) (next as Record<string, number>)[a.status]++
    if (a.status === 'completed' && new Date(a.starts_at) >= twelveMonthsAgo) next.visits12mo++
  }
  counts.value = next

  await loadPayments(appointments.value.map((a) => a.id))
  loading.value = false
}

// Four tables, in three rounds: the first two are independent, payments need
// the invoice ids, facturas need the payment ids. A tab's worth of rows, so
// the id lists stay small.
async function loadPayments(appointmentIds: string[]) {
  if (appointmentIds.length === 0) {
    paymentByAppointment.value = {}
    return
  }

  const [{ data: sessions }, { data: invoices }] = await Promise.all([
    supabase
      .from('package_sessions')
      .select('appointment_id, amount_cents, external_reference, package_purchases(package_name, sessions_total, sessions_used, external_reference)')
      .in('appointment_id', appointmentIds),
    supabase.from('invoices').select('id, appointment_id, invoice_number, total_cents, status').in('appointment_id', appointmentIds),
  ])

  const invoiceIds = (invoices ?? []).map((i) => i.id)
  const { data: payments } = invoiceIds.length
    ? await supabase.from('payments').select('id, invoice_id, method, amount_cents').in('invoice_id', invoiceIds).order('paid_at')
    : { data: [] as { id: string; invoice_id: string | null; method: string; amount_cents: number }[] }

  const paymentIds = (payments ?? []).map((p) => p.id)
  const { data: facturas } = paymentIds.length
    ? await supabase.from('facturas').select('payment_id, number').in('payment_id', paymentIds)
    : { data: [] as { payment_id: string | null; number: string }[] }

  const sessionByAppointment = new Map<string, any>()
  for (const s of sessions ?? []) if (s.appointment_id) sessionByAppointment.set(s.appointment_id, s)

  const paymentsByInvoice = new Map<string, { id: string; method: string; amount_cents: number }[]>()
  for (const p of payments ?? []) {
    if (!p.invoice_id) continue
    const list = paymentsByInvoice.get(p.invoice_id) ?? []
    list.push(p)
    paymentsByInvoice.set(p.invoice_id, list)
  }

  const facturaByPayment = new Map<string, string>()
  for (const f of facturas ?? []) if (f.payment_id) facturaByPayment.set(f.payment_id, f.number)

  const resolved: Record<string, VisitPayment> = {}
  for (const id of appointmentIds) {
    const session = sessionByAppointment.get(id)
    const invoice = (invoices ?? []).find((i) => i.appointment_id === id) ?? null
    const invoicePayments = invoice ? (paymentsByInvoice.get(invoice.id) ?? []) : []
    resolved[id] = resolveVisitPayment({
      session: session ? { amount_cents: session.amount_cents, external_reference: session.external_reference } : null,
      purchase: session?.package_purchases ?? null,
      invoice: invoice ? { invoice_number: invoice.invoice_number, total_cents: invoice.total_cents, status: invoice.status } : null,
      payments: invoicePayments.map((p) => ({ method: p.method, amount_cents: p.amount_cents })),
      facturaNumbers: invoicePayments.map((p) => facturaByPayment.get(p.id)).filter((n): n is string => !!n),
    })
  }
  paymentByAppointment.value = resolved
}

onMounted(load)
watch(() => props.patientId, load)

const upcoming = computed(() =>
  appointments.value.filter((a) => a.status === 'booked' && new Date(a.starts_at) > new Date()).slice().reverse(),
)
const past = computed(() => appointments.value.filter((a) => !upcoming.value.includes(a)))

function practitionerLabel(appt: AppointmentRow) {
  return appt.team_members?.full_name ?? appt.practitioner_name ?? null
}
function clinicLabel(appt: AppointmentRow) {
  return store.clinics.find((c) => c.id === appt.clinic_id)?.name ?? null
}
/** "Dr Ruiz · Room 2 · Main Location · 30 min", minus whatever is unknown. */
function whereLine(appt: AppointmentRow) {
  const minutes = Math.round((new Date(appt.ends_at).getTime() - new Date(appt.starts_at).getTime()) / 60000)
  return [practitionerLabel(appt), appt.calendar_resources?.name, clinicLabel(appt), minutes > 0 ? `${minutes} min` : null]
    .filter(Boolean)
    .join(' · ')
}

// The semantic map. Confirmed is its own state rather than a qualifier
// because "they said yes" is what the front desk is scanning for; booked-
// online IS a qualifier, because how it was booked does not change what the
// appointment is.
type Tone = 'success' | 'warning' | 'danger' | 'brand' | 'neutral'
function statusOf(appt: AppointmentRow): { label: string; tone: Tone } {
  if (appt.status === 'completed') return { label: t('Completed', 'Completada'), tone: 'success' }
  if (appt.status === 'no_show') return { label: t('Missed', 'No asistió'), tone: 'danger' }
  if (appt.status === 'cancelled') return { label: t('Cancelled', 'Cancelada'), tone: 'neutral' }
  if (appt.status === 'booked' && appt.confirmation_status === 'confirmed') {
    return { label: t('Confirmed', 'Confirmada'), tone: 'success' }
  }
  return { label: t('Booked', 'Reservada'), tone: 'neutral' }
}
const isCancelled = (appt: AppointmentRow) => appt.status === 'cancelled'

const METHOD_LABELS = computed<Record<string, string>>(() => ({
  cash: t('Cash', 'Efectivo'),
  card: t('Card', 'Tarjeta'),
  credit: t('Credit', 'Crédito'),
  transfer: t('Transfer', 'Transferencia'),
  write_off: t('Written off', 'Condonado'),
}))

/** One short phrase for the payment cell, or null when there is nothing to say. */
function paymentLine(appt: AppointmentRow): { text: string; tone: 'muted' | 'danger' | 'success'; mono?: string } | null {
  const payment = paymentByAppointment.value[appt.id]
  if (!payment || payment.kind === 'none') return null
  if (payment.kind === 'bono') {
    return {
      text: `${payment.packageName} · ${payment.remaining} ${t('of', 'de')} ${payment.total} ${t('left', 'restantes')}`,
      tone: 'success',
      mono: payment.reference ?? undefined,
    }
  }
  if (payment.kind === 'unpaid') {
    return { text: `${t('Unpaid', 'Pendiente')} · ${formatEur(payment.totalCents)}`, tone: 'danger', mono: payment.invoiceNumber }
  }
  if (payment.kind === 'void') {
    return { text: t('Charge voided', 'Cargo anulado'), tone: 'muted', mono: payment.invoiceNumber }
  }
  const methods = payment.methods.map((m) => METHOD_LABELS.value[m] ?? m).join(' + ')
  return { text: methods, tone: 'muted', mono: payment.facturaNumber ?? payment.invoiceNumber }
}

// What happened to the fee. The design asks a cancelled row to state the
// notice given as well, and it cannot: nothing in the schema records WHEN a
// cancellation happened -- there is no cancelled_at, and appointment_
// reschedules only covers moves. Rather than compute a notice period from a
// timestamp that does not mean that, the row says the part that is knowable
// and true, which is whether the patient was charged.
function feeLine(appt: AppointmentRow): string | null {
  if (appt.status !== 'no_show' && appt.status !== 'cancelled') return null
  const payment = paymentByAppointment.value[appt.id]
  if (!payment || payment.kind === 'none') return t('No fee charged.', 'Sin cargo.')
  if (payment.kind === 'void') return t('Fee charged, then voided.', 'Cargo aplicado y luego anulado.')
  if (payment.kind === 'unpaid') return t('Fee charged, still outstanding.', 'Cargo aplicado, pendiente de cobro.')
  if (payment.kind === 'settled') return t('Fee charged and paid.', 'Cargo aplicado y cobrado.')
  return null
}

const sendMenuOpen = ref(false)
const sending = ref(false)
const sendMessage = ref('')
async function sendHistory(channel: 'email' | 'whatsapp') {
  sendMenuOpen.value = false
  sending.value = true
  sendMessage.value = ''
  try {
    await useStaffFetch(`/api/patients/${props.patientId}/appointment-history/${channel === 'email' ? 'send' : 'send-whatsapp'}`, { method: 'POST' })
    sendMessage.value = channel === 'email' ? t('Sent by email.', 'Enviado por correo.') : t('Sent by WhatsApp.', 'Enviado por WhatsApp.')
  } catch (e: any) {
    sendMessage.value = e?.data?.statusMessage ?? t('Failed to send.', 'No se pudo enviar.')
  }
  sending.value = false
  setTimeout(() => (sendMessage.value = ''), 4000)
}

const notesAppointmentId = ref<string | null>(null)
const confirmingAppointment = ref<AppointmentRow | null>(null)
const confirmationAutofill = computed<Record<string, string>>(() => {
  if (!confirmingAppointment.value) return {} as Record<string, string>
  const starts = new Date(confirmingAppointment.value.starts_at)
  return {
    appointment_date: starts.toLocaleDateString(langPreference.value === 'es' ? 'es-ES' : 'en-GB'),
    appointment_time: formatTime(starts),
  }
})

const stats = computed(() => [
  { key: 'visits', label: t('Visits, 12 mo', 'Visitas, 12 m'), value: String(counts.value.visits12mo), tone: 'text-ink-900' },
  {
    key: 'attendance',
    label: t('Attendance', 'Asistencia'),
    value: attendance.value === null ? '—' : `${attendance.value}%`,
    tone: 'text-ink-900',
  },
  { key: 'missed', label: t('Missed', 'No asistió'), value: String(counts.value.no_show), tone: counts.value.no_show > 0 ? 'text-danger-text' : 'text-ink-900' },
  {
    key: 'cancelled',
    label: t('Cancelled', 'Canceladas'),
    value: String(counts.value.cancelled),
    tone: counts.value.cancelled > 0 ? 'text-warning-accent' : 'text-ink-900',
  },
])
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- The stat row that used to be Overview's KPI strip. -->
    <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div v-for="stat in stats" :key="stat.key" class="rounded-card border border-line bg-surface p-4 shadow-card">
        <dt class="text-[11.5px] text-ink-muted2">{{ stat.label }}</dt>
        <dd class="mt-1 font-mono text-[20px] font-semibold" :class="loading ? 'text-ink-faint' : stat.tone">
          {{ loading ? '—' : stat.value }}
        </dd>
      </div>
    </dl>

    <template v-for="group in [
      { key: 'upcoming', title: t('Upcoming', 'Próximas'), rows: upcoming },
      { key: 'past', title: t('Past', 'Anteriores'), rows: past },
    ]" :key="group.key">
      <section
        v-if="loading || group.rows.length > 0 || group.key === 'past'"
        class="rounded-card border border-line bg-surface shadow-card"
        :aria-labelledby="`appts-${group.key}-heading`"
      >
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line-divider px-4 py-3">
          <h2 :id="`appts-${group.key}-heading`" class="text-[13.5px] font-semibold text-ink-700">
            {{ group.title }}
            <span v-if="!loading" class="ml-1 font-normal text-ink-faint">{{ group.rows.length }}</span>
          </h2>
          <div v-if="group.key === 'upcoming'" class="flex items-center gap-2">
            <UiBtn variant="primary" size="sm" @click="navigateTo('/calendar')">{{ t('Book visit', 'Reservar visita') }}</UiBtn>
          </div>
          <div v-else class="flex items-center gap-2">
            <span v-if="sendMessage" class="text-[12px] text-ink-faint">{{ sendMessage }}</span>
            <div class="relative">
              <UiBtn variant="secondary" size="sm" :disabled="sending" @click="sendMenuOpen = !sendMenuOpen">
                {{ sending ? t('Sending…', 'Enviando…') : t('Send history', 'Enviar historial') }}
              </UiBtn>
              <div v-if="sendMenuOpen" class="absolute right-0 z-10 mt-1 w-36 rounded-ctl border border-line bg-surface py-1 shadow-popover">
                <button type="button" class="block w-full px-3 py-2 text-left text-[12.5px] text-ink-700 hover:bg-surface-subtle lg:py-1.5" @click="sendHistory('email')">
                  {{ t('Email', 'Correo electrónico') }}
                </button>
                <button type="button" class="block w-full px-3 py-2 text-left text-[12.5px] text-ink-700 hover:bg-surface-subtle lg:py-1.5" @click="sendHistory('whatsapp')">
                  WhatsApp
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="loading" class="divide-y divide-line-row">
          <div v-for="i in 3" :key="i" class="flex items-center gap-4 px-4 py-3">
            <UiSkeleton class="h-10 w-10 shrink-0 rounded-ctl" />
            <UiSkeleton class="h-3.5 w-40 rounded-ctlSm" />
            <UiSkeleton class="h-5 w-20 rounded-pill" />
          </div>
        </div>

        <p v-else-if="group.rows.length === 0" class="px-4 py-8 text-center text-[13px] text-ink-faint">
          {{ group.key === 'upcoming' ? t('Nothing booked.', 'Nada reservado.') : t('No visits yet.', 'Aún no hay visitas.') }}
        </p>

        <ul v-else class="divide-y divide-line-row">
          <li
            v-for="appt in group.rows"
            :key="appt.id"
            class="flex flex-col gap-2.5 px-4 py-3 lg:flex-row lg:items-center lg:gap-4"
            :class="isCancelled(appt) ? 'opacity-60' : ''"
          >
            <!-- Date block -->
            <div class="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-ctl border border-line bg-surface-subtle2">
              <span class="font-mono text-[14px] font-semibold leading-none text-ink-900">{{ dateBlock(appt.starts_at).day }}</span>
              <span class="mt-0.5 text-[9.5px] uppercase leading-none text-ink-muted2">{{ dateBlock(appt.starts_at).month }}</span>
            </div>

            <div class="min-w-0 flex-1">
              <p class="truncate text-[13.5px] text-ink-900">
                <span class="font-mono">{{ formatTime(appt.starts_at) }}</span>
                <span v-if="appt.appointment_types?.name"> · {{ appt.appointment_types.name }}</span>
              </p>
              <p v-if="whereLine(appt)" class="truncate text-[12px] text-ink-muted2">{{ whereLine(appt) }}</p>
              <!-- What happened to the fee, for the two statuses where the
                   patient is likely to ask. -->
              <p v-if="feeLine(appt)" class="mt-0.5 text-[12px] text-ink-muted">{{ feeLine(appt) }}</p>
            </div>

            <!-- How it was paid. -->
            <div class="shrink-0 lg:w-[210px]">
              <template v-if="paymentLine(appt)">
                <p
                  class="truncate text-[12.5px]"
                  :class="{
                    'text-danger-text': paymentLine(appt)!.tone === 'danger',
                    'text-success-text': paymentLine(appt)!.tone === 'success',
                    'text-ink-600': paymentLine(appt)!.tone === 'muted',
                  }"
                >
                  {{ paymentLine(appt)!.text }}
                </p>
                <p v-if="paymentLine(appt)!.mono" class="truncate font-mono text-[11.5px] text-ink-faint">{{ paymentLine(appt)!.mono }}</p>
              </template>
              <p v-else class="text-[12.5px] text-ink-faint2">{{ t('Not charged', 'Sin cargo') }}</p>
            </div>

            <div class="flex shrink-0 flex-wrap items-center gap-1.5 lg:w-[150px]">
              <UiPill :tone="statusOf(appt).tone">{{ statusOf(appt).label }}</UiPill>
              <!-- A qualifier, not a rival status. -->
              <UiPill v-if="appt.source === 'online'" tone="brand">{{ t('Online', 'En línea') }}</UiPill>
            </div>

            <div class="flex shrink-0 items-center gap-3">
              <button
                type="button"
                class="text-[12px] font-medium text-brand-text outline-none hover:text-brand-hover focus-visible:shadow-focus"
                @click="notesAppointmentId = appt.id"
              >
                {{ t('Notes', 'Notas') }}
              </button>
              <UiBtn v-if="group.key === 'upcoming'" size="sm" variant="secondary" @click="confirmingAppointment = appt">
                {{ t('Send confirmation', 'Enviar confirmación') }}
              </UiBtn>
            </div>
          </li>
        </ul>
      </section>
    </template>

    <div v-if="notesAppointmentId" class="fixed inset-0 z-20 flex items-center justify-center bg-ink-900/40 p-4" @click.self="notesAppointmentId = null">
      <div class="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-card bg-surface p-6 shadow-drawer">
        <div class="flex items-center justify-between">
          <h2 class="text-[15px] font-semibold text-ink-900">{{ t('Visit notes', 'Notas de la visita') }}</h2>
          <button type="button" :aria-label="t('Close', 'Cerrar')" class="text-ink-faint hover:text-ink-600" @click="notesAppointmentId = null">✕</button>
        </div>
        <div class="mt-4">
          <AppointmentsNotesPanel :appointment-id="notesAppointmentId" />
        </div>
      </div>
    </div>

    <SendWhatsAppModal
      v-if="confirmingAppointment"
      :patient-id="patientId"
      :patient-first-name="firstName ?? ''"
      :patient-preferred-language="preferredLanguage"
      :appointment-id="confirmingAppointment.id"
      :default-template-name="store.whatsappConfirmationTemplateName"
      :autofill="confirmationAutofill"
      :allow-template-override="false"
      @close="confirmingAppointment = null"
    />
  </div>
</template>

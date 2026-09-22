<script setup lang="ts">
import { dateBlock, formatEur, formatLongDate, formatTime } from '~/utils/billing'
import { resolveVisitPayment, type VisitPayment } from '~/utils/visitPayment'
import type { Tables } from '~/types/database.types'

// Overview is a briefing, not a drawer.
//
// It used to open with four counters and then the patient's fourteen-field
// administrative record -- an address, a referral source, a preferred
// language. Those answer "who is this on paper", which is a question asked
// while correcting a typo or chasing an insurer. It is not the question
// anyone has four minutes before a patient walks in.
//
// So the order is now: what needs doing, what happens next, where they are
// in their plan, what has been happening. The counters moved to
// Appointments, which is the tab about visits; the record moved behind one
// button into PatientsDetailsDialog. Six fields stayed, the ones worth a
// glance.
const props = defineProps<{ patient: Tables<'patients'> }>()
const emit = defineEmits<{ updated: [] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { can } = usePermission()

const detailsOpen = ref(false)

// -- Next appointment, and the visit before it -----------------------------
interface ApptRow {
  id: string
  starts_at: string
  ends_at: string
  status: string
  confirmation_status: string | null
  clinic_id: string | null
  practitioner_name: string | null
  appointment_types: { name: string } | null
  team_members: { full_name: string } | null
  calendar_resources: { name: string } | null
}
const nextAppt = ref<ApptRow | null>(null)
const lastVisit = ref<ApptRow | null>(null)
const lastVisitPayment = ref<VisitPayment | null>(null)
const apptLoading = ref(true)

const APPT_COLS =
  'id, starts_at, ends_at, status, confirmation_status, clinic_id, practitioner_name, appointment_types(name), team_members(full_name), calendar_resources(name)'

async function loadAppointments() {
  apptLoading.value = true
  const [{ data: upcoming }, { data: past }] = await Promise.all([
    supabase
      .from('appointments')
      .select(APPT_COLS)
      .eq('patient_id', props.patient.id)
      .eq('status', 'booked')
      .gt('starts_at', new Date().toISOString())
      .is('deleted_at', null)
      .order('starts_at')
      .limit(1),
    supabase
      .from('appointments')
      .select(APPT_COLS)
      .eq('patient_id', props.patient.id)
      .eq('status', 'completed')
      .is('deleted_at', null)
      .order('starts_at', { ascending: false })
      .limit(1),
  ])
  nextAppt.value = (upcoming?.[0] as unknown as ApptRow) ?? null
  lastVisit.value = (past?.[0] as unknown as ApptRow) ?? null
  lastVisitPayment.value = lastVisit.value ? await resolvePaymentFor(lastVisit.value.id) : null
  apptLoading.value = false
}

// The same four-table walk the Appointments tab does, for one visit: the
// footnote says how the last one was paid, and "paid" is not a column.
async function resolvePaymentFor(appointmentId: string): Promise<VisitPayment> {
  const [{ data: sessions }, { data: invoices }] = await Promise.all([
    supabase
      .from('package_sessions')
      .select('amount_cents, external_reference, package_purchases(package_name, sessions_total, sessions_used, external_reference)')
      .eq('appointment_id', appointmentId)
      .limit(1),
    supabase.from('invoices').select('id, invoice_number, total_cents, status').eq('appointment_id', appointmentId).limit(1),
  ])
  const session = sessions?.[0] as any
  const invoice = invoices?.[0]
  const { data: payments } = invoice
    ? await supabase.from('payments').select('id, method, amount_cents').eq('invoice_id', invoice.id).order('paid_at')
    : { data: [] as { id: string; method: string; amount_cents: number }[] }
  const paymentIds = (payments ?? []).map((p) => p.id)
  const { data: facturas } = paymentIds.length
    ? await supabase.from('facturas').select('number').in('payment_id', paymentIds)
    : { data: [] as { number: string }[] }
  return resolveVisitPayment({
    session: session ? { amount_cents: session.amount_cents, external_reference: session.external_reference } : null,
    purchase: session?.package_purchases ?? null,
    invoice: invoice ? { invoice_number: invoice.invoice_number, total_cents: invoice.total_cents, status: invoice.status } : null,
    payments: (payments ?? []).map((p) => ({ method: p.method, amount_cents: p.amount_cents })),
    facturaNumbers: (facturas ?? []).map((f) => f.number),
  })
}

const METHOD_LABELS = computed<Record<string, string>>(() => ({
  cash: t('cash', 'efectivo'),
  card: t('card', 'tarjeta'),
  credit: t('credit', 'crédito'),
  transfer: t('transfer', 'transferencia'),
  write_off: t('a write-off', 'una condonación'),
}))

/** "Last visit 13 de septiembre de 2026, paid by card." */
const lastVisitFootnote = computed(() => {
  if (!lastVisit.value) return null
  const when = formatLongDate(lastVisit.value.starts_at)
  const payment = lastVisitPayment.value
  const prefix = `${t('Last visit', 'Última visita')} ${when}`
  if (!payment || payment.kind === 'none') return `${prefix}.`
  if (payment.kind === 'bono') return `${prefix}, ${t('drawn from', 'con cargo a')} ${payment.packageName}.`
  if (payment.kind === 'unpaid') return `${prefix}, ${t('still unpaid', 'aún sin pagar')} (${formatEur(payment.totalCents)}).`
  if (payment.kind === 'void') return `${prefix}, ${t('charge voided', 'cargo anulado')}.`
  const methods = payment.methods.map((m) => METHOD_LABELS.value[m] ?? m).join(' + ')
  return `${prefix}, ${t('paid by', 'pagada con')} ${methods}.`
})

function whereLine(appt: ApptRow) {
  const minutes = Math.round((new Date(appt.ends_at).getTime() - new Date(appt.starts_at).getTime()) / 60000)
  const clinic = store.clinics.find((c) => c.id === appt.clinic_id)?.name
  return [appt.team_members?.full_name ?? appt.practitioner_name, appt.calendar_resources?.name, clinic, minutes > 0 ? `${minutes} min` : null]
    .filter(Boolean)
    .join(' · ')
}

// -- Needs attention -------------------------------------------------------
// Rendered only when it has something to say. A permanently-present empty
// "nothing needs attention" card trains people to skip the top of the page,
// which is where the things that DO need attention will appear.
interface AttentionRow {
  key: string
  tone: 'danger' | 'warning'
  icon: 'money' | 'form'
  sentence: string
  action: string
  go: () => void
}
const unpaid = ref<{ invoice_number: string; total_cents: number; created_at: string }[]>([])
const awaitingForms = ref<{ id: string; title: string; created_at: string }[]>([])
const attentionLoading = ref(true)

async function loadAttention() {
  attentionLoading.value = true
  const [{ data: invoices }, { data: docs }] = await Promise.all([
    supabase
      .from('invoices')
      .select('invoice_number, total_cents, created_at')
      .eq('patient_id', props.patient.id)
      .eq('status', 'unpaid')
      .order('created_at'),
    supabase
      .from('patient_docs')
      .select('id, title, created_at')
      .eq('patient_id', props.patient.id)
      .is('completed_at', null)
      .order('created_at'),
  ])
  unpaid.value = invoices ?? []
  awaitingForms.value = docs ?? []
  attentionLoading.value = false
}

const attention = computed<AttentionRow[]>(() => {
  const rows: AttentionRow[] = []
  const owed = unpaid.value.reduce((sum, i) => sum + i.total_cents, 0)
  if (unpaid.value.length > 0) {
    const oldest = unpaid.value[0]
    rows.push({
      key: 'unpaid',
      tone: 'danger',
      icon: 'money',
      sentence:
        unpaid.value.length === 1
          ? `${formatEur(owed)} ${t('unpaid since', 'sin pagar desde el')} ${formatLongDate(oldest.created_at)}`
          : `${formatEur(owed)} ${t('unpaid across', 'sin pagar en')} ${unpaid.value.length} ${t('charges, oldest', 'cargos, el más antiguo del')} ${formatLongDate(oldest.created_at)}`,
      action: t('Take payment', 'Cobrar'),
      go: () => navigateTo(`/patients/${props.patient.id}?tab=money`),
    })
  }
  for (const doc of awaitingForms.value) {
    rows.push({
      key: `doc-${doc.id}`,
      tone: 'warning',
      icon: 'form',
      sentence: `${doc.title} ${t('sent', 'enviado el')} ${formatLongDate(doc.created_at)}, ${t('not returned yet', 'aún sin devolver')}`,
      action: t('Resend', 'Reenviar'),
      go: () => navigateTo(`/patients/${props.patient.id}?tab=attachments`),
    })
  }
  return rows
})

// -- Care plan -------------------------------------------------------------
interface PlanRow { id: string; name: string; total_visits: number; frequency_value: number; frequency_unit: string; started_at: string | null }
const plan = ref<PlanRow | null>(null)
const planCompleted = ref(0)
const planLoading = ref(true)

async function loadPlan() {
  planLoading.value = true
  const [{ data: plans }, { count }] = await Promise.all([
    supabase
      .from('care_plans')
      .select('id, name, total_visits, frequency_value, frequency_unit, started_at')
      .eq('patient_id', props.patient.id)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('patient_id', props.patient.id)
      .eq('status', 'completed'),
  ])
  plan.value = (plans?.[0] as PlanRow) ?? null
  planCompleted.value = count ?? 0
  planLoading.value = false
}

const planPercent = computed(() => {
  if (!plan.value || plan.value.total_visits <= 0) return 0
  return Math.min(100, Math.round((planCompleted.value / plan.value.total_visits) * 100))
})
const planCadence = computed(() => {
  if (!plan.value) return null
  const unit = plan.value.frequency_unit === 'week' ? t('week', 'semana') : t('month', 'mes')
  const plural = plan.value.frequency_unit === 'week' ? t('weeks', 'semanas') : t('months', 'meses')
  return `${plan.value.frequency_value}× ${t('per', 'por')} ${plan.value.frequency_value === 1 ? unit : plural}`
})
// Goals are one free-text field, not a list, so they are split on the
// separators people actually type rather than pretending the schema has
// structure it does not.
const goalChips = computed(() =>
  (props.patient.goals ?? '')
    .split(/[\n;,]+/)
    .map((g) => g.trim())
    .filter(Boolean)
    .slice(0, 6),
)

// -- Clinical snapshot -----------------------------------------------------
// red_flags and yellow_flags are free text, not counts, so a pill says
// whether there is something to read rather than inventing a number by
// splitting prose.
const hasRedFlags = computed(() => !!props.patient.red_flags?.trim())
const hasYellowFlags = computed(() => !!props.patient.yellow_flags?.trim())

// -- The six fields worth a glance ----------------------------------------
function teamMemberName(id: string | null) {
  return teamMembers.value.find((m) => m.id === id)?.full_name ?? t('None', 'Ninguno')
}
const teamMembers = ref<{ id: string; full_name: string }[]>([])

const glanceFields = computed(() => [
  { key: 'dob', label: t('Date of birth', 'Fecha de nacimiento'), value: props.patient.date_of_birth ? formatLongDate(props.patient.date_of_birth) : null },
  { key: 'nif', label: t('National ID', 'DNI/NIE'), value: props.patient.national_id, mono: true },
  { key: 'email', label: t('Email', 'Correo electrónico'), value: props.patient.email },
  { key: 'practitioner', label: t('Practitioner', 'Profesional'), value: teamMemberName(props.patient.default_practitioner_id) },
  { key: 'clinic', label: t('Clinic', 'Clínica'), value: store.clinics.find((c) => c.id === props.patient.clinic_id)?.name ?? null },
  { key: 'referral', label: t('Referred by', 'Origen'), value: props.patient.referral_source },
])

// -- Recent activity -------------------------------------------------------
interface ActivityItem { at: string; text: string; dot: string }
const activity = ref<ActivityItem[]>([])
const activityLoading = ref(true)

async function loadActivity() {
  activityLoading.value = true
  const [{ data: appts }, { data: invoices }, { data: messages }] = await Promise.all([
    supabase
      .from('appointments')
      .select('starts_at, status, appointment_types(name)')
      .eq('patient_id', props.patient.id)
      .order('starts_at', { ascending: false })
      .limit(3),
    supabase.from('invoices').select('created_at, invoice_number, status').eq('patient_id', props.patient.id).order('created_at', { ascending: false }).limit(2),
    // 0164 gates message reads on inbox_access. Asking anyway would return
    // an empty list indistinguishable from "this patient has never been
    // contacted", so the activity feed simply omits the channel instead of
    // quietly reporting silence.
    can('inbox_access')
      ? supabase.from('whatsapp_messages').select('created_at, direction, status').eq('patient_id', props.patient.id).order('created_at', { ascending: false }).limit(2)
      : Promise.resolve({ data: [] as { created_at: string; direction: string; status: string }[] }),
  ])

  const items: ActivityItem[] = []
  for (const a of (appts as any[]) ?? []) {
    const typeNameEn = a.appointment_types?.name ?? 'Visit'
    const typeNameEs = a.appointment_types?.name ?? 'Visita'
    const verbEn = a.status === 'completed' ? 'Completed' : a.status === 'cancelled' ? 'Cancelled' : a.status === 'no_show' ? 'Missed' : 'Booked'
    const verbEs = a.status === 'completed' ? 'completada' : a.status === 'cancelled' ? 'cancelada' : a.status === 'no_show' ? 'no asistida' : 'reservada'
    const text = t(`${verbEn} ${typeNameEn.toLowerCase()} appointment`, `Cita de ${typeNameEs.toLowerCase()} ${verbEs}`)
    items.push({ at: a.starts_at, text, dot: a.status === 'completed' ? 'bg-success-accent' : a.status === 'no_show' || a.status === 'cancelled' ? 'bg-warning-accent' : 'bg-brand' })
  }
  for (const inv of invoices ?? []) {
    const text = t(`Invoice ${inv.invoice_number} ${inv.status === 'paid' ? 'paid' : 'issued'}`, `Factura ${inv.invoice_number} ${inv.status === 'paid' ? 'pagada' : 'emitida'}`)
    items.push({ at: inv.created_at, text, dot: inv.status === 'paid' ? 'bg-success-accent' : 'bg-ink-faint3' })
  }
  for (const m of messages ?? []) {
    items.push({ at: m.created_at, text: m.direction === 'inbound' ? t('Replied via WhatsApp', 'Respondió por WhatsApp') : t('WhatsApp message sent', 'Mensaje de WhatsApp enviado'), dot: 'bg-brand' })
  }
  items.sort((a, b) => b.at.localeCompare(a.at))
  activity.value = items.slice(0, 6)
  activityLoading.value = false
}
onMounted(loadActivity)
watch(() => props.patient.id, loadActivity)

function relativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return t('Today', 'Hoy')
  if (diffDays === 1) return t('Yesterday', 'Ayer')
  if (diffDays === -1) return t('Tomorrow', 'Mañana')
  if (diffDays > 0 && diffDays < 7) return t(`${diffDays}d ago`, `hace ${diffDays}d`)
  if (diffDays < 0 && diffDays > -7) return t(`in ${-diffDays}d`, `en ${-diffDays}d`)
  if (diffDays >= 7 && diffDays < 60) return t(`${Math.round(diffDays / 7)}w ago`, `hace ${Math.round(diffDays / 7)}sem`)
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

async function loadAll() {
  await Promise.all([loadAppointments(), loadAttention(), loadPlan(), loadActivity()])
}
onMounted(async () => {
  const { data } = await supabase.from('team_members').select('id, full_name').order('full_name')
  teamMembers.value = data ?? []
  await loadAll()
})
watch(() => props.patient.id, loadAll)

function onDetailsUpdated() {
  emit('updated')
  loadAll()
}
</script>

<template>
  <div class="flex flex-col gap-4 xl:flex-row xl:items-start">
    <!-- Main column: what needs doing, what is next, where they are, what
         has happened. In that order, because that is the order the question
         gets asked in. -->
    <div class="flex min-w-0 flex-1 flex-col gap-4">
      <!-- 1. Needs attention. Absent, not empty, when there is nothing. -->
      <section v-if="attention.length > 0" aria-labelledby="ov-attention" class="rounded-card border border-line bg-surface shadow-card">
        <h2 id="ov-attention" class="border-b border-line-divider px-4 py-3 text-[13.5px] font-semibold text-ink-700">
          {{ t('Needs attention', 'Requiere atención') }}
        </h2>
        <ul class="divide-y divide-line-row">
          <li v-for="row in attention" :key="row.key" class="flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
            <span
              aria-hidden="true"
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-ctl"
              :class="row.tone === 'danger' ? 'bg-danger-bg text-danger-text' : 'bg-warning-bg text-warning-text'"
            >
              <svg v-if="row.icon === 'money'" viewBox="0 0 16 16" fill="none" class="h-4 w-4">
                <rect x="1.8" y="4" width="12.4" height="8" rx="1.6" stroke="currentColor" stroke-width="1.3" />
                <circle cx="8" cy="8" r="1.8" stroke="currentColor" stroke-width="1.3" />
              </svg>
              <svg v-else viewBox="0 0 16 16" fill="none" class="h-4 w-4">
                <path d="M4 2h5l3 3v9H4z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
                <path d="M9 2v3h3M6 9h4M6 11.5h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
              </svg>
            </span>
            <p class="min-w-0 flex-1 text-[13.5px] text-ink-700">{{ row.sentence }}</p>
            <button
              type="button"
              class="flex h-9 shrink-0 items-center justify-center rounded-ctl border border-line-control px-3 text-[13px] font-semibold text-ink-700 outline-none hover:border-line-controlHover focus-visible:shadow-focus"
              @click="row.go()"
            >
              {{ row.action }}
            </button>
          </li>
        </ul>
      </section>

      <!-- 2. Next appointment -->
      <section aria-labelledby="ov-next" class="rounded-card border border-line bg-surface p-4 shadow-card">
        <h2 id="ov-next" class="text-[13.5px] font-semibold text-ink-700">{{ t('Next appointment', 'Próxima cita') }}</h2>

        <div v-if="apptLoading" class="mt-3 flex items-center gap-3">
          <UiSkeleton class="h-12 w-12 rounded-ctl" />
          <UiSkeleton class="h-4 w-48 rounded-ctlSm" />
        </div>

        <template v-else-if="nextAppt">
          <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div class="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-ctl border border-line bg-surface-subtle2">
              <span class="font-mono text-[16px] font-semibold leading-none text-ink-900">{{ dateBlock(nextAppt.starts_at).day }}</span>
              <span class="mt-0.5 text-[10px] uppercase leading-none text-ink-muted2">{{ dateBlock(nextAppt.starts_at).month }}</span>
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-[15px] text-ink-900">
                <span class="font-mono">{{ formatTime(nextAppt.starts_at) }}</span>
                <span v-if="nextAppt.appointment_types?.name"> · {{ nextAppt.appointment_types.name }}</span>
              </p>
              <p v-if="whereLine(nextAppt)" class="text-[12.5px] text-ink-muted2">{{ whereLine(nextAppt) }}</p>
            </div>
            <UiPill :tone="nextAppt.confirmation_status === 'confirmed' ? 'success' : 'neutral'">
              {{ nextAppt.confirmation_status === 'confirmed' ? t('Confirmed', 'Confirmada') : t('Not confirmed', 'Sin confirmar') }}
            </UiPill>
          </div>

          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="flex h-9 items-center rounded-ctl border border-line-control px-3 text-[13px] font-semibold text-ink-700 outline-none hover:border-line-controlHover focus-visible:shadow-focus"
              @click="navigateTo('/calendar')"
            >
              {{ t('Reschedule', 'Reprogramar') }}
            </button>
            <button
              type="button"
              class="flex h-9 items-center rounded-ctl border border-line-control px-3 text-[13px] font-semibold text-ink-700 outline-none hover:border-line-controlHover focus-visible:shadow-focus"
              @click="navigateTo(`/patients/${patient.id}?tab=appointments`)"
            >
              {{ t('Send confirmation', 'Enviar confirmación') }}
            </button>
          </div>
        </template>

        <p v-else class="mt-3 text-[13px] text-warning-text">{{ t('Nothing booked.', 'Nada reservado.') }}</p>

        <!-- The footnote §4 asks for: the last visit, and how it was paid. -->
        <p v-if="!apptLoading && lastVisitFootnote" class="mt-3 border-t border-line-divider pt-2.5 text-[12.5px] text-ink-muted">
          {{ lastVisitFootnote }}
        </p>
      </section>

      <!-- 3. Care plan -->
      <section aria-labelledby="ov-plan" class="rounded-card border border-line bg-surface p-4 shadow-card">
        <div class="flex items-center justify-between gap-2">
          <h2 id="ov-plan" class="text-[13.5px] font-semibold text-ink-700">{{ t('Care plan', 'Plan de tratamiento') }}</h2>
          <NuxtLink
            :to="`/patients/${patient.id}?tab=clinical`"
            class="text-[12.5px] font-medium text-brand-text outline-none hover:underline focus-visible:shadow-focus"
          >
            {{ t('Open', 'Abrir') }}
          </NuxtLink>
        </div>

        <UiSkeleton v-if="planLoading" class="mt-3 h-4 w-40 rounded-ctlSm" />
        <template v-else-if="plan">
          <p class="mt-2.5 text-[14px] text-ink-900">{{ plan.name }}</p>
          <p class="text-[12.5px] text-ink-muted2">
            {{ t('Visit', 'Visita') }} {{ Math.min(planCompleted, plan.total_visits) }} {{ t('of', 'de') }} {{ plan.total_visits }}
            <template v-if="planCadence"> · {{ planCadence }}</template>
            <template v-if="plan.started_at"> · {{ t('since', 'desde') }} {{ formatLongDate(plan.started_at) }}</template>
          </p>
          <div class="mt-2 h-[6px] w-full overflow-hidden rounded-full bg-chip-bg2">
            <div class="h-full rounded-full bg-brand" :style="{ width: `${planPercent}%` }" />
          </div>
          <div v-if="goalChips.length > 0" class="mt-3 flex flex-wrap gap-1.5">
            <span v-for="goal in goalChips" :key="goal" class="rounded-pill bg-chip-bg px-2 py-0.5 text-[11.5px] text-chip-text">{{ goal }}</span>
          </div>
        </template>
        <p v-else class="mt-3 text-[13px] text-ink-faint">{{ t('No plan set up for this patient yet.', 'Aún no hay plan para este paciente.') }}</p>
      </section>

      <!-- 4. Recent activity -->
      <section aria-labelledby="ov-activity" class="rounded-card border border-line bg-surface p-4 shadow-card">
        <div class="flex items-center justify-between gap-2">
          <h2 id="ov-activity" class="text-[13.5px] font-semibold text-ink-700">{{ t('Recent activity', 'Actividad reciente') }}</h2>
          <NuxtLink
            :to="`/patients/${patient.id}?tab=appointments`"
            class="text-[12.5px] font-medium text-brand-text outline-none hover:underline focus-visible:shadow-focus"
          >
            {{ t('View all', 'Ver todo') }}
          </NuxtLink>
        </div>
        <div v-if="activityLoading" class="mt-3 space-y-2.5">
          <div v-for="i in 3" :key="i" class="flex items-center gap-2.5">
            <UiSkeleton class="h-[6px] w-[6px] shrink-0 rounded-full" />
            <UiSkeleton class="h-3 w-40 rounded-ctlSm" />
          </div>
        </div>
        <p v-else-if="activity.length === 0" class="mt-3 text-[12.5px] text-ink-faint">{{ t('No recent activity.', 'Sin actividad reciente.') }}</p>
        <ul v-else class="mt-3 space-y-2.5">
          <li v-for="(item, i) in activity.slice(0, 5)" :key="i" class="flex items-center gap-2.5">
            <span aria-hidden="true" class="h-[6px] w-[6px] shrink-0 rounded-full" :class="item.dot" />
            <span class="min-w-0 flex-1 truncate text-[12.5px] text-ink-600">{{ item.text }}</span>
            <span class="shrink-0 text-[11.5px] text-ink-faint">{{ relativeTime(item.at) }}</span>
          </li>
        </ul>
      </section>
    </div>

    <!-- Side column -->
    <div class="flex w-full shrink-0 flex-col gap-4 xl:w-[356px]">
      <section aria-labelledby="ov-clinical" class="rounded-card border border-line bg-surface p-4 shadow-card">
        <div class="flex items-center justify-between gap-2">
          <h2 id="ov-clinical" class="text-[13.5px] font-semibold text-ink-700">{{ t('Clinical snapshot', 'Resumen clínico') }}</h2>
          <NuxtLink
            :to="`/patients/${patient.id}?tab=clinical`"
            class="text-[12.5px] font-medium text-brand-text outline-none hover:underline focus-visible:shadow-focus"
          >
            {{ t('Open', 'Abrir') }}
          </NuxtLink>
        </div>

        <dl class="mt-3 space-y-2.5">
          <div>
            <dt class="text-[11.5px] text-ink-muted2">{{ t('Chief complaint', 'Motivo de consulta') }}</dt>
            <dd class="mt-0.5 text-[13.5px] text-ink-700">{{ patient.chief_complaint || t('Not recorded', 'Sin registrar') }}</dd>
          </div>
          <div>
            <dt class="text-[11.5px] text-ink-muted2">{{ t('Working diagnosis', 'Diagnóstico de trabajo') }}</dt>
            <dd class="mt-0.5 text-[13.5px] text-ink-700">{{ patient.diagnosis || t('Not recorded', 'Sin registrar') }}</dd>
          </div>
        </dl>

        <!-- A pill says there is something to read. The flags are free text,
             so it cannot honestly say how many. -->
        <div v-if="hasRedFlags || hasYellowFlags" class="mt-3 flex flex-wrap gap-1.5">
          <UiPill v-if="hasRedFlags" tone="danger">{{ t('Red flags', 'Señales rojas') }}</UiPill>
          <UiPill v-if="hasYellowFlags" tone="warning">{{ t('Yellow flags', 'Señales amarillas') }}</UiPill>
        </div>
      </section>

      <section aria-labelledby="ov-details" class="rounded-card border border-line bg-surface p-4 shadow-card">
        <h2 id="ov-details" class="text-[13.5px] font-semibold text-ink-700">{{ t('Patient details', 'Datos del paciente') }}</h2>
        <dl class="mt-3 space-y-2.5">
          <div v-for="field in glanceFields" :key="field.key">
            <dt class="text-[11.5px] text-ink-muted2">{{ field.label }}</dt>
            <dd class="mt-0.5 truncate text-[13.5px] text-ink-700" :class="field.mono ? 'font-mono text-[12.5px]' : ''">
              {{ field.value || t('Not recorded', 'Sin registrar') }}
            </dd>
          </div>
        </dl>
        <button
          v-if="can('patients_edit')"
          type="button"
          class="mt-3 flex h-9 w-full items-center justify-center rounded-ctl border border-line-control text-[13px] font-semibold text-ink-700 outline-none hover:border-line-controlHover focus-visible:shadow-focus"
          @click="detailsOpen = true"
        >
          {{ t('Edit all details', 'Editar todos los datos') }}
        </button>
        <button
          v-else
          type="button"
          class="mt-3 flex h-9 w-full items-center justify-center rounded-ctl border border-line-control text-[13px] font-semibold text-ink-700 outline-none hover:border-line-controlHover focus-visible:shadow-focus"
          @click="detailsOpen = true"
        >
          {{ t('View all details', 'Ver todos los datos') }}
        </button>
      </section>
    </div>

    <PatientsDetailsDialog v-if="detailsOpen" :patient="patient" @close="detailsOpen = false" @updated="onDetailsUpdated" />
  </div>
</template>

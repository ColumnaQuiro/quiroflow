<script setup lang="ts">
import { formatEur, formatTime } from '~/utils/billing'
import { openEndedPlanLabel, planVisitsToBook } from '~/utils/planRenewal'
import { patientAge } from '~/utils/patientAge'
import { resolveVisitPayment, type VisitPayment } from '~/utils/visitPayment'
import type { Tables } from '~/types/database.types'
import type { CareStop } from '~/composables/useCareStopReasons'

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
const { formatLongDate, dateBlock } = useDates()
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
// Each card answers a question ("anything booked?", "anything owed?"), and a
// failed read must not answer it. supabase-js hands back { data: null, error }
// rather than throwing, and `data ?? []` turned a dropped connection into
// "Nothing booked." in amber, an absent "Needs attention" and "No plan set up"
// -- three confident statements about a patient, all false. The layout's toast
// says a query failed; these say which card cannot be trusted.
const apptFailed = ref(false)

// -- One request for the whole tab ------------------------------------------
// patient_overview (20261111192000) answers what this tab and the cards it
// mounts used to ask in some twenty-five requests: on a two-core database
// each costs 50-100 ms whatever it returns, and the ones fired together
// queue. It only carries the rows -- the same columns, filters and order the
// selects had, read under the viewer's own policies -- and everything shown
// is still worked out here, from them.
type BonoRow = { id: string; package_name: string; sessions_total: number; sessions_used: number; is_closed: boolean; patients?: { first_name: string; last_name: string | null } | null }
interface OverviewData {
  next_appointment: ApptRow | null
  last_visit: ApptRow | null
  last_visit_payment: {
    session: { amount_cents: number; external_reference: string | null; package_purchases: { package_name: string; sessions_total: number; sessions_used: number; external_reference: string | null } | null } | null
    invoice: { id: string; invoice_number: string; total_cents: number; status: string } | null
    payments: { id: string; method: string; amount_cents: number }[]
    facturas: { number: string }[]
  }
  unpaid_invoices: { invoice_number: string; total_cents: number; created_at: string }[]
  awaiting_docs: { id: string; title: string; created_at: string }[]
  plan: PlanRow | null
  plan_completed: number
  plan_scheduled: number
  plan_upcoming: number
  plan_bono: { package_name: string; sessions_total: number; sessions_used: number; is_closed: boolean } | null
  plan_membership: { membership_name: string; price_cents: number; status: string; billing_interval: string | null; billing_interval_count: number | null } | null
  plan_visits: { starts_at: string; status: string }[]
  bonos_own: BonoRow[]
  bonos_shared: { package_purchases: BonoRow | null }[]
  // FamilyCard's own rows; it types them.
  family_links: unknown[]
  family_managers: unknown[]
  care_stop: CareStop | null
  care_stop_reasons: { id: string; name: string }[]
  team_members: { id: string; full_name: string }[]
}
const overview = ref<OverviewData | null>(null)
// The request failed and nothing has landed yet. The three cards say so; the
// side cards are told to ask for their own (undefined), as they do anywhere
// else they are mounted.
const overviewFailed = ref(false)

let overviewRun = 0
async function loadOverview({ silent = false } = {}) {
  const run = ++overviewRun
  if (!silent) {
    apptLoading.value = true
    attentionLoading.value = true
    planLoading.value = true
  }
  const { data, error } = await supabase.rpc('patient_overview' as never, { p_patient_id: props.patient.id, p_now: new Date().toISOString() } as never)
  if (run !== overviewRun) return
  // One request, so the cards fail together. What each held stays as it was:
  // a silent reload after an edit should not wipe an unpaid charge off the
  // screen because one request dropped.
  const failed = !!error || !data
  apptFailed.value = failed
  attentionFailed.value = failed
  planFailed.value = failed
  if (failed) {
    overviewFailed.value = !overview.value
    teamLoaded.value = true
  } else {
    const o = data as unknown as OverviewData
    overview.value = o
    overviewFailed.value = false
    nextAppt.value = o.next_appointment ?? null
    lastVisit.value = o.last_visit ?? null
    lastVisitPayment.value = o.last_visit ? paymentOf(o.last_visit_payment) : null
    unpaid.value = o.unpaid_invoices ?? []
    awaitingForms.value = o.awaiting_docs ?? []
    plan.value = o.plan ?? null
    // No plan, no counts: the three were only asked for once a plan was found.
    planCompleted.value = o.plan ? o.plan_completed ?? 0 : 0
    planScheduled.value = o.plan ? o.plan_scheduled ?? 0 : 0
    planUpcoming.value = o.plan ? o.plan_upcoming ?? 0 : 0
    teamMembers.value = o.team_members ?? []
    teamLoaded.value = true
  }
  apptLoading.value = false
  attentionLoading.value = false
  planLoading.value = false
}

// The same four-table walk the Appointments tab does, for one visit: the
// footnote says how the last one was paid, and "paid" is not a column. The
// rows arrive with the rest; they were four round trips, two of them waiting
// on the one before.
function paymentOf(raw: OverviewData['last_visit_payment'] | null | undefined): VisitPayment {
  const session = raw?.session ?? null
  const invoice = raw?.invoice ?? null
  return resolveVisitPayment({
    session: session ? { amount_cents: session.amount_cents, external_reference: session.external_reference } : null,
    purchase: session?.package_purchases ?? null,
    invoice: invoice ? { invoice_number: invoice.invoice_number, total_cents: invoice.total_cents, status: invoice.status } : null,
    payments: (raw?.payments ?? []).map((p) => ({ method: p.method, amount_cents: p.amount_cents })),
    facturaNumbers: (raw?.facturas ?? []).map((f) => f.number),
  })
}

// What the side cards are handed: null while the request is out (they wait),
// the rows once it is in, undefined if it failed before anything landed (they
// fetch their own, as they do when mounted anywhere else).
const sideData = computed(() => (overview.value ? overview.value : overviewFailed.value ? undefined : null))
const bonosPreload = computed(() => sideData.value && { own: sideData.value.bonos_own ?? [], shared: sideData.value.bonos_shared ?? [] })
const familyPreload = computed(() => sideData.value && { links: sideData.value.family_links ?? [], managers: sideData.value.family_managers ?? [] })
// The plan's cards are only mounted once the plan is in, so they never wait.
const planPaymentPreload = computed(() => (overview.value ? { bono: overview.value.plan_bono ?? null, membership: overview.value.plan_membership ?? null } : undefined))
const careStopPreload = computed(() => {
  const o = sideData.value
  if (!o) return o
  const by = o.care_stop?.recorded_by ?? null
  return {
    current: o.care_stop ?? null,
    reasons: o.care_stop_reasons ?? [],
    recordedBy: by ? (o.team_members ?? []).find((m) => m.id === by)?.full_name ?? null : null,
  }
})

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
  if (!payment || payment.kind === 'none') return t(`Last visit ${when}.`, `Última visita ${when}.`)
  if (payment.kind === 'bono') return t(`Last visit ${when}, drawn from ${payment.packageName}.`, `Última visita ${when}, con cargo a ${payment.packageName}.`)
  if (payment.kind === 'unpaid') {
    const amount = formatEur(payment.totalCents)
    return t(`Last visit ${when}, still unpaid (${amount}).`, `Última visita ${when}, aún sin pagar (${amount}).`)
  }
  if (payment.kind === 'void') return t(`Last visit ${when}, charge voided.`, `Última visita ${when}, cargo anulado.`)
  if (payment.methods.length === 0) return t(`Last visit ${when}, paid.`, `Última visita ${when}, pagada.`)
  const methods = payment.methods.map((m) => METHOD_LABELS.value[m] ?? m).join(' + ')
  return t(`Last visit ${when}, paid by ${methods}.`, `Última visita ${when}, pagada con ${methods}.`)
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
const attentionFailed = ref(false)

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
          ? t(`${formatEur(owed)} unpaid since ${formatLongDate(oldest.created_at)}`, `${formatEur(owed)} sin pagar desde el ${formatLongDate(oldest.created_at)}`)
          : t(
              `${formatEur(owed)} unpaid across ${unpaid.value.length} charges, the oldest from ${formatLongDate(oldest.created_at)}`,
              `${formatEur(owed)} sin pagar en ${unpaid.value.length} cargos, el más antiguo del ${formatLongDate(oldest.created_at)}`,
            ),
      action: t('Take payment', 'Cobrar'),
      go: () => navigateTo(`/patients/${props.patient.id}?tab=money`),
    })
  }
  for (const doc of awaitingForms.value) {
    rows.push({
      key: `doc-${doc.id}`,
      tone: 'warning',
      icon: 'form',
      sentence: t(`${doc.title} sent ${formatLongDate(doc.created_at)}, not returned yet`, `${doc.title} enviado el ${formatLongDate(doc.created_at)}, aún sin devolver`),
      action: t('Open forms', 'Ver formularios'),
      go: () => navigateTo(`/patients/${props.patient.id}?tab=attachments`),
    })
  }
  return rows
})

// -- Care plan -------------------------------------------------------------
interface PlanRow { id: string; name: string; total_visits: number | null; frequency_value: number; frequency_unit: string; visits_per_period: number | null; started_at: string | null; payment_kind: string | null; package_purchase_id: string | null; patient_membership_id: string | null }
const plan = ref<PlanRow | null>(null)
const planCompleted = ref(0)
// Booked and not yet come, since the plan started: what is left to book is
// the rest (PhaseStats counts it the same way).
const planScheduled = ref(0)
// Booked and still ahead: a plan with no end warns when there is none.
const planUpcoming = ref(0)
const planLoading = ref(true)
const planFailed = ref(false)

// Visits completed SINCE THE PLAN STARTED, and not deleted -- as
// care_plan_continuity_alerts (0131), the Clinical tab's PhaseStats and the
// app count them. Every completed visit ever put a returning patient's new
// plan half done on day one. Counted in patient_overview, with the plan.

const planToBook = computed(() => (plan.value ? planVisitsToBook(plan.value, planCompleted.value, planScheduled.value) : 0))
const planBookLabel = computed(() => {
  const n = planToBook.value
  if (plan.value?.total_visits === null) return n === 1 ? t('Book the next visit', 'Reservar la próxima visita') : t(`Book the next ${n} visits`, `Reservar las próximas ${n} visitas`)
  return n === 1 ? t('Book the 1 visit left', 'Reservar la visita que falta') : t(`Book the ${n} visits left`, `Reservar las ${n} visitas que faltan`)
})

const planPercent = computed(() => {
  if (!plan.value || !plan.value.total_visits || plan.value.total_visits <= 0) return 0
  return Math.min(100, Math.round((planCompleted.value / plan.value.total_visits) * 100))
})
const seesAllVisits = computed(() => store.isOwner || store.permissions.calendar_scope === 'all')
const planCadence = computed(() => (plan.value ? carePlanCadenceLabel(plan.value, t) : null))
// Goals are one free-text field, not a list, so they are split on the
// separators people actually type rather than pretending the schema has
// structure it does not.
const goalChips = computed(() =>
  (props.patient.goals ?? '')
    .split(/[\n;,]+/)
    .map((g) => g.trim())
    .filter(Boolean)
    .filter((goal, i, all) => all.findIndex((g) => g.toLowerCase() === goal.toLowerCase()) === i)
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
const teamLoaded = ref(false)

const withAge = (date: string, age: number | null) => (age === null ? date : `${date} · ${t(`${age} years old`, `${age} años`)}`)

const glanceFields = computed(() => [
  { key: 'dob', label: t('Date of birth', 'Fecha de nacimiento'), value: props.patient.date_of_birth ? withAge(formatLongDate(props.patient.date_of_birth), patientAge(props.patient.date_of_birth)) : null },
  { key: 'nif', label: t('National ID', 'DNI/NIE'), value: props.patient.national_id, mono: true },
  { key: 'email', label: t('Email', 'Correo electrónico'), value: props.patient.email },
  {
    key: 'practitioner',
    label: t('Practitioner', 'Profesional'),
    value: teamMemberName(props.patient.default_practitioner_id),
    // Until the list is in, an assigned practitioner would read as "None".
    pending: !!props.patient.default_practitioner_id && !teamLoaded.value,
  },
  { key: 'clinic', label: t('Clinic', 'Clínica'), value: store.clinics.find((c) => c.id === props.patient.clinic_id)?.name ?? null },
  { key: 'referral', label: t('Referral source', 'Fuente de referencia'), value: props.patient.referral_source },
])

// -- Activity: the timeline component loads its own, and reloads with the
// rest after an edit (loadAll).
const timeline = ref<{ reload: (opts?: { silent?: boolean }) => Promise<void> } | null>(null)

// Silent after an edit: the cards already hold the last answer, and swapping
// them all for skeletons to confirm it reads as the page reloading.
//
// The timeline is reloaded only after an edit. It loads itself when it
// mounts and when the patient changes (usePatientTimeline), so asking it
// again from here ran its queries twice on every record opened.
async function loadAll(options: { silent?: boolean; timeline?: boolean } = {}) {
  const { timeline: withTimeline = true, ...rest } = options
  await Promise.all([loadOverview(rest), withTimeline ? timeline.value?.reload(rest) : null])
}
onMounted(() => loadAll({ timeline: false }))
watch(() => props.patient.id, () => loadAll({ timeline: false }))

const retryingCards = ref(false)
async function retryCards() {
  if (retryingCards.value) return
  retryingCards.value = true
  try {
    await loadOverview()
  } finally {
    retryingCards.value = false
  }
}

function onDetailsUpdated() {
  emit('updated')
  loadAll({ silent: true })
}
</script>

<template>
  <div class="flex flex-col gap-4 xl:flex-row xl:items-start">
    <!-- Main column: what needs doing, what is next, where they are, what
         has happened. In that order, because that is the order the question
         gets asked in. -->
    <div class="flex min-w-0 flex-1 flex-col gap-4">
      <!-- 1. Needs attention. Absent, not empty, when there is nothing --
           but present when it could not be checked, because absent is read
           as "nothing owed". -->
      <section v-if="attention.length > 0 || attentionFailed" aria-labelledby="ov-attention" class="rounded-card border border-line bg-surface shadow-card">
        <h2 id="ov-attention" class="border-b border-line-divider px-4 py-3 text-[13.5px] font-semibold text-ink-700">
          {{ t('Needs attention', 'Requiere atención') }}
        </h2>
        <div v-if="attentionFailed" class="flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-3" :class="attention.length > 0 ? 'border-b border-line-row' : ''" data-cy="overview-attention-failed">
          <p class="min-w-0 flex-1 text-[13px] text-danger-text">
            {{ t("Couldn't check for unpaid charges or forms not returned.", 'No se ha podido comprobar si hay cargos sin pagar o formularios sin devolver.') }}
          </p>
          <UiBtn size="sm" :disabled="retryingCards" @click="retryCards">{{ t('Try again', 'Reintentar') }}</UiBtn>
        </div>
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
            <p class="min-w-0 flex-1 break-words text-[13.5px] text-ink-700">{{ row.sentence }}</p>
            <button
              type="button"
              class="flex h-9 shrink-0 items-center justify-center rounded-ctl border border-line-control px-3 text-[13px] font-semibold text-ink-700 outline-none hover:border-line-controlHover focus-visible:shadow-focus touch:h-11"
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

        <div v-else-if="apptFailed" class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2" data-cy="overview-next-failed">
          <p class="text-[13px] text-danger-text">{{ t("Couldn't load their appointments.", 'No se han podido cargar sus citas.') }}</p>
          <UiBtn size="sm" :disabled="retryingCards" @click="retryCards">{{ t('Try again', 'Reintentar') }}</UiBtn>
        </div>

        <template v-else-if="nextAppt">
          <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div class="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-ctl border border-line bg-surface-subtle2">
              <span class="font-mono text-[16px] font-semibold leading-none text-ink-900">{{ dateBlock(nextAppt.starts_at).day }}</span>
              <span class="mt-0.5 text-[11px] uppercase leading-none text-ink-muted2">{{ dateBlock(nextAppt.starts_at).month }}</span>
            </div>
            <div class="min-w-0 flex-1">
              <p class="break-words text-[15px] text-ink-900">
                <span class="font-mono">{{ formatTime(nextAppt.starts_at) }}</span>
                <span v-if="nextAppt.appointment_types?.name"> · {{ nextAppt.appointment_types.name }}</span>
              </p>
              <p v-if="whereLine(nextAppt)" class="break-words text-[12.5px] text-ink-muted2">{{ whereLine(nextAppt) }}</p>
            </div>
            <UiPill :tone="nextAppt.confirmation_status === 'confirmed' ? 'success' : 'neutral'">
              {{ nextAppt.confirmation_status === 'confirmed' ? t('Confirmed', 'Confirmada') : t('Not confirmed', 'Sin confirmar') }}
            </UiPill>
          </div>

          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="flex h-9 items-center rounded-ctl border border-line-control px-3 text-[13px] font-semibold text-ink-700 outline-none hover:border-line-controlHover focus-visible:shadow-focus touch:h-11"
              @click="navigateTo('/calendar')"
            >
              {{ t('Reschedule', 'Reprogramar') }}
            </button>
            <button
              type="button"
              class="flex h-9 items-center rounded-ctl border border-line-control px-3 text-[13px] font-semibold text-ink-700 outline-none hover:border-line-controlHover focus-visible:shadow-focus touch:h-11"
              @click="navigateTo(`/patients/${patient.id}?tab=appointments`)"
            >
              {{ t('Send confirmation', 'Enviar confirmación') }}
            </button>
          </div>
        </template>

        <p v-else class="mt-3 text-[13px] text-warning-text">{{ t('Nothing booked.', 'Nada reservado.') }}</p>

        <!-- The footnote §4 asks for: the last visit, and how it was paid. -->
        <p v-if="!apptLoading && !apptFailed && lastVisit && lastVisitFootnote" class="mt-3 border-t border-line-divider pt-2.5 text-[12.5px] text-ink-muted">
          {{ lastVisitFootnote }}
        </p>
      </section>

      <!-- 3. Care plan -->
      <section aria-labelledby="ov-plan" class="rounded-card border border-line bg-surface p-4 shadow-card">
        <div class="flex items-center justify-between gap-2">
          <h2 id="ov-plan" class="text-[13.5px] font-semibold text-ink-700">{{ t('Care plan', 'Plan de cuidados') }}</h2>
          <NuxtLink
            :to="`/patients/${patient.id}?tab=clinical`"
            class="text-[12.5px] font-medium text-brand-text outline-none hover:underline focus-visible:shadow-focus"
          >
            {{ t('Open', 'Abrir') }}
          </NuxtLink>
        </div>

        <UiSkeleton v-if="planLoading" class="mt-3 h-4 w-40 rounded-ctlSm" />
        <div v-else-if="planFailed" class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2" data-cy="overview-plan-failed">
          <p class="text-[13px] text-danger-text">{{ t("Couldn't load their care plan.", 'No se ha podido cargar su plan de cuidados.') }}</p>
          <UiBtn size="sm" :disabled="retryingCards" @click="retryCards">{{ t('Try again', 'Reintentar') }}</UiBtn>
        </div>
        <template v-else-if="plan">
          <p class="mt-2.5 break-words text-[14px] text-ink-900">{{ plan.name }}</p>
          <p v-if="plan.total_visits === null" class="text-[12.5px] text-ink-muted2 first-letter:uppercase" data-cy="overview-plan-open-ended">
            {{ plan.started_at ? openEndedPlanLabel(planCompleted, plan.started_at, t) : t(`maintenance visit ${planCompleted}`, `visita ${planCompleted} de mantenimiento`) }}
            <template v-if="planCadence"> · {{ planCadence }}</template>
          </p>
          <template v-else>
            <p class="text-[12.5px] text-ink-muted2">
              {{ t(`Visit ${Math.min(planCompleted, plan.total_visits)} of ${plan.total_visits}`, `Visita ${Math.min(planCompleted, plan.total_visits)} de ${plan.total_visits}`) }}
              <template v-if="planCadence"> · {{ planCadence }}</template>
              <template v-if="plan.started_at"> · {{ t(`since ${formatLongDate(plan.started_at)}`, `desde el ${formatLongDate(plan.started_at)}`) }}</template>
            </p>
            <div class="mt-2 h-[6px] w-full overflow-hidden rounded-full bg-chip-bg2">
              <div class="h-full rounded-full bg-brand" :style="{ width: `${planPercent}%` }" />
            </div>
          </template>
          <p v-if="plan.total_visits === null && planUpcoming === 0" class="mt-2 rounded-ctl bg-warning-bg px-2.5 py-1.5 text-[12.5px] font-medium text-warning-text" data-cy="overview-plan-no-next">
            {{ t('No next visit booked.', 'No tiene la próxima visita reservada.') }}
          </p>
          <PatientsPlanPayment
            :plan="plan"
            :visits-left="plan.total_visits === null ? 0 : Math.max(0, plan.total_visits - planCompleted)"
            :preloaded="planPaymentPreload"
          />
          <!-- The plan's visits not booked yet, in one go: the calendar opens
               with "repeat as the care plan" chosen, at the plan's cadence.
               It was only on the Clinical tab. -->
          <NuxtLink
            v-if="planToBook > 0"
            :to="{ path: '/calendar', query: { patient: patient.id, repeat: 'plan' } }"
            class="mt-2.5 inline-flex h-8 items-center rounded-ctl border border-line-control px-3 text-[12.5px] font-semibold text-brand-text outline-none hover:bg-surface-subtle focus-visible:shadow-focus touch:h-10"
            data-cy="overview-plan-book"
          >
            {{ planBookLabel }}
          </NuxtLink>
          <!-- Period by period: only for someone who sees every visit, or a
               colleague's attended visit would read as one missed. -->
          <PatientsPlanPeriods
            v-if="plan.started_at && seesAllVisits"
            :patient-id="patient.id"
            :plan="{ ...plan, started_at: plan.started_at }"
            :preloaded-visits="overview?.plan_visits"
          />
          <div v-if="goalChips.length > 0" class="mt-3 flex flex-wrap gap-1.5">
            <span v-for="goal in goalChips" :key="goal" class="max-w-full truncate rounded-pill bg-chip-bg px-2 py-0.5 text-[11.5px] text-chip-text" :title="goal">{{ goal }}</span>
          </div>
        </template>
        <p v-else class="mt-3 text-[13px] text-ink-faint">{{ t('No plan set up for this patient yet.', 'Aún no hay plan para este paciente.') }}</p>
      </section>

      <!-- 4. Activity: everything that happened to them, newest first. -->
      <PatientsActivityTimeline ref="timeline" :patient-id="patient.id" />
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
            <dd class="mt-0.5 line-clamp-4 whitespace-pre-line break-words text-[13.5px] text-ink-700">{{ patient.chief_complaint?.trim() || t('Not recorded', 'Sin registrar') }}</dd>
          </div>
          <div>
            <dt class="text-[11.5px] text-ink-muted2">{{ t('Working diagnosis', 'Diagnóstico de trabajo') }}</dt>
            <dd class="mt-0.5 line-clamp-4 whitespace-pre-line break-words text-[13.5px] text-ink-700">{{ patient.diagnosis?.trim() || t('Not recorded', 'Sin registrar') }}</dd>
          </div>
        </dl>

        <!-- A pill says there is something to read. The flags are free text,
             so it cannot honestly say how many. -->
        <div v-if="hasRedFlags || hasYellowFlags" class="mt-3 flex flex-wrap gap-1.5">
          <UiPill v-if="hasRedFlags" tone="danger">{{ t('Red flags', 'Señales rojas') }}</UiPill>
          <UiPill v-if="hasYellowFlags" tone="warning">{{ t('Yellow flags', 'Señales amarillas') }}</UiPill>
        </div>
      </section>

      <PatientsBonosCard :patient-id="patient.id" :preloaded="bonosPreload" />

      <PatientsPregnancyCard :patient="patient" @updated="emit('updated')" />

      <PatientsFamilyCard :patient="patient" :preloaded="familyPreload" />

      <!-- After the bookings have loaded: the card leaves itself out for a
           patient with one coming (CareStopCard). -->
      <PatientsCareStopCard v-if="!apptLoading && !apptFailed" :patient="patient" :booked="!!nextAppt" :preloaded="careStopPreload" />

      <section aria-labelledby="ov-details" class="rounded-card border border-line bg-surface p-4 shadow-card">
        <h2 id="ov-details" class="text-[13.5px] font-semibold text-ink-700">{{ t('Patient details', 'Datos del paciente') }}</h2>
        <dl class="mt-3 space-y-2.5">
          <div v-for="field in glanceFields" :key="field.key">
            <dt class="text-[11.5px] text-ink-muted2">{{ field.label }}</dt>
            <dd v-if="field.pending" class="mt-1"><UiSkeleton class="h-3.5 w-32 rounded-ctlSm" /></dd>
            <!-- The placeholder reads as an absence: muted, and never in the
                 mono face meant for the ID number it stands in for. -->
            <dd v-else-if="field.value" class="mt-0.5 truncate text-[13.5px] text-ink-700" :class="field.mono ? 'font-mono text-[12.5px]' : ''" :title="field.value">
              {{ field.value }}
            </dd>
            <dd v-else class="mt-0.5 text-[13.5px] text-ink-faint">{{ t('Not recorded', 'Sin registrar') }}</dd>
          </div>
        </dl>
        <button
          v-if="can('patients_edit')"
          type="button"
          class="mt-3 flex h-9 w-full items-center justify-center rounded-ctl border border-line-control text-[13px] font-semibold text-ink-700 outline-none hover:border-line-controlHover focus-visible:shadow-focus touch:h-11"
          @click="detailsOpen = true"
        >
          {{ t('Edit all details', 'Editar todos los datos') }}
        </button>
        <button
          v-else
          type="button"
          class="mt-3 flex h-9 w-full items-center justify-center rounded-ctl border border-line-control text-[13px] font-semibold text-ink-700 outline-none hover:border-line-controlHover focus-visible:shadow-focus touch:h-11"
          @click="detailsOpen = true"
        >
          {{ t('View all details', 'Ver todos los datos') }}
        </button>
      </section>
    </div>

    <PatientsDetailsDialog v-if="detailsOpen" :patient="patient" @close="detailsOpen = false" @updated="onDetailsUpdated" />
  </div>
</template>

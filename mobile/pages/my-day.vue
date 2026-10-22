<script setup lang="ts">
import type { NoShowRisk } from '../../utils/noShowRisk'
// My Day: the signed-in person's own day, at a glance.
//
// Everything here is about the viewer -- their visits, their patients, their
// takings -- whatever their role, owners included. The web dashboard lets an
// owner look at the whole clinic; this screen is "what is MY day", so it never
// widens. What the role decides is whether money is on it at all.
//
// Every figure reuses the web's definition rather than a second copy:
//   - visit stage           utils/appointmentStage (appointmentStage, needsNextBookingFlag)
//   - new patients          Statistics: a first_visit / first_visit_offer visit
//   - takings               Daily transactions: receipts only (utils/paymentReceipts),
//                           attributed by utils/incomeAttribution
//   - what a patient owes   patient_live_balances.outstanding_cents, as the calendar
//   - recalls due           recall_candidates by default_practitioner_id, as the dashboard
// No balance is computed here.
definePageMeta({ layout: 'practitioner' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

interface Appointment {
  id: string
  patient_id: string
  starts_at: string
  status: string
  confirmation_status: string | null
  source: string | null
  checked_in_at: string | null
  flow_with_practitioner_at: string | null
  flow_checkout_at: string | null
  patients: { first_name: string; last_name: string | null } | null
  appointment_types: { name: string; stage: string | null } | null
}

// What an automation's "notify" step asked this person, or their role, to
// do -- the same list as the web's Mi día (components/practitioner/MyDayTasks.vue).
interface Task {
  id: string
  title: string
  done_at: string | null
  patient_id: string | null
  patients: { first_name: string; last_name: string | null } | null
  automation_rules: { name: string } | null
}

interface PaymentRow {
  amount_cents: number
  method: string
  patient_id: string | null
  invoice_id: string | null
  invoices: { status: string; appointment_id: string | null; appointments: { practitioner_id: string | null; clinic_id: string | null } | null } | null
  patients: { default_practitioner_id: string | null; clinic_id: string | null } | null
}

interface BirthdayPatient { id: string; first_name: string; last_name: string | null; date_of_birth: string | null }

const t = useT()
const { preference: lang } = useLang()
const supabase = useSupabaseClient()
const { context, loading: contextLoading, can, restricted, ownDiaryOnly } = usePractitionerContext()
// The avatar in the header, which is where Profile lives on a phone now.
const profileInitials = computed(() => (context.value?.fullName ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?')
const profilePhotoUrl = computed(() => (context.value?.photoStoragePath ? supabase.storage.from('team-member-photos').getPublicUrl(context.value.photoStoragePath).data.publicUrl : null))

const appointments = ref<Appointment[]>([])
const tasks = ref<Task[]>([])
const birthdays = ref<BirthdayPatient[]>([])
const recallsDue = ref<number | null>(null)
// Waiting or offered a slot: the web's waitlist page, active entries.
const waitlistActive = ref<number | null>(null)
// What patients did on their own today, from the app or the portal: joined
// the waitlist, paid online (staffPush's patient_actions, as a glance).
const waitlistSelfToday = ref(0)
const onlineToday = ref<{ count: number; cents: number } | null>(null)
// This person's patients on a care plan and behind its cadence, as
// Recalls due is narrowed (care_plan_continuity_alerts).
const plansBehind = ref<number | null>(null)
const takingsCents = ref<number | null>(null)
// patient -> ids of their future, live appointments (any practitioner's the
// role can see). Until it has answered, nobody is flagged "No next visit".
const futureByPatient = ref<Map<string, Set<string>> | null>(null)
const owedByPatient = ref<Map<string, number>>(new Map())
const loading = ref(true)
const errors = ref<string[]>([])
const showTasks = ref(false)

// Money is on the screen only for a role that can read it on the web: taking
// payments (billing_access, which RLS on payments and invoices also requires)
// and seeing the billing history (billing_history_view, which gates the
// patient's Money tab and statement). An owner holds both.
const seesMoney = computed(() => can('billing_access') && can('billing_history_view'))
const seesRecalls = computed(() => can('recalls_access'))
// With calendar_scope 'own', RLS shows this person only their own diary, so
// "nothing booked" means "nothing booked with you" -- a colleague's booking
// for the same patient is invisible here, as it is on the web calendar
// (ownDiaryOnly).

const timeZone = computed(() => context.value?.timeZone || DEFAULT_CLINIC_TIMEZONE)
const locale = computed(() => (lang.value === 'es' ? 'es-ES' : 'en-GB'))

function today() {
  return localDay(new Date(), timeZone.value)
}

function capture(label: string, error: { message?: string } | null | undefined) {
  if (error) errors.value.push(`${label}: ${error.message ?? String(error)}`)
}

let run = 0
async function load({ silent = false } = {}) {
  const ctx = context.value
  if (!ctx) {
    loading.value = false
    return
  }
  const mine = ++run
  if (!silent) loading.value = true
  const nextErrors: string[] = []
  // One failing query names itself and leaves the rest of the day standing.
  async function settle<T>(label: string, query: PromiseLike<T>): Promise<T | null> {
    try {
      return await query
    } catch (e) {
      nextErrors.push(`${label}: ${(e as { message?: string })?.message ?? String(e)}`)
      return null
    }
  }
  const { start, end } = today()
  const startIso = start.toISOString()
  const endIso = end.toISOString()

  // Not limited to one clinic: a practitioner working at two locations has
  // one day, and the takings below are not limited to one clinic either.
  const appointmentsQ = supabase
    .from('appointments')
    .select('id, patient_id, starts_at, status, confirmation_status, source, checked_in_at, flow_with_practitioner_at, flow_checkout_at, patients(first_name, last_name), appointment_types(name, stage)')
    .eq('practitioner_id', ctx.teamMemberId)
    .neq('status', 'cancelled')
    // Deleted on the web calendar: status stays 'booked', only deleted_at is set.
    .is('deleted_at', null)
    .gte('starts_at', startIso)
    .lt('starts_at', endIso)
    .order('starts_at')
    .then(({ data, error }) => {
      if (error) throw error
      return (data as unknown as Appointment[]) ?? []
    })

  // Open ones, and today's finished ones so a tick does not make a task vanish.
  const tasksQ = supabase
    .from('staff_tasks')
    .select('id, title, done_at, patient_id, patients(first_name, last_name), automation_rules(name)')
    .or(`done_at.is.null,done_at.gte.${startIso}`)
    .order('created_at')
    .limit(100)
    .then(({ data, error }) => {
      if (error) throw error
      const rows = (data as unknown as Task[]) ?? []
      return [...rows.filter((x) => !x.done_at), ...rows.filter((x) => x.done_at)]
    })

  // This person's own patients, as the birthday automation reads the date:
  // month and day, in the clinic's calendar (utils/birthday). PostgREST cannot
  // filter on part of a date, so the dates come down and are matched here.
  // An archived ("inactive") patient is left out.
  const todayDate = clinicDateOf(new Date(), timeZone.value)
  const birthdaysQ = fetchAllRows<BirthdayPatient>((from, to) =>
    supabase
      .from('patients')
      .select('id, first_name, last_name, date_of_birth')
      .eq('default_practitioner_id', ctx.teamMemberId)
      .not('date_of_birth', 'is', null)
      .neq('status', 'inactive')
      .order('id')
      .range(from, to) as unknown as PromiseLike<{ data: BirthdayPatient[] | null; error: unknown }>,
  ).then((rows) => rows.filter((p) => isBirthdayOn(p.date_of_birth, todayDate)))

  // The dashboard's Recalls due card, narrowed to this person the same way.
  const recallsQ = seesRecalls.value
    ? supabase
        .from('recall_candidates')
        .select('patient_id', { count: 'exact', head: true })
        .eq('default_practitioner_id', ctx.teamMemberId)
        .then(({ count, error }) => {
          if (error) throw error
          return count ?? 0
        })
    : Promise.resolve(null)

  const takingsQ = seesMoney.value ? loadTakings(ctx.teamMemberId, startIso, endIso) : Promise.resolve(null)

  const waitlistQ = seesRecalls.value
    ? supabase
        .from('waitlist_entries')
        .select('id', { count: 'exact', head: true })
        .in('status', ['waiting', 'offered'])
        .then(({ count, error }) => {
          if (error) throw error
          return count ?? 0
        })
    : Promise.resolve(null)

  const waitlistSelfQ = seesRecalls.value
    ? supabase
        .from('waitlist_entries')
        .select('id', { count: 'exact', head: true })
        .eq('source', 'patient')
        .gte('created_at', startIso)
        .then(({ count, error }) => {
          if (error) throw error
          return count ?? 0
        })
    : Promise.resolve(null)

  // Card payments that came through Stripe today: online bookings and
  // "Pagar" from the app or the portal -- money nobody at the desk took.
  const onlineQ = seesMoney.value
    ? supabase
        .from('payments')
        .select('amount_cents')
        .not('stripe_payment_intent_id', 'is', null)
        .gte('paid_at', startIso)
        .lt('paid_at', endIso)
        .then(({ data, error }) => {
          if (error) throw error
          const rows = (data as { amount_cents: number }[] | null) ?? []
          return { count: rows.length, cents: rows.reduce((sum, r) => sum + r.amount_cents, 0) }
        })
    : Promise.resolve(null)

  const plansQ = seesRecalls.value
    ? supabase
        .from('care_plan_continuity_alerts')
        .select('patient_id', { count: 'exact', head: true })
        .eq('default_practitioner_id', ctx.teamMemberId)
        .then(({ count, error }) => {
          if (error) throw error
          return count ?? 0
        })
    : Promise.resolve(null)

  const [appts, taskRows, birthdayRows, recalls, takings, waitlist, plans, waitlistSelf, online] = await Promise.all([
    settle(t('Visits', 'Visitas'), appointmentsQ),
    settle(t('Tasks', 'Tareas'), tasksQ),
    settle(t('Birthdays', 'Cumpleaños'), birthdaysQ),
    settle(t('Recalls', 'Recordatorios'), recallsQ),
    settle(t('Takings', 'Cobrado'), takingsQ),
    settle(t('Waitlist', 'Lista de espera'), waitlistQ),
    settle(t('Plans behind schedule', 'Planes con retraso'), plansQ),
    settle(t('Waitlist', 'Lista de espera'), waitlistSelfQ),
    settle(t('Online payments', 'Pagos online'), onlineQ),
  ])
  if (mine !== run) return

  // Whatever failed keeps what it showed before rather than turning into an
  // empty list, which would read as "nothing today".
  if (appts) appointments.value = appts
  if (taskRows) tasks.value = taskRows
  if (birthdayRows) birthdays.value = birthdayRows
  recallsDue.value = recalls
  waitlistActive.value = waitlist
  waitlistSelfToday.value = waitlistSelf ?? 0
  onlineToday.value = online
  plansBehind.value = plans
  takingsCents.value = takings
  errors.value = nextErrors
  loading.value = false

  // What each visit needs to know about its patient: anything booked after
  // now, and what they owe. Both read by patient, so after the visits.
  const patientIds = [...new Set(appointments.value.map((a) => a.patient_id))]
  const nowIso = new Date().toISOString()
  const [future, owed] = await Promise.all([
    settle(
      t('Next visits', 'Próximas visitas'),
      fetchByIds(patientIds, (chunk) =>
        supabase
          .from('appointments')
          .select('id, patient_id')
          .in('patient_id', chunk)
          .neq('status', 'cancelled')
          .is('deleted_at', null)
          .gt('starts_at', nowIso) as unknown as PromiseLike<{ data: { id: string; patient_id: string }[] | null; error: unknown }>,
      ),
    ),
    // The same source as the calendar's "Owes" badge -- what is actually
    // unpaid (utils/owing.ts), not a balance worked out here.
    seesMoney.value
      ? settle(
          t('Balances', 'Saldos'),
          fetchByIds(patientIds, (chunk) =>
            supabase.from('patient_live_balances').select('patient_id, outstanding_cents').in('patient_id', chunk) as unknown as PromiseLike<{
              data: { patient_id: string | null; outstanding_cents: number | null }[] | null
              error: unknown
            }>,
          ),
        )
      : Promise.resolve([]),
  ])
  if (mine !== run) return
  if (future) {
    const map = new Map<string, Set<string>>()
    for (const a of future) {
      let ids = map.get(a.patient_id)
      if (!ids) map.set(a.patient_id, (ids = new Set()))
      ids.add(a.id)
    }
    futureByPatient.value = map
  }
  if (owed) {
    const map = new Map<string, number>()
    for (const b of owed) if (b.patient_id) map.set(b.patient_id, Math.max(0, b.outstanding_cents ?? 0))
    owedByPatient.value = map
  }
  errors.value = nextErrors
}

// Today's takings that are this person's, as Daily transactions counts them:
// money that came in (not credit spent or a write-off), not against a voided
// invoice, attributed by the visit it paid for, or -- with no visit behind
// it -- the patient's own practitioner.
async function loadTakings(practitionerId: string, startIso: string, endIso: string): Promise<number> {
  const rows = await fetchAllRows<PaymentRow>((from, to) =>
    supabase
      .from('payments')
      .select(
        'amount_cents, method, patient_id, invoice_id, invoices!payments_invoice_id_fkey(status, appointment_id, appointments!invoices_appointment_id_fkey(practitioner_id, clinic_id)), patients!payments_patient_id_fkey(default_practitioner_id, clinic_id)',
      )
      .gte('paid_at', startIso)
      .lt('paid_at', endIso)
      .order('paid_at')
      .range(from, to) as unknown as PromiseLike<{ data: PaymentRow[] | null; error: unknown }>,
  )
  return rows
    .filter((row) => row.invoices?.status !== 'void' && isReceipt(row.method))
    .filter((row) => {
      const invoice = row.invoices
      // An invoice that names a visit this person cannot see is a colleague's
      // visit (their own are always visible to them), so it is not theirs --
      // rather than falling through to the patient, which would count a
      // colleague's visit to whoever the patient usually sees.
      const appointment = invoice?.appointment_id ? (invoice.appointments ?? { practitioner_id: null, clinic_id: null }) : null
      return classifyPaymentForFilter({ practitionerId, appointment, patient: row.patients ?? null }) === 'matches'
    })
    .reduce((sum, row) => sum + row.amount_cents, 0)
}

async function toggleTask(task: Task) {
  const previous = task.done_at
  task.done_at = previous ? null : new Date().toISOString()
  const { error } = await supabase.from('staff_tasks').update({ done_at: task.done_at } as never).eq('id', task.id)
  if (error) {
    task.done_at = previous
    capture(t('Tasks', 'Tareas'), error)
  }
}

// The visit screen's check-in (calendar/[id].vue): only if nobody has checked
// them in yet, and then the 'appointment.checked_in' automations -- which is
// also what tells their practitioner (server/utils/staffPush.ts). From here it
// used to set the time and nothing else, overwriting an earlier arrival.
const { fire } = useAutomations()
async function checkIn(a: Appointment) {
  const { data, error } = await supabase
    .from('appointments')
    .update({ checked_in_at: new Date().toISOString() } as never)
    .eq('id', a.id)
    .is('checked_in_at', null)
    .select('id')
  if (error) {
    capture(t('Check in', 'Registrar llegada'), error)
    return
  }
  if ((data ?? []).length > 0) fire('appointment.checked_in', { patientId: a.patient_id, appointmentId: a.id })
  await load({ silent: true })
}

watch(context, () => load(), { immediate: true })

// Back to the front after a while (the app is suspended, not closed): the day
// is read again, so a phone left open overnight does not show yesterday.
function onVisible() {
  if (document.visibilityState === 'visible' && context.value) load({ silent: true })
}
onMounted(() => document.addEventListener('visibilitychange', onVisible))
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible))

const scroller = ref<HTMLElement | null>(null)
// A visit's no-show risk on its row (utils/noShowRisk). A first visit says so
// already ("New patient"), so only a history of missing one is shown.
const { riskFor } = useNoShowRisk()
const riskByPatient = ref<Map<string, NoShowRisk>>(new Map())
watch(appointments, async (list) => {
  riskByPatient.value = await riskFor(list.filter((a) => a.status === 'booked' && !a.checked_in_at).map((a) => a.patient_id))
})
function riskShown(a: Appointment) {
  const r = riskByPatient.value.get(a.patient_id)
  return r && (r.level === 'high' || r.level === 'some') ? r : null
}

// The "needs confirming" card loads itself; a pull refreshes it with the rest.
const needsConfirming = ref<{ reload: () => Promise<void> } | null>(null)
const { pulling, refreshing, pullDistance, onTouchStart, onTouchMove, onTouchEnd } = usePullToRefresh(scroller, async () => {
  await Promise.all([load({ silent: true }), needsConfirming.value?.reload()])
})

// The app's own Inbox thread with them, as the patient record's WhatsApp button opens it.
function messagePatient(patientId: string) {
  pendingConversationKey.value = patientId
  navigateTo('/inbox')
}

// --- Per visit ---

function stageOf(a: Appointment) {
  return appointmentStage(a)
}
function isNewPatientVisit(a: Appointment) {
  const stage = a.appointment_types?.stage
  return stage === 'first_visit' || stage === 'first_visit_offer'
}
function hasFutureAppointment(a: Appointment) {
  if (!futureByPatient.value) return true // not known yet, so not flagged
  const ids = futureByPatient.value.get(a.patient_id)
  if (!ids) return false
  return ids.size > 1 || !ids.has(a.id)
}
// The web calendar's "Sin próxima" rule: with the practitioner, at checkout,
// or done today, and nothing booked after now.
function needsNext(a: Appointment) {
  return needsNextBookingFlag(stageOf(a), a.starts_at, hasFutureAppointment(a))
}
function owes(a: Appointment) {
  return seesMoney.value ? (owedByPatient.value.get(a.patient_id) ?? 0) : 0
}
function canCheckIn(a: Appointment) {
  const stage = stageOf(a)
  return !a.checked_in_at && stage !== 'completed' && stage !== 'noshow' && !restricted('calendar_read_only')
}

type RowState = 'done' | 'in' | 'noshow' | 'upcoming'
function rowState(a: Appointment): RowState {
  const stage = stageOf(a)
  if (stage === 'completed') return 'done'
  if (stage === 'noshow') return 'noshow'
  if (hasArrived(stage)) return 'in'
  return 'upcoming'
}
const BORDER: Record<RowState, string> = {
  done: 'border-l-success-accent',
  in: 'border-l-brand',
  noshow: 'border-l-danger-text',
  upcoming: 'border-l-line-control',
}

const { privacy, togglePrivacy, shown } = usePrivacyMode()

// The home-screen widget: asked afresh whenever this list changes (a load,
// a check-in). What it shows is the
// database's call (useStaffHomeWidget): this person's day for a
// practitioner, the clinic's for the front desk and an owner's figures.
const homeWidget = useStaffHomeWidget()
watch(appointments, () => {
  if (context.value) homeWidget.refresh({ force: true })
})
// The web's dashboard_scope: owners, and roles set to 'all' or 'own'.
const seesNumbers = computed(() => !!context.value && (context.value.isOwner || ['all', 'own'].includes(String(context.value.permissions.dashboard_scope))))
function patientName(a: { patients: { first_name: string; last_name: string | null } | null }) {
  return a.patients ? `${a.patients.first_name} ${a.patients.last_name ?? ''}`.trim() : t('Patient', 'Paciente')
}
function clinicTime(iso: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timeZone.value, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}
const dateLabel = computed(() => new Intl.DateTimeFormat(locale.value, { timeZone: timeZone.value, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date()))

// --- Figures ---

const visitsTotal = computed(() => appointments.value.length)
const visitsDone = computed(() => appointments.value.filter((a) => a.status === 'completed').length)
// Statistics counts a new patient once, by a COMPLETED first visit. Today's
// booked ones are the "of" -- who is still to come in.
const newBooked = computed(() => new Set(appointments.value.filter(isNewPatientVisit).map((a) => a.patient_id)).size)
const newDone = computed(() => new Set(appointments.value.filter((a) => isNewPatientVisit(a) && a.status === 'completed').map((a) => a.patient_id)).size)

function shortEur(cents: number) {
  // Whole euros without the ",00" so a four-figure day fits the tile; any
  // cents are shown exactly.
  if (cents % 100 === 0) return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(cents / 100)
  return formatEur(cents)
}

// One row per patient, their latest visit today.
const seenNoNext = computed(() => {
  const byPatient = new Map<string, Appointment>()
  for (const a of appointments.value) if (needsNext(a)) byPatient.set(a.patient_id, a)
  return [...byPatient.values()]
})

const openTasks = computed(() => tasks.value.filter((x) => !x.done_at).length)
const birthdayNames = computed(() => birthdays.value.map((p) => shown(`${p.first_name} ${p.last_name ?? ''}`.trim())).join(' · '))

// The iPad's "In clinic now" card (second column only): the first of today's
// visits that is checked in and not finished, with that patient's latest note
// from an earlier visit -- for a role that may read notes; RLS applies the
// notes scope as everywhere else.
const inClinicNow = computed(() => (loading.value ? null : appointments.value.find((a) => rowState(a) === 'in') ?? null))
// The top card: who is in now, or else who is next -- what someone opening
// the app between two patients needs first.
const nextUp = computed(() => (loading.value || inClinicNow.value ? null : appointments.value.find((a) => rowState(a) === 'upcoming') ?? null))
// The day's list keeps what is still to come in view; the visits already
// done fold away behind one line.
const showDone = ref(false)
const doneVisits = computed(() => appointments.value.filter((a) => rowState(a) === 'done'))
const shownVisits = computed(() => appointments.value.filter((a) => showDone.value || rowState(a) !== 'done'))
const STATE_DOT: Record<RowState, string> = { done: 'bg-success-accent', in: 'bg-brand', noshow: 'bg-danger-text', upcoming: 'bg-line-controlHover' }
const lastNote = ref<{ day: string; text: string } | null>(null)
watch(
  () => inClinicNow.value?.id,
  async (id) => {
    lastNote.value = null
    const a = inClinicNow.value
    if (!id || !a || !can('visit_notes_access')) return
    const { data } = await supabase
      .from('visit_notes')
      .select('body, created_at, appointment_id, appointments!inner(starts_at, patient_id)')
      .eq('appointments.patient_id', a.patient_id)
      .neq('appointment_id', a.id)
      // One note is shown; the newest few are plenty to pick it from, where
      // the patient's whole history used to be downloaded for it.
      .order('created_at', { ascending: false })
      .limit(10)
    const rows = ((data as unknown as { body: string; created_at: string; appointments: { starts_at: string } | null }[]) ?? [])
      .slice()
      .sort((x, y) => (y.appointments?.starts_at ?? y.created_at).localeCompare(x.appointments?.starts_at ?? x.created_at))
    const n = rows[0]
    if (!n || inClinicNow.value?.id !== id) return
    const at = new Date(n.appointments?.starts_at ?? n.created_at)
    lastNote.value = {
      day: at.toLocaleDateString(locale.value, { day: 'numeric', month: 'short', timeZone: timeZone.value }).replace(/\./g, ''),
      text: visitNotePreview(n.body, 140),
    }
  },
  { immediate: true },
)
function initialsOf(a: Appointment) {
  return [a.patients?.first_name, a.patients?.last_name].filter(Boolean).map((w) => (w as string)[0]?.toUpperCase()).join('') || '·'
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-surface-page">
    <AppPageHeader :title="t('My Day', 'Mi día')">
      <span class="text-[12.5px] text-ink-muted" data-test="myday-date">{{ dateLabel }}</span>
      <StaffHelpButton v-if="context" />
      <button type="button" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl border" :class="privacy ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-muted'" role="switch" :aria-checked="privacy" :aria-label="t('Privacy mode: names as initials', 'Modo privacidad: nombres como iniciales')" data-cy="myday-privacy" @click="togglePrivacy">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path v-if="!privacy" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle v-if="!privacy" cx="12" cy="12" r="3" /><path v-if="privacy" d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0112 5c6.5 0 10 7 10 7a17.6 17.6 0 01-3.1 4M6.6 6.6C3.9 8.3 2 12 2 12s3.5 7 10 7a9.7 9.7 0 005.4-1.6M9.9 9.9a3 3 0 004.2 4.2" /></svg>
      </button>
      <!-- Profile, which is no longer a tab of its own on a phone -->
      <NuxtLink v-if="context" to="/profile" class="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-tint text-[12.5px] font-bold text-brand-text md:hidden" :aria-label="t('Profile', 'Perfil')" data-cy="myday-profile">
        <img v-if="profilePhotoUrl" :src="profilePhotoUrl" alt="" class="h-full w-full object-cover" />
        <template v-else>{{ profileInitials }}</template>
      </NuxtLink>
    </AppPageHeader>

    <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto" @touchstart="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd">
      <div
        v-if="pulling || refreshing || pullDistance > 0"
        class="flex items-center justify-center overflow-hidden transition-[height]"
        :style="{ height: refreshing ? '56px' : `${pullDistance}px` }"
      >
        <!-- A thumb-sized disc, turning as it is pulled: the bare 16px icon was
             hard to see under a finger. -->
          <span class="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface shadow-card">
            <svg viewBox="0 0 24 24" class="h-[22px] w-[22px] text-brand" :class="{ 'animate-spin': refreshing }" :style="refreshing ? undefined : { transform: `rotate(${pullDistance * 3}deg)` }" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <path d="M4 12a8 8 0 0 1 14.5-4.6M20 12a8 8 0 0 1-14.5 4.6" />
          <path d="M17.5 3v5h-5M6.5 21v-5h5" />
        </svg>
          </span>
      </div>

      <!-- One column on a phone, in this order: the clock, who is in now (or
           next), the figures, the rest of today, what is pending, shortcuts.
           On an iPad (lg) the visits on the left and the rest on the right;
           the two wrappers are display:contents below lg, so their children
           fall back into this single column, kept in order by order-*. -->
        <div class="flex flex-col gap-2.5 px-3.5 py-3 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-5 lg:px-5 lg:py-4">
        <!-- Registro de jornada: the clock, first thing (components/timeclock/ClockCard.vue). -->
        <TimeclockClockCard v-if="context" class="order-first lg:col-span-2" :account-id="context.accountId" :team-member-id="context.teamMemberId" :time-zone="timeZone" month-to="/jornada" />
        <PractitionerLowStock v-if="context?.isOwner" class="order-first lg:col-span-2" />
        <div v-if="errors.length > 0" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-2.5 lg:col-span-2" data-test="myday-error">
          <p class="text-[13px] font-semibold text-danger-text">{{ t('Some of today could not load', 'No se ha podido cargar parte del día') }}</p>
          <p v-for="e in errors" :key="e" class="mt-0.5 text-[12px] text-danger-text">{{ e }}</p>
          <button type="button" class="mt-2 rounded-ctl border border-danger-border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-danger-text" @click="load()">
            {{ t('Try again', 'Reintentar') }}
          </button>
        </div>

        <div class="contents lg:flex lg:flex-col lg:gap-2.5">
        <!-- Figures for the viewer's own day -->
        <div class="order-2 grid gap-2 lg:order-none" :class="seesMoney ? 'grid-cols-3' : 'grid-cols-2'" data-test="myday-figures">
          <div class="rounded-card border border-line bg-surface shadow-card px-3 py-2.5">
            <p class="text-[12px] text-ink-muted">{{ t('Visits', 'Visitas') }}</p>
            <UiSkeleton v-if="contextLoading || loading" class="mt-1.5 h-[22px] w-14 rounded-ctlSm" />
            <p v-else class="mt-0.5 text-[20px] font-bold leading-tight text-ink-900" data-test="myday-visits">
              {{ visitsDone }} <span class="text-[12.5px] font-normal text-ink-muted2">{{ t(`of ${visitsTotal}`, `de ${visitsTotal}`) }}</span>
            </p>
          </div>
          <div class="rounded-card border border-line bg-surface shadow-card px-3 py-2.5">
            <p class="text-[12px] text-ink-muted">{{ t('New', 'Nuevos') }}</p>
            <UiSkeleton v-if="contextLoading || loading" class="mt-1.5 h-[22px] w-10 rounded-ctlSm" />
            <p v-else class="mt-0.5 text-[20px] font-bold leading-tight text-ink-900" data-test="myday-new">
              {{ newDone }} <span v-if="newBooked > newDone" class="text-[12.5px] font-normal text-ink-muted2">{{ t(`of ${newBooked}`, `de ${newBooked}`) }}</span>
            </p>
          </div>
          <div v-if="seesMoney" class="min-w-0 rounded-card border border-line bg-surface shadow-card px-3 py-2.5">
            <p class="text-[12px] text-ink-muted">{{ t('Taken', 'Cobrado') }}</p>
            <UiSkeleton v-if="contextLoading || loading" class="mt-1.5 h-[22px] w-14 rounded-ctlSm" />
            <p v-else class="mt-0.5 truncate text-[20px] font-bold leading-tight text-ink-900" data-test="myday-taken">{{ takingsCents === null ? '—' : shortEur(takingsCents) }}</p>
          </div>
        </div>

        <!-- Today's visits: what is still to come, the done ones folded away -->
        <section class="order-3 rounded-card border border-line bg-surface shadow-card lg:order-none" data-test="myday-visits-list">
          <div class="flex min-h-11 items-center justify-between gap-2 px-3.5">
            <h2 class="text-[11px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('Today', 'Hoy') }}</h2>
            <button v-if="!loading && doneVisits.length > 0" type="button" class="-my-1 flex h-9 items-center text-[12.5px] font-semibold text-brand-text" :aria-expanded="showDone" data-test="myday-done-toggle" @click="showDone = !showDone">
              {{ showDone ? t('Hide the done ones', 'Ocultar las hechas') : t(`Show the ${doneVisits.length} done`, `Ver las ${doneVisits.length} hechas`) }}
            </button>
          </div>
          <template v-if="contextLoading || loading">
            <div v-for="n in 4" :key="n" class="flex items-center gap-3 border-t border-line-row px-3.5 py-3">
              <UiSkeleton class="h-4 w-10 rounded-ctlSm" />
              <div class="flex-1 space-y-1.5">
                <UiSkeleton class="h-4 w-36 rounded-ctlSm" />
                <UiSkeleton class="h-3 w-20 rounded-ctlSm" />
              </div>
            </div>
          </template>
          <p v-else-if="appointments.length === 0" class="border-t border-line-row px-3.5 py-4 text-center text-[13px] text-ink-muted">
            {{ t('No visits today.', 'Hoy no tienes visitas.') }}
          </p>
          <p v-else-if="shownVisits.length === 0" class="border-t border-line-row px-3.5 py-4 text-center text-[13px] text-ink-muted" data-test="myday-all-done">
            {{ t('All of today’s visits are done.', 'Todas las visitas de hoy están hechas.') }}
          </p>
          <div
            v-for="a in loading ? [] : shownVisits"
            :key="a.id"
            class="relative flex items-center gap-3 border-t border-line-row px-3.5 py-2.5"
            data-test="myday-visit"
          >
            <NuxtLink :to="`/calendar/${a.id}`" class="absolute inset-0" :aria-label="`${clinicTime(a.starts_at)} ${patientName(a)}`" />
            <p class="w-[42px] shrink-0 font-mono text-[13.5px] font-semibold" :class="rowState(a) === 'done' ? 'text-ink-faint' : 'text-ink-900'">{{ clinicTime(a.starts_at) }}</p>
            <div class="min-w-0 flex-1">
              <p class="truncate text-[14.5px] font-semibold" :class="rowState(a) === 'done' ? 'text-ink-faint' : 'text-ink-900'">{{ shown(patientName(a)) }}</p>
              <p class="truncate text-[12.5px] text-ink-muted2">
                {{ a.appointment_types?.name ?? t('Appointment', 'Cita') }}
                <span v-if="isNewPatientVisit(a)" class="font-semibold text-brand-text" data-test="myday-flag-new"> · {{ t('New patient', 'Paciente nuevo') }}</span>
                <span v-if="owes(a) > 0" class="font-semibold text-danger-text" data-test="myday-flag-owes"> · {{ t(`Owes ${formatEur(owes(a))}`, `Debe ${formatEur(owes(a))}`) }}</span>
                <span v-if="needsNext(a)" class="font-semibold text-warning-text" data-test="myday-flag-no-next"> · {{ t('No next visit', 'Sin próxima') }}</span>
              </p>
            </div>
            <div class="flex shrink-0 flex-col items-end gap-1">
              <span class="inline-flex items-center gap-1.5 text-[12.5px] font-medium" :class="rowState(a) === 'done' ? 'text-success-text' : rowState(a) === 'in' ? 'text-brand-text' : rowState(a) === 'noshow' ? 'text-danger-text' : 'text-ink-muted'">
                <span class="h-[7px] w-[7px] rounded-full" :class="STATE_DOT[rowState(a)]" aria-hidden="true" />
                {{ rowState(a) === 'done' ? t('Done', 'Hecha') : rowState(a) === 'in' ? t('In clinic', 'En clínica') : rowState(a) === 'noshow' ? t('No-show', 'No vino') : t('Booked', 'Reservada') }}
              </span>
              <PractitionerNoShowRiskPill v-if="riskShown(a) && rowState(a) !== 'done' && rowState(a) !== 'noshow'" :risk="riskShown(a)" />
              <button
                v-if="canCheckIn(a)"
                type="button"
                class="tap-target relative z-10 rounded-ctl border border-line-control bg-surface px-2.5 py-1 text-[12px] font-medium text-brand-text active:bg-surface-subtle"
                data-test="myday-checkin"
                @click="checkIn(a)"
              >
                {{ t('Check in', 'Registrar llegada') }}
              </button>
            </div>
          </div>
        </section>
        </div>

        <div class="contents lg:flex lg:flex-col lg:gap-2.5">
        <!-- Now: who is in the room with their last note, or who is next -->
        <section v-if="inClinicNow" class="order-1 rounded-card border-[1.5px] border-brand bg-brand-tint px-4 py-3.5 lg:order-none" data-test="myday-in-clinic">
          <p class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-brand-text"><span class="h-2 w-2 rounded-full bg-brand" aria-hidden="true" />{{ t('In clinic now', 'Ahora en consulta') }}</p>
          <p class="mt-1 truncate text-[19px] font-bold text-ink-900">{{ shown(patientName(inClinicNow)) }}</p>
          <p class="truncate text-[13px] text-ink-muted">{{ inClinicNow.appointment_types?.name ?? t('Appointment', 'Cita') }} · {{ clinicTime(inClinicNow.starts_at) }}</p>
          <p v-if="lastNote" class="mt-2.5 rounded-ctl bg-surface px-3 py-2 text-[13px] leading-[1.45] text-ink-700">{{ t('Last note', 'Última nota') }} ({{ lastNote.day }}): {{ lastNote.text }}</p>
          <div class="mt-3 grid grid-cols-2 gap-2">
            <NuxtLink :to="`/calendar/${inClinicNow.id}`" class="flex h-11 items-center justify-center rounded-ctl bg-brand text-[14px] font-semibold text-white">{{ t('Open visit', 'Abrir visita') }}</NuxtLink>
            <NuxtLink :to="`/patients/${inClinicNow.patient_id}`" class="flex h-11 items-center justify-center rounded-ctl border border-line-control bg-surface text-[14px] font-semibold text-ink-700">{{ t('Record', 'Ficha') }}</NuxtLink>
          </div>
        </section>
        <section v-else-if="nextUp" class="order-1 rounded-card border border-brand-tintBorder bg-brand-tint px-4 py-3.5 lg:order-none" data-test="myday-next">
          <p class="text-[11px] font-semibold uppercase tracking-[.06em] text-brand-text">{{ t('Next', 'Siguiente') }} · {{ clinicTime(nextUp.starts_at) }}</p>
          <p class="mt-1 truncate text-[18px] font-bold text-ink-900">{{ shown(patientName(nextUp)) }}</p>
          <p class="truncate text-[13px] text-ink-muted">{{ nextUp.appointment_types?.name ?? t('Appointment', 'Cita') }}</p>
          <div class="mt-3 grid gap-2" :class="canCheckIn(nextUp) ? 'grid-cols-2' : 'grid-cols-1'">
            <button v-if="canCheckIn(nextUp)" type="button" class="h-11 rounded-ctl bg-brand text-[14px] font-semibold text-white" data-test="myday-next-checkin" @click="checkIn(nextUp)">{{ t('Check in', 'Registrar llegada') }}</button>
            <NuxtLink :to="`/patients/${nextUp.patient_id}`" class="flex h-11 items-center justify-center rounded-ctl border border-line-control bg-surface text-[14px] font-semibold text-ink-700">{{ t('Record', 'Ficha') }}</NuxtLink>
          </div>
        </section>

        <!-- Pending: who left without a next visit, who has not confirmed,
             and the tasks -->
        <p class="order-4 px-0.5 pt-1 text-[11px] font-semibold uppercase tracking-[.05em] text-ink-muted lg:order-none lg:pt-0">{{ t('Pending', 'Pendientes') }}</p>
        <div v-if="!loading && seenNoNext.length > 0" class="order-4 rounded-card border border-warning-border bg-warning-bg px-3.5 py-2.5 lg:order-none" data-test="myday-no-next">
          <p class="text-[14px] font-semibold text-ink-900">{{ t('Seen today, no next visit', 'Vistos hoy, sin próxima visita') }} · {{ seenNoNext.length }}</p>
          <p v-if="ownDiaryOnly" class="text-[11.5px] text-ink-muted2">{{ t('Your role sees only bookings with you.', 'Tu rol solo ve las citas contigo.') }}</p>
          <div v-for="a in seenNoNext" :key="a.patient_id" class="mt-2 flex items-center gap-2.5">
            <div class="min-w-0 flex-1">
              <p class="truncate text-[13.5px] font-medium text-ink-900">{{ shown(patientName(a)) }}</p>
              <p class="truncate text-[12.5px] text-ink-muted2">{{ a.appointment_types?.name ?? t('Appointment', 'Cita') }} {{ clinicTime(a.starts_at) }}</p>
            </div>
            <NuxtLink
              :to="`/patients/${a.patient_id}?book=1`"
              class="flex h-9 shrink-0 items-center rounded-card border border-line-control bg-surface px-3 text-[13px] font-medium text-ink-700 active:bg-surface-subtle"
              data-test="myday-book"
            >
              {{ t('Book', 'Reservar') }}
            </NuxtLink>
          </div>
        </div>

        <!-- Who has not confirmed between now and tomorrow night, riskiest
             first: the calls to make before the day fills up. -->
        <PractitionerNeedsConfirming
          v-if="context"
          ref="needsConfirming"
          class="order-4 lg:order-none"
          :clinic-id="null"
          :practitioner-id="context.teamMemberId"
          :time-zone="timeZone"
          :privacy-mode="privacy"
          @message="messagePatient"
        />

        <div class="order-4 rounded-card border border-line bg-surface shadow-card px-3.5 py-1 lg:order-none" data-test="myday-tasks">
          <button type="button" class="flex min-h-11 w-full items-center justify-between gap-3 py-1 text-left focus:outline-none" :aria-expanded="showTasks" data-test="myday-tasks-toggle" @click="showTasks = !showTasks">
            <span class="flex items-center gap-2.5 text-[14px] text-ink-900">
              <span class="flex h-[26px] min-w-[26px] items-center justify-center rounded-ctlSm px-1.5 text-[13px] font-bold" :class="openTasks ? 'bg-chip-bg text-ink-900' : 'bg-surface-subtle text-ink-muted2'">
                <UiSkeleton v-if="loading" class="h-3 w-3 rounded-ctlSm" />
                <template v-else>{{ openTasks }}</template>
              </span>
              {{ t('Tasks', 'Tareas') }}
            </span>
            <span class="inline-block transition-transform" :class="showTasks ? 'rotate-90' : ''"><AppChevron :size="12" /></span>
          </button>
          <template v-if="showTasks && !loading">
            <p v-if="tasks.length === 0" class="border-t border-line-row py-2.5 text-[12.5px] text-ink-muted2">{{ t('Nothing to do.', 'Nada pendiente.') }}</p>
            <div v-for="task in tasks" :key="task.id" class="flex items-start gap-3 border-t border-line-row py-2.5" data-test="myday-task">
              <button
                type="button"
                class="tap-target mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                :class="task.done_at ? 'bg-success-accent text-white' : 'border border-line-control text-ink-faint3'"
                :aria-label="task.done_at ? t('Mark as not done', 'Marcar como pendiente') : t('Mark as done', 'Marcar como hecha')"
                @click="toggleTask(task)"
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2.5 6.2l2.4 2.4 4.6-5.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <div class="min-w-0">
                <p class="text-[14px] font-[600]" :class="task.done_at ? 'text-ink-faint line-through' : 'text-ink-900'">{{ task.title }}</p>
                <p class="mt-0.5 text-[12.5px] text-ink-muted2">
                  <NuxtLink v-if="task.patient_id && task.patients" :to="`/patients/${task.patient_id}`" class="font-medium text-brand-text">{{ shown(`${task.patients.first_name} ${task.patients.last_name ?? ''}`.trim()) }}</NuxtLink>
                  <span v-if="task.automation_rules"> · {{ t('Automation', 'Automatización') }} “{{ task.automation_rules.name }}”</span>
                </p>
              </div>
            </div>
          </template>
        </div>

        <!-- Shortcuts: the rest of the clinic's day, as tiles -->
        <p class="order-5 px-0.5 pt-1 text-[11px] font-semibold uppercase tracking-[.05em] text-ink-muted lg:order-none">{{ t('Also today', 'También hoy') }}</p>
        <div class="order-5 grid grid-cols-2 gap-2 lg:order-none" data-test="myday-also">
          <div class="min-w-0 rounded-card border border-line bg-surface shadow-card px-3 py-2.5">
            <p class="text-[14px] font-semibold text-ink-900">{{ t('Birthdays', 'Cumpleaños') }}</p>
            <UiSkeleton v-if="loading" class="mt-1 h-3.5 w-20 rounded-ctlSm" />
            <p v-else class="mt-0.5 truncate text-[12.5px] text-ink-muted2" data-test="myday-birthdays">{{ birthdayNames || t('None today', 'Ninguno hoy') }}</p>
          </div>
          <NuxtLink v-if="seesRecalls" to="/recalls" class="min-w-0 rounded-card border border-line bg-surface shadow-card px-3 py-2.5" data-cy="myday-recalls-open">
            <p class="text-[14px] font-semibold text-ink-900">{{ t('Recalls', 'Recuperaciones') }}</p>
            <UiSkeleton v-if="loading" class="mt-1 h-3.5 w-16 rounded-ctlSm" />
            <p v-else class="mt-0.5 truncate text-[12.5px] text-ink-muted2" data-test="myday-recalls">{{ recallsDue === null ? '—' : t(`${recallsDue} due`, `${recallsDue} pendientes`) }}</p>
          </NuxtLink>
          <NuxtLink v-if="seesRecalls" to="/plan-alerts" class="min-w-0 rounded-card border border-line bg-surface shadow-card px-3 py-2.5" data-cy="myday-plans-open">
            <p class="text-[14px] font-semibold text-ink-900">{{ t('Plans', 'Planes') }}</p>
            <UiSkeleton v-if="loading" class="mt-1 h-3.5 w-16 rounded-ctlSm" />
            <p v-else class="mt-0.5 truncate text-[12.5px]" :class="plansBehind ? 'font-semibold text-danger-text' : 'text-ink-muted2'" data-test="myday-plans">{{ plansBehind === null ? '—' : t(`${plansBehind} behind`, `${plansBehind} con retraso`) }}</p>
          </NuxtLink>
          <NuxtLink v-if="seesRecalls" to="/waitlist" class="min-w-0 rounded-card border border-line bg-surface shadow-card px-3 py-2.5" data-cy="myday-waitlist-open">
            <p class="text-[14px] font-semibold text-ink-900">{{ t('Waitlist', 'Lista de espera') }}</p>
            <UiSkeleton v-if="loading" class="mt-1 h-3.5 w-16 rounded-ctlSm" />
            <p v-else class="mt-0.5 truncate text-[12.5px] text-ink-muted2" data-test="myday-waitlist">{{ waitlistActive === null ? '—' : t(`${waitlistActive} waiting`, `${waitlistActive} en espera`) }}<span v-if="waitlistSelfToday > 0" class="font-semibold text-brand-text" data-test="myday-waitlist-self"> · {{ t(`+${waitlistSelfToday} today`, `+${waitlistSelfToday} hoy`) }}</span></p>
          </NuxtLink>
          <!-- The front desk's cash shift (the web's Caja), for whoever takes payments -->
          <NuxtLink v-if="can('payments_allocate')" to="/cash" class="min-w-0 rounded-card border border-line bg-surface shadow-card px-3 py-2.5" data-cy="myday-cash-open">
            <p class="text-[14px] font-semibold text-ink-900">{{ t('Cash shift', 'Caja') }}</p>
            <p class="mt-0.5 truncate text-[12.5px] text-ink-muted2">{{ t('Today’s shift', 'Turno de hoy') }}</p>
          </NuxtLink>
          <!-- The clinic's figures (the web dashboard), for whoever's role includes them -->
          <NuxtLink v-if="seesNumbers" to="/numbers" class="min-w-0 rounded-card border border-line bg-surface shadow-card px-3 py-2.5" data-cy="myday-numbers-open">
            <p class="text-[14px] font-semibold text-ink-900">{{ t('Numbers', 'Números') }}</p>
            <p class="mt-0.5 truncate text-[12.5px] text-ink-muted2">{{ t('Income, visits, no-shows', 'Ingresos, visitas, ausencias') }}</p>
          </NuxtLink>
          <!-- Paid online today (Stripe): bookings and "Pagar" from the app or portal -->
          <div v-if="onlineToday && onlineToday.count > 0" class="min-w-0 rounded-card border border-line bg-surface shadow-card px-3 py-2.5" data-cy="myday-online-paid">
            <p class="text-[14px] font-semibold text-ink-900">{{ t('Paid online', 'Pagos online') }}</p>
            <p class="mt-0.5 truncate text-[12.5px] font-semibold text-success-text">{{ t(`${onlineToday.count} · ${formatEur(onlineToday.cents)}`, `${onlineToday.count} · ${formatEur(onlineToday.cents)}`) }}</p>
          </div>
        </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// The visit, at the table: who it is and what to watch for, today's note
// (saved as it is typed), the notes from earlier visits, charging, and
// "Finish visit" -> book the next one.
//
// Everything follows the person's role, the way the web does:
//   - notes with visit_notes_access; writing today's as you type needs
//     visit_notes_edit too (useVisitNoteDraft explains why). Without it the
//     role can still add one note with "Save note", as the web's Add note
//     allows, and the notes are otherwise read-only;
//   - bono sessions left with billing_history_view (the patient record's key
//     for money); charging with billing_access, as before;
//   - check-in, no-show and finish not on a read-only calendar
//     (calendar_read_only), which the database refuses anyway (0047);
//   - booking the next visit as the patient record offers it.
import { formatEur } from '../../../utils/billing'

definePageMeta({ layout: 'practitioner' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const route = useRoute()
const router = useRouter()
const appointmentId = route.params.id as string
const t = useT()
const locale = computed(() => t('en-GB', 'es-ES'))

interface Appointment {
  id: string
  patient_id: string
  starts_at: string
  ends_at: string
  status: string
  checked_in_at: string | null
  confirmation_status: string | null
  appointment_type_id: string | null
  practitioner_id: string | null
  clinic_id: string | null
  room_id: string | null
  team_members: { full_name: string } | null
  patients: { first_name: string; last_name: string | null; red_flags: string | null; yellow_flags: string | null; sticky_note: string | null; chief_complaint: string | null; diagnosis: string | null } | null
  appointment_types: { name: string; default_price_cents: number } | null
  clinics: { timezone: string | null } | null
}

const supabase = useSupabaseClient()
const { context, loading: contextLoading, can, restricted, ownDiaryOnly } = usePractitionerContext()
const { fire } = useAutomations()
const { ask } = useAppConfirm()
const { keyboardHeight } = useKeyboardInset()

const appointment = ref<Appointment | null>(null)
const loading = ref(true)
const billingOpen = ref(false)
// The practitioner's own price for this type when they have one -- what the
// desktop calendar and online booking charge (effectivePriceCents) -- else
// the type's default. Read when billing opens.
const visitPriceCents = ref<number | undefined>(undefined)

async function loadAppointment() {
  const { data } = await supabase
    .from('appointments')
    .select(
      'id, patient_id, starts_at, ends_at, status, checked_in_at, confirmation_status, appointment_type_id, practitioner_id, clinic_id, room_id, team_members(full_name), patients(first_name, last_name, red_flags, yellow_flags, sticky_note, chief_complaint, diagnosis), appointment_types(name, default_price_cents), clinics(timezone)',
    )
    .eq('id', appointmentId)
    .maybeSingle()
  appointment.value = data as unknown as Appointment
  loading.value = false
}

const timeZone = computed(() => appointment.value?.clinics?.timezone || DEFAULT_CLINIC_TIMEZONE)
const fullName = computed(() => [appointment.value?.patients?.first_name, appointment.value?.patients?.last_name].filter(Boolean).join(' '))
const initials = computed(() => [appointment.value?.patients?.first_name?.[0], appointment.value?.patients?.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?')
const typeName = computed(() => appointment.value?.appointment_types?.name ?? t('Appointment', 'Cita'))
const timeRange = computed(() => {
  const a = appointment.value
  if (!a) return ''
  const start = new Date(a.starts_at)
  const sameDay = clinicDateOf(start, timeZone.value) === clinicDateOf(new Date(), timeZone.value)
  const range = `${clinicTimeLabel(start, timeZone.value)}–${clinicTimeLabel(new Date(a.ends_at), timeZone.value)}`
  return sameDay ? range : `${shortDayLabel(start, locale.value, timeZone.value)} · ${range}`
})
function when(iso: string) {
  const d = new Date(iso)
  return `${shortDayLabel(d, locale.value, timeZone.value)}, ${clinicTimeLabel(d, timeZone.value)}`
}

// -- What the role allows --------------------------------------------------------
const readOnlyCalendar = computed(() => restricted('calendar_read_only'))
const canAct = computed(() => appointment.value?.status === 'booked' && !readOnlyCalendar.value)
const canBook = computed(() => {
  if (!context.value || readOnlyCalendar.value) return false
  return context.value.isOwner || context.value.permissions.calendar_scope !== 'none'
})
const canReadNotes = computed(() => can('visit_notes_access'))
const canWriteNotes = computed(() => can('visit_notes_access') && can('visit_notes_edit'))
const canAddNote = computed(() => can('visit_notes_access') && !can('visit_notes_edit'))
const notesScopeAll = computed(() => !!context.value && (context.value.isOwner || context.value.permissions.visit_notes_scope === 'all'))
const showMoney = computed(() => can('billing_history_view'))
// calendar_scope 'own': RLS returns only this person's own appointments, so
// a count of the plan's completed visits would leave out every one another
// practitioner saw -- "visit 1 of 12" on a plan half done. The plan's length
// is shown instead of a number that is wrong (ownDiaryOnly).

// -- Status --------------------------------------------------------------------
const statusChip = computed<{ label: string; cls: string } | null>(() => {
  const a = appointment.value
  if (!a) return null
  if (a.status === 'completed') return { label: t('Done', 'Hecha'), cls: 'bg-success-bg text-success-text' }
  if (a.status === 'no_show') return { label: t('No-show', 'No vino'), cls: 'bg-danger-bg text-danger-text' }
  if (a.status === 'cancelled') return { label: t('Cancelled', 'Cancelada'), cls: 'bg-surface-subtle text-ink-muted' }
  if (a.checked_in_at) return { label: t('In clinic', 'En clínica'), cls: 'bg-brand-tint text-brand-text' }
  if (canAct.value) return null // the Check in button stands there instead
  return { label: t('Booked', 'Reservada'), cls: 'bg-surface-subtle text-ink-muted' }
})

const busy = ref(false)
const actionError = ref('')

// The web's check-in (AppointmentPanel's advance): the time, then the
// 'appointment.checked_in' automations -- only when this tap is what checked
// them in, so a double tap does not fire it twice.
async function checkIn() {
  if (busy.value) return
  busy.value = true
  actionError.value = ''
  const { data, error } = await supabase
    .from('appointments')
    .update({ checked_in_at: new Date().toISOString() } as never)
    .eq('id', appointmentId)
    .is('checked_in_at', null)
    .select('id')
  if (error) actionError.value = error.message
  else if ((data ?? []).length > 0 && appointment.value) fire('appointment.checked_in', { patientId: appointment.value.patient_id, appointmentId })
  await loadAppointment()
  busy.value = false
}

// -- Care plan -----------------------------------------------------------------
interface Plan { name: string; total_visits: number; frequency_value: number; frequency_unit: string; visits_per_period: number | null; started_at: string }
const plan = ref<Plan | null>(null)
const visitNumber = ref<number | null>(null)
// Which visit of the plan THIS one is: the visits completed since the plan
// started (as the patient record and care_plan_continuity_alerts count them)
// before this one, plus this one. Stays the same once it is completed.
async function loadPlan() {
  const a = appointment.value
  if (!a) return
  const { data } = await supabase
    .from('care_plans')
    .select('name, total_visits, frequency_value, frequency_unit, visits_per_period, started_at')
    .eq('patient_id', a.patient_id)
    .order('created_at', { ascending: false })
    .limit(1)
  plan.value = ((data as Plan[] | null) ?? [])[0] ?? null
  if (!plan.value) return
  const { count } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('patient_id', a.patient_id)
    .eq('status', 'completed')
    .is('deleted_at', null)
    .neq('id', a.id)
    .gte('starts_at', plan.value.started_at)
    .lt('starts_at', a.starts_at)
  visitNumber.value = (count ?? 0) + 1
}
// Starting or changing the plan in the room (CarePlanSheet, as on the record).
const planSheetOpen = ref(false)
function onPlanSaved() {
  planSheetOpen.value = false
  loadPlan()
}

// -- Alerts and bono ----------------------------------------------------------
const alerts = computed(() => {
  const p = appointment.value?.patients
  if (!p) return []
  const rows: { key: string; text: string; cls: string }[] = []
  if (p.red_flags?.trim()) rows.push({ key: 'red', text: p.red_flags.trim(), cls: 'bg-danger-bg text-danger-text' })
  if (p.yellow_flags?.trim()) rows.push({ key: 'yellow', text: p.yellow_flags.trim(), cls: 'bg-warning-bg text-warning-text' })
  if (p.sticky_note?.trim()) rows.push({ key: 'note', text: p.sticky_note.trim(), cls: 'bg-surface-subtle text-ink-700' })
  return rows
})

// -- Charging (unchanged: composables/useVisitCharging.ts) -----------------------
// Charging the visit is the web's own implementation, which the calendar's
// Billing tab uses too. Who is charging comes from usePractitionerContext,
// since there is no account store in this app.
const {
  creditLedgerCents,
  activePackages,
  refresh: refreshMoney,
  invoice,
  loadingInvoice,
  appointmentIsUpcoming,
  packageCoverage,
  otherReceipts,
  saving,
  error,
  paidCents,
  balanceDueCents,
  paymentMethods,
  paymentRows,
  paymentTotalCents,
  init: initCharging,
  chargeVisit,
  usePackageSession,
  recordPayment,
} = useVisitCharging({
  appointmentId,
  patientId: () => appointment.value?.patient_id ?? '',
  appointmentTypeName: () => appointment.value?.appointment_types?.name,
  appointmentTypePriceCents: visitPriceCents,
  accountId: () => context.value?.accountId,
  teamMemberId: () => context.value?.teamMemberId,
  can,
  // Paying in full or drawing a bono session completes the visit. When that
  // is what completed it, it is finished: the next step is the same as
  // "Finish visit" -- book the next one.
  onCompleted: async () => {
    const wasOpen = appointment.value?.status === 'booked'
    await loadAppointment()
    if (wasOpen && appointment.value?.status === 'completed') afterFinish()
  },
})

const bonoChip = computed(() => {
  if (!showMoney.value) return null
  const list = activePackages.value
  if (list.length === 0) return null
  const left = list.reduce((sum, p) => sum + Math.max(0, p.sessions_total - p.sessions_used), 0)
  const name = list.length === 1 ? list[0].package_name : t('Bonos', 'Bonos')
  return `${name} · ${left === 1 ? t('1 left', 'queda 1') : t(`${left} left`, `quedan ${left}`)}`
})

async function loadVisitPrice() {
  const appt = appointment.value
  if (!appt) return
  let priceCents = appt.appointment_types?.default_price_cents ?? 0
  if (appt.appointment_type_id && appt.practitioner_id) {
    const { data: override } = await supabase
      .from('appointment_type_overrides')
      .select('price_cents')
      .eq('appointment_type_id', appt.appointment_type_id)
      .eq('team_member_id', appt.practitioner_id)
      .maybeSingle()
    const own = (override as { price_cents: number | null } | null)?.price_cents
    if (own != null) priceCents = own
  }
  visitPriceCents.value = priceCents
}

// Opening billing is a read. Nothing is written until "Charge" or a bono is
// pressed -- the same choice the web's Billing tab offers.
async function openBilling() {
  billingOpen.value = true
  await loadVisitPrice()
  await initCharging()
}
function euros(cents: number) {
  return formatEur(cents)
}
// The rate a bono button quotes, rounded the way the session is billed.
function bonoRateLabel(p: { price_cents: number; sessions_total: number }) {
  return p.sessions_total ? euros(bonoPerSessionCents(p)) : '—'
}

// -- Today's note ------------------------------------------------------------------
const note = useVisitNoteDraft({
  appointmentId,
  accountId: () => context.value?.accountId,
  teamMemberId: () => context.value?.teamMemberId,
  canRead: () => canReadNotes.value,
  canWrite: () => canWriteNotes.value,
  canAdd: () => canAddNote.value,
  scopeAll: () => notesScopeAll.value,
})
const noteDraft = note.draft
const noteBox = ref<HTMLTextAreaElement | null>(null)
// Free text, or the four SOAP sections the web charts in (SoapNoteFields).
// A note already in sections opens in sections; otherwise the last choice on
// this device.
const NOTE_MODE_KEY = 'quiroflow_note_mode'
const noteMode = ref<'free' | 'soap'>('free')
try {
  if (localStorage.getItem(NOTE_MODE_KEY) === 'soap') noteMode.value = 'soap'
} catch {}
watch(
  () => note.loading.value,
  (l) => {
    if (!l && parseVisitNote(noteDraft.value).structured) noteMode.value = 'soap'
  },
)
function setNoteMode(m: 'free' | 'soap') {
  noteMode.value = m
  try {
    localStorage.setItem(NOTE_MODE_KEY, m)
  } catch {}
}
// Add mode (no visit_notes_edit): nothing is saved until "Save note".
const addComposing = computed(() => canAddNote.value && note.addOpen.value)
const addedAtLabel = computed(() => (note.savedAt.value ? clinicTimeLabel(note.savedAt.value, timeZone.value) : ''))
const addStatus = computed(() => {
  switch (note.state.value) {
    case 'saving':
      return { text: t('Saving…', 'Guardando…'), cls: 'text-ink-muted2' }
    case 'dirty':
      return { text: t('Not saved yet · kept on this phone', 'Aún sin guardar · se queda en el móvil'), cls: 'text-ink-muted2' }
    case 'error':
      if (note.errorKind.value === 'offline') return { text: t('Offline · kept on this phone, saves when back online', 'Sin conexión · guardada en el móvil, se subirá al volver la conexión'), cls: 'text-warning-text' }
      if (note.errorKind.value === 'refused') return { text: t("Not saved: your role can't add notes. Kept on this phone.", 'No guardada: tu rol no puede añadir notas. Se queda en el móvil.'), cls: 'text-danger-text' }
      return { text: t('Not saved yet · kept on this phone, retrying', 'Aún sin guardar · se queda en el móvil, reintentando'), cls: 'text-warning-text' }
    default:
      return { text: t("Your role can't edit a note once it is saved.", 'Tu rol no puede editar una nota una vez guardada.'), cls: 'text-ink-faint' }
  }
})
const noteStatus = computed(() => {
  switch (note.state.value) {
    case 'dirty':
    case 'saving':
      return { text: t('Saving…', 'Guardando…'), cls: 'text-ink-muted2' }
    case 'saved':
      return {
        text: note.savedAt.value
          ? `${t('Saved', 'Guardada')} · ${clinicTimeLabel(note.savedAt.value, timeZone.value)}`
          : t('Saved', 'Guardada'),
        cls: 'text-ink-muted2',
      }
    case 'error':
      if (note.errorKind.value === 'offline') return { text: t('Offline · kept on this phone, saves when back online', 'Sin conexión · guardada en el móvil, se subirá al volver la conexión'), cls: 'text-warning-text' }
      if (note.errorKind.value === 'refused') return { text: t("Not saved: your role can't change this note. Kept on this phone.", 'No guardada: tu rol no puede cambiar esta nota. Se queda en el móvil.'), cls: 'text-danger-text' }
      return { text: t('Not saved yet · kept on this phone, retrying', 'Aún sin guardar · se queda en el móvil, reintentando'), cls: 'text-warning-text' }
    default:
      return { text: t('Saved as you type', 'Se guarda mientras escribes'), cls: 'text-ink-faint' }
  }
})
function focusNote() {
  noteBox.value?.focus()
}
function noteAuthor(n: { team_members: { full_name: string } | null }) {
  return n.team_members?.full_name ?? null
}
function noteTime(iso: string) {
  return clinicTimeLabel(new Date(iso), timeZone.value)
}

// Leaving the screen waits for the note to be saved. If it can't be (no
// signal), the text is already on the phone and comes back next time.
onBeforeRouteLeave(async () => {
  await note.flush()
  return true
})

// -- Previous notes --------------------------------------------------------------
interface PastNote {
  id: string
  body: string
  created_at: string
  appointment_id: string
  appointments: {
    starts_at: string
    appointment_types: { name: string } | null
    team_members: { full_name: string } | null
    practitioner_name: string | null
  } | null
}
const pastNotes = ref<PastNote[]>([])
const pastLoading = ref(true)
const pastError = ref(false)
const allNotesOpen = ref(false)
const PAST_PREVIEW = 2
// The patient's notes from every other visit, newest VISIT first -- the
// Clinical tab's query and order.
async function loadPastNotes() {
  const a = appointment.value
  if (!a || !canReadNotes.value) {
    pastLoading.value = false
    return
  }
  pastError.value = false
  const { data, error: err } = await supabase
    .from('visit_notes')
    .select('id, body, created_at, appointment_id, appointments!inner(starts_at, patient_id, appointment_types(name), team_members(full_name), practitioner_name)')
    .eq('appointments.patient_id', a.patient_id)
    .neq('appointment_id', a.id)
  if (err) pastError.value = true
  pastNotes.value = ((data as unknown as PastNote[]) ?? []).slice().sort((x, y) => {
    const xt = x.appointments?.starts_at ?? x.created_at
    const yt = y.appointments?.starts_at ?? y.created_at
    return yt.localeCompare(xt)
  })
  pastLoading.value = false
}
function pastHeading(n: PastNote) {
  const at = new Date(n.appointments?.starts_at ?? n.created_at)
  const day = at.toLocaleDateString(locale.value, { day: 'numeric', month: 'short', timeZone: timeZone.value }).replace(/\./g, '')
  return [day, n.appointments?.appointment_types?.name, n.appointments?.team_members?.full_name ?? n.appointments?.practitioner_name].filter(Boolean).join(' · ')
}
const SECTION_LABELS = computed<Record<string, string>>(() => ({
  Subjective: t('Subjective', 'Subjetivo'),
  Objective: t('Objective', 'Objetivo'),
  Action: t('Action', 'Actuación'),
  Plan: t('Plan', 'Plan'),
}))
// A charted note is four labelled sections (utils/visitNote): shown with the
// labels in the reader's language, the rest as written.
function noteText(body: string) {
  const parsed = parseVisitNote(body)
  if (!parsed.structured) return body.trim()
  return [parsed.preamble, ...parsed.sections.map((s) => `${SECTION_LABELS.value[s.label]}: ${s.text}`)].filter(Boolean).join('\n')
}

// -- No-show -------------------------------------------------------------------------
// The web's "No-show" (AppointmentPanel.markNoShow): the status, the
// 'appointment.no_show' automations, then the missed-appointment fee if the
// clinic charges one, asked once. Asked first here too: on a phone the button
// is one thumb away from "Finish visit".
async function markNoShow() {
  const a = appointment.value
  if (!a || busy.value) return
  if (!(await ask({ title: t(`Mark ${fullName.value} as a no-show?`, `¿Marcar que ${fullName.value} no vino?`), confirmLabel: t('No-show', 'No vino'), cancelLabel: t('Cancel', 'Cancelar') }))) return
  busy.value = true
  actionError.value = ''
  const { data, error: err } = await supabase
    .from('appointments')
    .update({ status: 'no_show' } as never)
    .eq('id', a.id)
    .eq('status', 'booked')
    .select('id')
  if (err) actionError.value = err.message
  else if ((data ?? []).length > 0) {
    fire('appointment.no_show', { patientId: a.patient_id, appointmentId: a.id })
    // The fee raises an invoice, which only billing_access may insert: asking
    // anyone else offered a charge the database then refused without a word.
    const accountId = context.value?.accountId
    const feeCents = accountId && can('billing_access') ? await missedAppointmentFeeCents(supabase, accountId) : null
    if (accountId && feeCents) {
      const question = t(`Add the ${formatEur(feeCents)} missed-appointment fee to this patient's balance?`, `¿Añadir el cargo por no presentarse de ${formatEur(feeCents)} a su saldo?`)
      if (await ask({ title: question, confirmLabel: t('Add the fee', 'Añadir el cargo'), cancelLabel: t('No charge', 'Sin cargo') })) {
        const charged = await chargeMissedAppointmentFee(supabase, { accountId, patientId: a.patient_id, feeCents })
        if (!charged) actionError.value = t('Marked as a no-show, but the fee could not be added.', 'Marcada como no vino, pero no se ha podido añadir el cargo.')
        if (showMoney.value) refreshMoney()
      }
    }
  }
  await loadAppointment()
  busy.value = false
}

// -- Finish visit -> book the next one ------------------------------------------------
// Finishing is the web's "Done" (AppointmentPanel.markDone) through
// utils/completeVisit: completed, and 'appointment.completed' fired only if
// this tap is what completed it. Paying or drawing a bono may have completed
// it already -- then nothing is written and nothing fires again; and paying
// after finishing does not fire it again either (useVisitCharging uses the
// same helper).
async function finishVisit() {
  const a = appointment.value
  if (!a || busy.value) return
  busy.value = true
  actionError.value = ''
  await note.flush()
  const { completedNow, error: err } = await completeVisit(supabase, a.id)
  if (err) {
    actionError.value = err
    busy.value = false
    return
  }
  if (completedNow) fire('appointment.completed', { patientId: a.patient_id, appointmentId: a.id })
  await loadAppointment()
  busy.value = false
  if (appointment.value?.status === 'completed') afterFinish()
}

interface NextVisit { id: string; starts_at: string; appointment_types: { name: string } | null; team_members: { full_name: string } | null }
const bonoUsed = ref(false)
const nextVisit = ref<NextVisit | null>(null)
const bookOpen = ref(false)
const alreadyBookedOpen = ref(false)
const bookedNotice = ref('')

// After a visit is finished: if they already have a visit booked, say so
// rather than offer another; otherwise the book-next sheet, which suggests the
// day from the care plan (it counts from this visit, now their last).
async function afterFinish() {
  const a = appointment.value
  if (!a) return
  const [{ data: session }, { data: upcoming }] = await Promise.all([
    supabase.from('package_sessions').select('id').eq('appointment_id', a.id).limit(1),
    supabase
      .from('appointments')
      .select('id, starts_at, appointment_types(name), team_members(full_name)')
      .eq('patient_id', a.patient_id)
      .eq('status', 'booked')
      .is('deleted_at', null)
      .neq('id', a.id)
      .gt('starts_at', new Date().toISOString())
      .order('starts_at')
      .limit(1),
  ])
  bonoUsed.value = ((session as unknown[] | null) ?? []).length > 0
  nextVisit.value = ((upcoming as unknown as NextVisit[] | null) ?? [])[0] ?? null
  if (nextVisit.value) alreadyBookedOpen.value = true
  else if (canBook.value) bookOpen.value = true
  else alreadyBookedOpen.value = true
  loadPlan()
  if (showMoney.value) refreshMoney()
}

function openBookNext() {
  afterFinish()
}

function onBooked(e: { startsAt: string }) {
  bookOpen.value = false
  bookedNotice.value = `${t('Next visit booked', 'Próxima cita reservada')}: ${when(e.startsAt)}`
}

// Moving or cancelling from here: the same sheets as the agenda.
const moveOpen = ref(false)
const cancelOpen = ref(false)
async function onMoved(e: { startsAt: string }) {
  const before = appointment.value?.starts_at
  moveOpen.value = false
  await loadAppointment()
  bookedNotice.value = before && Date.parse(before) === Date.parse(e.startsAt) ? t('Visit changed.', 'Cita cambiada.') : `${t('Moved to', 'Movida al')} ${when(e.startsAt)}`
}

// Confirmed by phone or at the desk rather than by replying to WhatsApp, as
// the web's appointment panel does.
async function markConfirmed() {
  const a = appointment.value
  if (!a || busy.value) return
  busy.value = true
  actionError.value = ''
  const { data, error } = await supabase.from('appointments').update({ confirmation_status: 'confirmed' } as never).eq('id', a.id).select('id')
  busy.value = false
  if (error || !data?.length) {
    actionError.value = t('Could not mark it confirmed.', 'No se ha podido marcar como confirmada.')
    return
  }
  a.confirmation_status = 'confirmed'
}

// Undo a visit finished by mistake -- the web's undo_visit (20261006170032):
// reopens it, gives the bono session back and voids that session's charge,
// all or nothing. A visit paid in money is refused: that is a refund, on the
// web. A wrong tap on "Finish" drew a bono session with no way back here.
const canUndoVisit = computed(() => appointment.value?.status === 'completed' && !readOnlyCalendar.value)
async function undoVisit() {
  const a = appointment.value
  if (!a || busy.value) return
  const ok = await ask({
    title: t('Undo this visit?', '¿Deshacer esta visita?'),
    body: t('It goes back to booked. A bono session used on it is returned and its charge voided.', 'Vuelve a quedar reservada. Si usó una sesión de bono, se devuelve y se anula su cargo.'),
    confirmLabel: t('Undo visit', 'Deshacer visita'),
    danger: true,
  })
  if (!ok) return
  busy.value = true
  actionError.value = ''
  const { error } = await supabase.rpc('undo_visit' as never, { p_appointment_id: a.id } as never)
  busy.value = false
  if (error) {
    actionError.value = undoVisitError((error as { hint?: string }).hint, error.message)
    return
  }
  await loadAppointment()
  bookedNotice.value = t('Visit undone.', 'Visita deshecha.')
}
function undoVisitError(hint: string | null | undefined, message: string) {
  switch (hint) {
    case 'has_payment':
      return t('This visit has a payment recorded, so it can’t be undone here. Refund it on the web first.', 'Esta visita tiene un pago registrado y no se puede deshacer aquí. Devuelve antes el pago desde la web.')
    case 'invoice':
      return t('Your role only edits receipts on the day they were made.', 'Tu rol solo edita recibos del mismo día.')
    case 'bono':
    case 'bono_session':
      return t('Your role can’t give sessions back to a bono.', 'Tu rol no permite devolver sesiones a un bono.')
    case 'not_completed':
      return t('This visit is no longer marked done.', 'Esta visita ya no está marcada como hecha.')
    default:
      return message
  }
}
async function onCancelled(message: string) {
  cancelOpen.value = false
  await loadAppointment()
  bookedNotice.value = message
}

function goBack() {
  if (window.history.state?.back) router.back()
  else navigateTo('/calendar')
}

// -- Loading -------------------------------------------------------------------------
onMounted(async () => {
  await loadAppointment()
  loadPlan()
})
// Notes need to know the role first: whether to show them, and which note
// this person may write.
let notesLoaded = false
watch(
  [contextLoading, () => appointment.value?.id],
  ([ctxBusy, id]) => {
    if (ctxBusy || !id || !context.value) return
    if (!notesLoaded) {
      notesLoaded = true
      note.load()
      loadPastNotes()
    }
    if (showMoney.value) refreshMoney()
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 md:px-5">
      <button type="button" class="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center text-brand-text" :aria-label="t('Back', 'Atrás')" @click="goBack">
        <AppChevron dir="left" :size="24" />
      </button>
      <h1 class="min-w-0 flex-1 truncate text-[17px] font-semibold text-ink-900" data-cy="visit-patient-name">{{ appointment ? fullName : t('Visit', 'Visita') }}</h1>
      <span v-if="statusChip" class="inline-flex h-6 shrink-0 items-center rounded-pill px-2.5 text-[11.5px] font-semibold" :class="statusChip.cls" data-cy="visit-status">{{ statusChip.label }}</span>
      <button
        v-else-if="appointment && canAct && !appointment.checked_in_at"
        type="button"
        class="inline-flex h-8 shrink-0 items-center rounded-pill border border-brand-tintBorder bg-brand-tint px-3 text-[13px] font-semibold text-brand-text disabled:opacity-50"
        :disabled="busy"
        data-cy="visit-check-in"
        @click="checkIn"
      >
        {{ t('Check in', 'Registrar llegada') }}
      </button>
    </div>

    <div v-if="loading" class="flex-1 space-y-2.5 px-3.5 py-3">
      <UiSkeleton class="h-[86px] w-full rounded-card" />
      <UiSkeleton class="h-[170px] w-full rounded-card" />
      <UiSkeleton class="h-[120px] w-full rounded-card" />
    </div>
    <p v-else-if="!appointment" class="flex flex-1 items-center justify-center px-6 text-center text-sm text-ink-muted">{{ t('Appointment not found.', 'Cita no encontrada.') }}</p>

    <template v-else>
      <!-- On a wide iPad: the patient and today's note on the left, the earlier
           notes, charging and the visit's own actions on the right. The
           wrappers are display:contents below that, so the phone keeps its one
           column in the same order. -->
      <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 py-3 md:px-[max(1.5rem,calc((100%_-_44rem)/2))] lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:content-start lg:items-start lg:gap-4 lg:px-6" :style="keyboardHeight ? { paddingBottom: `${keyboardHeight + 16}px` } : undefined">
        <div class="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-2.5">
        <p v-if="bookedNotice" class="rounded-card border border-success-border bg-success-bg px-3 py-2 text-[13px] font-medium text-success-text" role="status" data-cy="visit-booked-notice">{{ bookedNotice }}</p>

        <!-- Who, what, the plan, what to watch for -->
        <section class="rounded-card border border-line bg-surface shadow-card px-3.5 py-3" data-cy="visit-header">
          <div class="flex items-center gap-2">
          <NuxtLink :to="`/patients/${appointment.patient_id}`" class="flex min-w-0 flex-1 items-center gap-2.5">
            <span class="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-brand-tint text-[12.5px] font-bold text-brand-text">{{ initials }}</span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[14px] font-semibold text-ink-900">{{ typeName }} · {{ timeRange }}</span>
              <span v-if="plan && visitNumber && !ownDiaryOnly" class="block truncate text-[12.5px] text-ink-muted2" data-cy="visit-plan">
                {{ t('Care plan', 'Plan') }}: {{ t('visit', 'visita') }} {{ visitNumber }} {{ t('of', 'de') }} {{ plan.total_visits }} · {{ cadenceLabel(plan, t) }}
              </span>
              <span v-else-if="plan" class="block truncate text-[12.5px] text-ink-muted2" data-cy="visit-plan">
                {{ t('Care plan', 'Plan') }}: {{ t(`${plan.total_visits} visits`, `${plan.total_visits} visitas`) }} · {{ cadenceLabel(plan, t) }}
              </span>
              <span v-else class="block truncate text-[12.5px] text-ink-muted2">{{ t('Patient record', 'Ficha del paciente') }} <AppChevron :size="11" /></span>
            </span>
          </NuxtLink>
          <button type="button" class="flex h-9 shrink-0 items-center rounded-ctl border border-line-control px-2.5 text-[12.5px] font-semibold text-brand-text" data-cy="visit-plan-edit" @click="planSheetOpen = true">{{ plan ? t('Plan', 'Plan') : t('+ Plan', '+ Plan') }}</button>
          </div>
          <!-- Why they came and the working diagnosis, read before treating -->
          <dl v-if="appointment.patients?.chief_complaint?.trim() || appointment.patients?.diagnosis?.trim()" class="mt-2 space-y-0.5 text-[12.5px] leading-snug" data-cy="visit-clinical">
            <div v-if="appointment.patients?.chief_complaint?.trim()" class="flex gap-1.5"><dt class="shrink-0 text-ink-muted2">{{ t('Complaint', 'Motivo') }}:</dt><dd class="line-clamp-2 text-ink-900">{{ appointment.patients.chief_complaint }}</dd></div>
            <div v-if="appointment.patients?.diagnosis?.trim()" class="flex gap-1.5"><dt class="shrink-0 text-ink-muted2">{{ t('Diagnosis', 'Diagnóstico') }}:</dt><dd class="line-clamp-2 text-ink-900">{{ appointment.patients.diagnosis }}</dd></div>
          </dl>
          <div v-if="alerts.length > 0 || bonoChip" class="mt-2 flex flex-wrap gap-1.5" data-cy="visit-alerts">
            <span v-for="al in alerts" :key="al.key" class="inline-flex min-h-6 max-w-full items-center gap-1 rounded-card px-2.5 py-[3px] text-[11.5px] font-semibold leading-snug" :class="al.cls">
              <svg v-if="al.key !== 'note'" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" class="shrink-0" aria-hidden="true"><path d="M8 2l6.2 11H1.8z" stroke-linejoin="round" /><path d="M8 6.5v3M8 11.5v.1" stroke-linecap="round" /></svg>
              <span class="line-clamp-2">{{ al.text }}</span>
            </span>
            <span v-if="bonoChip" class="inline-flex h-6 items-center rounded-pill bg-warning-bg px-2.5 text-[11.5px] font-semibold text-warning-text" data-cy="visit-bono">{{ bonoChip }}</span>
          </div>
        </section>

        <!-- Today's note -->
        <section v-if="canReadNotes" class="rounded-card border border-line bg-surface shadow-card px-3.5 py-3" data-cy="visit-note">
          <div class="mb-1.5 flex items-center justify-between">
            <h2 class="text-[10.5px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t("Today's note", 'Nota de hoy') }}</h2>
            <span v-if="!canWriteNotes && !addComposing" class="text-[11.5px] text-ink-faint" data-cy="visit-note-read-only">{{ t('Read only', 'Solo lectura') }}</span>
          </div>

          <div v-if="note.loading.value" class="space-y-1.5">
            <UiSkeleton class="h-[118px] w-full rounded-[10px]" />
          </div>
          <div v-else-if="note.loadError.value" class="text-[13px] text-danger-text">
            {{ t("Couldn't load the notes.", 'No se han podido cargar las notas.') }}
            <button type="button" class="ml-1 font-medium text-brand-text" @click="note.load()">{{ t('Retry', 'Reintentar') }}</button>
          </div>
          <template v-else>
            <!-- Other notes on this same visit: someone else's, or (read-only) all of them -->
            <ul v-if="(canWriteNotes ? note.otherNotes.value : note.notes.value).length > 0" class="mb-2 space-y-2" data-cy="visit-note-others">
              <li v-for="n in canWriteNotes ? note.otherNotes.value : note.notes.value" :key="n.id" class="rounded-[10px] bg-surface-page px-2.5 py-2">
                <p class="text-[11.5px] font-semibold text-ink-muted2">{{ [noteAuthor(n), noteTime(n.created_at)].filter(Boolean).join(' · ') }}</p>
                <p class="mt-0.5 whitespace-pre-wrap text-[13.5px] leading-snug text-ink-900">{{ noteText(n.body) }}</p>
              </li>
            </ul>
            <p v-else-if="!canWriteNotes && !addComposing" class="text-[13px] text-ink-faint">{{ t('No note for this visit yet.', 'Aún no hay nota de esta visita.') }}</p>
            <p v-if="canAddNote && !addComposing && note.savedAt.value" class="-mt-1 mb-1 text-[12.5px] text-ink-muted2" role="status" data-cy="visit-note-status">
              {{ t('Saved', 'Guardada') }} · {{ addedAtLabel }}
            </p>

            <!-- Add mode: written once, saved by the button, then read-only -->
            <template v-if="addComposing">
              <textarea
                ref="noteBox"
                v-model="noteDraft"
                rows="5"
                :readonly="note.state.value === 'saving'"
                :placeholder="t('Type, or tap the microphone on the keyboard to dictate…', 'Escribe, o pulsa el micrófono del teclado para dictar…')"
                class="block min-h-[118px] w-full resize-none rounded-[10px] border border-line-control bg-surface px-2.5 py-2 text-[15px] leading-[1.45] text-ink-900 placeholder:text-ink-faint focus:border-brand-tintBorder focus:outline-none focus:ring-[3px] focus:ring-brand-tint"
                data-cy="visit-note-input"
                @input="note.onInput()"
              ></textarea>
              <div class="mt-1.5 flex items-start justify-between gap-3">
                <p class="text-[12.5px] leading-snug" :class="addStatus.cls" role="status" data-cy="visit-note-status">
                  {{ addStatus.text }}
                  <button v-if="note.state.value === 'error' && note.errorKind.value !== 'refused'" type="button" class="ml-1 font-medium text-brand-text" @click="note.save()">{{ t('Retry now', 'Reintentar') }}</button>
                </p>
                <UiBtn
                  size="sm"
                  variant="primary"
                  class="shrink-0"
                  :disabled="!noteDraft.trim() || note.state.value === 'saving' || (note.state.value === 'error' && note.errorKind.value !== 'refused')"
                  data-cy="visit-note-save"
                  @click="note.submit()"
                >
                  {{ note.state.value === 'saving' ? t('Saving…', 'Guardando…') : t('Save note', 'Guardar nota') }}
                </UiBtn>
              </div>
            </template>

            <template v-if="canWriteNotes">
              <div role="tablist" :aria-label="t('Note format', 'Formato de la nota')" class="mb-2 grid grid-cols-2 gap-1 rounded-ctl bg-chip-bg p-[3px]">
                <button v-for="m in (['free', 'soap'] as const)" :key="m" type="button" role="tab" :aria-selected="noteMode === m" class="h-8 rounded-ctlSm text-[12.5px] font-semibold" :class="noteMode === m ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-muted'" :data-cy="`visit-note-mode-${m}`" @click="setNoteMode(m)">
                  {{ m === 'free' ? t('Free text', 'Libre') : t('S · O · A · P', 'Por apartados') }}
                </button>
              </div>
              <SoapNoteFields v-if="noteMode === 'soap'" v-model="noteDraft" @input="note.onInput()" @blur="note.save()" />
              <textarea
                v-else
                ref="noteBox"
                v-model="noteDraft"
                rows="5"
                :placeholder="t('Type, or tap the microphone on the keyboard to dictate…', 'Escribe, o pulsa el micrófono del teclado para dictar…')"
                class="block min-h-[118px] w-full resize-none rounded-[10px] border border-line-control bg-surface px-2.5 py-2 text-[15px] leading-[1.45] text-ink-900 placeholder:text-ink-faint focus:border-brand-tintBorder focus:outline-none focus:ring-[3px] focus:ring-brand-tint"
                data-cy="visit-note-input"
                @input="note.onInput()"
                @blur="note.save()"
              ></textarea>
              <div class="mt-1.5 flex items-start justify-between gap-3">
                <p class="text-[12.5px] leading-snug" :class="noteStatus.cls" role="status" data-cy="visit-note-status">
                  {{ noteStatus.text }}
                  <button v-if="note.state.value === 'error' && note.errorKind.value !== 'refused'" type="button" class="ml-1 font-medium text-brand-text" @click="note.save()">{{ t('Retry now', 'Reintentar') }}</button>
                </p>
                <button type="button" class="flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-brand-text" :aria-label="t('Dictate with the keyboard microphone', 'Dictar con el micrófono del teclado')" @click="focusNote">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" /><path d="M3 7.5a5 5 0 0010 0M8 12.5v2" stroke-linecap="round" /></svg>
                  {{ t('Dictate', 'Dictar') }}
                </button>
              </div>
            </template>
          </template>
        </section>
        </div>

        <div class="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-2.5">
        <!-- Previous notes -->
        <section v-if="canReadNotes" class="rounded-card border border-line bg-surface shadow-card px-3.5 py-3" data-cy="visit-previous-notes">
          <h2 class="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('Previous notes', 'Notas anteriores') }}</h2>
          <div v-if="pastLoading" class="space-y-2">
            <UiSkeleton class="h-3.5 w-48 rounded-ctlSm" />
            <UiSkeleton class="h-3 w-full rounded-ctlSm" />
          </div>
          <p v-else-if="pastError" class="text-[13px] text-danger-text">{{ t("Couldn't load the previous notes.", 'No se han podido cargar las notas anteriores.') }}</p>
          <p v-else-if="pastNotes.length === 0" class="text-[13px] text-ink-faint">{{ t('No notes from earlier visits.', 'No hay notas de visitas anteriores.') }}</p>
          <div v-else class="flex flex-col gap-2 border-l-2 border-line-control pl-2.5">
            <div v-for="n in pastNotes.slice(0, PAST_PREVIEW)" :key="n.id">
              <p class="truncate text-[12.5px] font-semibold text-ink-700">{{ pastHeading(n) }}</p>
              <p class="line-clamp-3 whitespace-pre-line text-[13px] leading-snug text-ink-900">{{ noteText(n.body) }}</p>
            </div>
            <button v-if="pastNotes.length > PAST_PREVIEW" type="button" class="self-start text-[12.5px] font-medium text-brand-text" data-cy="visit-all-notes" @click="allNotesOpen = true">
              {{ t(`All ${pastNotes.length} notes`, `Las ${pastNotes.length} notas`) }} <AppChevron :size="12" />
            </button>
          </div>
        </section>

        <!-- Charging: as before, composables/useVisitCharging -->
        <div v-if="!billingOpen && can('billing_access') && !readOnlyCalendar && appointment.status !== 'cancelled'">
          <button
            type="button"
            class="w-full rounded-card border border-line-control bg-surface px-4 py-2.5 text-center text-[14px] font-medium text-ink-700 active:bg-surface-subtle"
            data-cy="visit-bill"
            @click="openBilling"
          >
            {{ t('Bill this visit', 'Cobrar esta visita') }}
          </button>
        </div>

        <div v-else-if="billingOpen" class="rounded-card border border-line bg-surface shadow-card p-3.5" data-cy="visit-billing">
          <p class="mb-2 text-[10.5px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('Billing', 'Cobro') }}</p>
          <p v-if="loadingInvoice" class="text-[13px] text-ink-faint">{{ t('Loading…', 'Cargando…') }}</p>
          <p v-else-if="!invoice && appointmentIsUpcoming" class="text-[13px] text-ink-faint">
            {{ t("This appointment hasn't happened yet — no receipt until it does.", 'Esta cita aún no ha tenido lugar: no hay recibo hasta entonces.') }}
          </p>
          <!-- No invoice because a bono covered the visit -- say so, rather
          than an empty sheet. -->
          <p v-else-if="!invoice && packageCoverage" class="text-[13px] text-ink-muted2">
            {{ t(`Covered by ${packageCoverage.packageName || 'a bono'} — worth ${euros(packageCoverage.amountCents)}, already paid when the bono was bought.`, `Cubierta por ${packageCoverage.packageName || 'un bono'}: ${euros(packageCoverage.amountCents)}, ya pagados al comprar el bono.`) }}
          </p>
          <!-- Past visit, nothing billed yet: charge it, or spend a bono
          session. Nothing is owed until one is pressed. -->
          <div v-else-if="!invoice" class="space-y-2">
            <p class="text-[13.5px] text-ink-700">
              {{ t('Not charged yet', 'Sin cobrar') }} · {{ typeName }}<span v-if="(visitPriceCents ?? 0) > 0"> — {{ euros(visitPriceCents ?? 0) }}</span>
            </p>
            <button
              v-for="p in activePackages"
              :key="p.id"
              type="button"
              class="w-full rounded-ctl bg-brand px-4 py-2.5 text-center text-[14px] font-medium text-white active:opacity-90 disabled:opacity-50"
              :disabled="saving"
              @click="usePackageSession(p)"
            >
              {{ t(`Use ${p.package_name} — ${bonoRateLabel(p)} (${p.sessions_total - p.sessions_used} left)`, `Usar ${p.package_name}: ${bonoRateLabel(p)} (quedan ${p.sessions_total - p.sessions_used})`) }}
            </button>
            <UiBtn :variant="activePackages.length > 0 ? 'secondary' : 'primary'" class="w-full" :disabled="saving" @click="chargeVisit">
              <template v-if="saving">{{ t('Saving…', 'Guardando…') }}</template>
              <template v-else-if="(visitPriceCents ?? 0) > 0">{{ activePackages.length > 0 ? t(`Charge ${euros(visitPriceCents ?? 0)} instead`, `Cobrar ${euros(visitPriceCents ?? 0)} en su lugar`) : t(`Charge ${euros(visitPriceCents ?? 0)}`, `Cobrar ${euros(visitPriceCents ?? 0)}`) }}</template>
              <template v-else>{{ activePackages.length > 0 ? t('Charge this visit instead', 'Cobrar la visita en su lugar') : t('Charge this visit', 'Cobrar la visita') }}</template>
            </UiBtn>
          </div>
          <template v-else>
            <p v-if="packageCoverage" class="mb-2 text-[12.5px] text-ink-muted2">
              {{ t(`Covered by ${packageCoverage.packageName || 'a bono'} — charged at the bono rate against money already paid.`, `Cubierta por ${packageCoverage.packageName || 'un bono'}: cobrada a precio de bono con dinero ya pagado.`) }}
            </p>
            <p class="text-[13.5px] text-ink-700">{{ invoice.invoice_number }} · <span :class="invoice.status === 'paid' ? 'text-success-text' : 'text-warning-text'">{{ invoice.status === 'paid' ? t('paid', 'pagado') : invoice.status === 'void' ? t('void', 'anulado') : t('unpaid', 'sin pagar') }}</span></p>
            <p class="mt-1 text-[13px] text-ink-muted2">
              {{ t('Total', 'Total') }} {{ euros(invoice.total_cents) }} · {{ t('Paid', 'Pagado') }} {{ euros(paidCents) }}<span v-if="balanceDueCents > 0"> · {{ t('Due', 'Pendiente') }} {{ euros(balanceDueCents) }}</span>
            </p>

            <div v-if="can('payments_allocate') && invoice.status !== 'void' && balanceDueCents > 0" class="mt-3 space-y-2">
              <div v-for="(row, i) in paymentRows" :key="i" class="flex gap-2">
                <input v-model="row.amount" type="number" step="0.01" min="0" class="w-24 rounded-ctl border border-line-control px-2.5 py-2 text-[14px]" />
                <select v-model="row.method" class="flex-1 rounded-ctl border border-line-control px-2.5 py-2 text-[14px]">
                  <option v-for="m in paymentMethods" :key="m.key" :value="m.key">{{ m.name }}</option>
                  <option v-if="creditLedgerCents > 0" value="credit">{{ t(`Credit on account (${euros(creditLedgerCents)} available)`, `Saldo a favor (${euros(creditLedgerCents)} disponible)`) }}</option>
                </select>
              </div>
              <UiBtn variant="primary" class="w-full" :disabled="saving || paymentTotalCents <= 0" @click="recordPayment">{{ saving ? t('Saving…', 'Guardando…') : t(`Record ${euros(paymentTotalCents)}`, `Registrar ${euros(paymentTotalCents)}`) }}</UiBtn>
            </div>

            <div v-if="can('billing_access') && invoice.status !== 'paid' && activePackages.length > 0" class="mt-2 flex flex-wrap items-center gap-2 border-t border-line-divider pt-2">
              <span class="text-[12px] text-ink-muted2">{{ t('Or use a package session:', 'O usa una sesión de bono:') }}</span>
              <button
                v-for="p in activePackages"
                :key="p.id"
                type="button"
                class="rounded-ctl border border-brand-tintBorder bg-brand-tint px-2 py-1 text-[12px] font-medium text-brand-text active:brightness-95"
                :disabled="saving"
                @click="usePackageSession(p)"
              >
                {{ p.package_name }} ({{ t(`${p.sessions_total - p.sessions_used} left`, `quedan ${p.sessions_total - p.sessions_used}`) }})
              </button>
            </div>
            <p v-if="otherReceipts.length > 0" class="mt-2 border-t border-line-divider pt-2 text-[12px] text-ink-muted2">
              {{ t('Also on this visit:', 'También en esta visita:') }}
              {{ otherReceipts.map((r) => `${r.invoice_number} (${euros(r.total_cents)}, ${r.status === 'paid' ? t('paid', 'pagado') : t('unpaid', 'sin pagar')})`).join(', ') }}
            </p>
          </template>
          <p v-if="error" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
        </div>

        <p v-if="actionError" class="text-[13px] text-danger-text">{{ actionError }}</p>

        <!-- Move or cancel, as the agenda does: before the visit has started -->
        <template v-if="canAct && !appointment.checked_in_at">
          <p v-if="appointment.confirmation_status === 'confirmed'" class="flex items-center gap-1.5 px-1 text-[13px] font-medium text-success-text" data-cy="visit-confirmed">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            {{ t('Confirmed', 'Confirmada') }}
          </p>
          <button v-else type="button" class="flex h-11 items-center justify-center rounded-card border border-line-control bg-surface text-[14px] font-medium text-ink-700 disabled:opacity-50" :disabled="busy" data-cy="visit-confirm" @click="markConfirmed">{{ t('Confirmed by phone', 'Confirmada por teléfono') }}</button>
        </template>
        <div v-if="canAct && !appointment.checked_in_at" class="grid grid-cols-2 gap-2" data-cy="visit-change">
          <button type="button" class="flex h-11 items-center justify-center rounded-card border border-line-control bg-surface text-[14px] font-medium text-ink-700" data-cy="visit-move" @click="moveOpen = true">{{ t('Change', 'Cambiar') }}</button>
          <button type="button" class="flex h-11 items-center justify-center rounded-card border border-line-control bg-surface text-[14px] font-medium text-danger-text" data-cy="visit-cancel" @click="cancelOpen = true">{{ t('Cancel visit', 'Cancelar cita') }}</button>
        </div>
        <!-- Finished by mistake -->
        <button v-if="canUndoVisit" type="button" class="flex h-10 items-center justify-center rounded-card text-[13.5px] font-medium text-ink-muted disabled:opacity-50" :disabled="busy" data-cy="visit-undo" @click="undoVisit">{{ t('Undo visit', 'Deshacer visita') }}</button>
        </div>
      </div>

      <!-- No-show / Finish visit, or book the next one once it is done -->
      <div v-if="keyboardHeight === 0 && (canAct || (appointment.status === 'completed' && canBook))" class="flex shrink-0 gap-2 border-t border-line bg-surface-page px-3.5 py-2.5" data-cy="visit-footer">
        <template v-if="canAct">
          <button type="button" class="flex h-11 flex-1 items-center justify-center rounded-card border border-line-control bg-surface text-[14px] font-medium text-ink-700 disabled:opacity-50" :disabled="busy" data-cy="visit-no-show" @click="markNoShow">
            {{ t('No-show', 'No vino') }}
          </button>
          <button type="button" class="flex h-11 flex-[2] items-center justify-center rounded-card bg-brand text-[15px] font-semibold text-white disabled:opacity-50" :disabled="busy" data-cy="visit-finish" @click="finishVisit">
            {{ busy ? t('Finishing…', 'Terminando…') : t('Finish visit', 'Terminar visita') }}
          </button>
        </template>
        <button v-else type="button" class="flex h-11 flex-1 items-center justify-center rounded-card border border-brand-tintBorder bg-brand-tint text-[15px] font-semibold text-brand-text" data-cy="visit-book-next" @click="openBookNext">
          {{ t('Book the next visit', 'Reservar la próxima cita') }}
        </button>
      </div>
    </template>

    <!-- Book the next visit -->
    <CarePlanSheet v-if="planSheetOpen && appointment" :patient-id="appointment.patient_id" :plan="plan" :today="clinicDateOf(new Date(), timeZone)" @saved="onPlanSaved" @close="planSheetOpen = false" />
    <BookVisitSheet
      v-if="bookOpen && appointment"
      :patient-id="appointment.patient_id"
      :practitioner-id="appointment.practitioner_id"
      :type-id="appointment.appointment_type_id"
      @booked="onBooked"
      @close="bookOpen = false"
    >
      <template #header>
        <div class="flex items-center justify-between gap-2" data-cy="visit-finished-header">
          <p class="text-[16px] font-semibold text-ink-900">{{ t('Visit finished', 'Visita terminada') }}</p>
          <span v-if="bonoUsed" class="text-[12.5px] text-ink-muted2">{{ t('Bono: 1 session used', 'Bono: 1 sesión usada') }}</span>
        </div>
      </template>
    </BookVisitSheet>

    <BookVisitSheet
      v-if="moveOpen && appointment"
      :patient-id="appointment.patient_id"
      :practitioner-id="appointment.practitioner_id"
      :type-id="appointment.appointment_type_id"
      :suggested-date="clinicDateOf(new Date(appointment.starts_at), timeZone)"
      :title="t(`Change · ${fullName}`, `Cambiar · ${fullName}`)"
      :preferred-start="appointment.starts_at"
      :move="{ appointmentId: appointment.id, startsAt: appointment.starts_at, endsAt: appointment.ends_at, roomId: appointment.room_id }"
      @booked="onMoved"
      @close="moveOpen = false"
    />
    <CancelVisitSheet
      v-if="cancelOpen && appointment"
      :appointment="{
        id: appointment.id,
        patient_id: appointment.patient_id,
        clinic_id: appointment.clinic_id,
        practitioner_id: appointment.practitioner_id,
        appointment_type_id: appointment.appointment_type_id,
        starts_at: appointment.starts_at,
        ends_at: appointment.ends_at,
        patientName: fullName,
        typeName: appointment.appointment_types?.name ?? null,
        practitionerName: appointment.team_members?.full_name ?? null,
      }"
      @done="onCancelled"
      @close="cancelOpen = false"
    />

    <!-- Already booked (or nothing this role can book): say so instead -->
    <div v-if="alreadyBookedOpen" class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 md:items-center md:justify-center" data-cy="visit-already-booked" @click.self="alreadyBookedOpen = false">
      <div class="flex w-full flex-col gap-3 rounded-t-[22px] bg-surface px-4 pt-2.5 shadow-popover md:max-w-[480px] md:rounded-[18px] md:pt-5" style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)" role="dialog" aria-modal="true">
        <div class="mx-auto mb-0.5 h-1 w-[38px] shrink-0 rounded-full bg-line-control md:hidden" />
        <div class="flex items-center justify-between gap-2">
          <p class="text-[16px] font-semibold text-ink-900">{{ t('Visit finished', 'Visita terminada') }}</p>
          <span v-if="bonoUsed" class="text-[12.5px] text-ink-muted2">{{ t('Bono: 1 session used', 'Bono: 1 sesión usada') }}</span>
        </div>
        <div class="rounded-card border border-line bg-surface shadow-card-page px-3.5 py-2.5">
          <template v-if="nextVisit">
            <p class="text-[14px] font-semibold text-ink-900">{{ t('Next visit already booked', 'La próxima cita ya está reservada') }}</p>
            <p class="mt-0.5 text-[12.5px] text-ink-muted2">{{ [when(nextVisit.starts_at), nextVisit.appointment_types?.name, nextVisit.team_members?.full_name].filter(Boolean).join(' · ') }}</p>
          </template>
          <p v-else class="text-[13.5px] text-ink-muted2">{{ t('No next visit booked. Reception can book it.', 'No tiene próxima cita. Recepción puede reservarla.') }}</p>
        </div>
        <button type="button" class="flex h-11 items-center justify-center rounded-card bg-brand text-[15px] font-semibold text-white" @click="alreadyBookedOpen = false">{{ t('Done', 'Listo') }}</button>
      </div>
    </div>

    <!-- Every earlier note, in full -->
    <div v-if="allNotesOpen" class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 md:items-center md:justify-center" data-cy="visit-all-notes-sheet" @click.self="allNotesOpen = false">
      <div class="flex max-h-[88%] w-full flex-col rounded-t-[22px] bg-surface shadow-popover md:max-w-[600px] md:rounded-[18px]" role="dialog" aria-modal="true" :aria-label="t('Previous notes', 'Notas anteriores')">
        <div class="shrink-0 px-4 pt-2.5">
          <div class="mx-auto mb-2 h-1 w-[38px] rounded-full bg-line-control md:hidden" />
          <div class="flex items-center justify-between pb-2">
            <p class="text-[16px] font-semibold text-ink-900">{{ t(`${pastNotes.length} previous notes`, `${pastNotes.length} notas anteriores`) }}</p>
            <button type="button" class="py-1 text-[14px] font-medium text-brand-text" @click="allNotesOpen = false">{{ t('Close', 'Cerrar') }}</button>
          </div>
        </div>
        <ul class="flex-1 space-y-3 overflow-y-auto border-t border-line-divider px-4 pt-3" style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)">
          <li v-for="n in pastNotes" :key="n.id">
            <p class="text-[12.5px] font-semibold text-ink-700">{{ pastHeading(n) }}</p>
            <p class="mt-0.5 whitespace-pre-wrap text-[13.5px] leading-snug text-ink-900">{{ noteText(n.body) }}</p>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

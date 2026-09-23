<script setup lang="ts">
import type { BusinessHours } from '~/utils/businessHours'
import { dayKeyFor, hasBusinessHoursConfigured, practitionerWindowsForDay, windowsForDay, withinWindows } from '~/utils/businessHours'
import { effectivePriceCents, effectiveDuration, type AppointmentTypeOverride } from '~/utils/appointmentOverrides'
import { normalizeSearchTerm, sanitizeSearchToken } from '~/utils/searchText'
import { COUNTRIES_BY_NAME } from '~/utils/countries'
import { splitDialPrefix } from '~/utils/phone'
import { formatEur, formatShortDate, formatTime, formatWeekdayDate } from '~/utils/billing'
import { findFreeSlots, firstClash, type Busy } from '~/utils/freeSlots'

// A new appointment, from a slot or from "+ Nueva cita". Laid out in the
// order the desk answers the questions on the phone -- the canvas's Create
// board:
//
//   1. who        patient search, autofocused, flags for waitlist and bono,
//                 "Nuevo paciente «q»" when nobody matches
//   2. what for   type cards with duration and price after the practitioner's
//                 overrides
//   3. with whom  practitioners, each saying whether they are free at that
//                 time -- and disabled, with the reason, when they are not
//   4. when       a live free/clash answer, and the next free times
//
// There is no backdrop: the grid stays readable beside it, so "is 20:30
// free?" can be read off the calendar, and a click on another empty slot
// moves this booking there. There is no status or confirmation field: a new
// booking is booked, and whether the patient confirms is theirs to say.
//
// Repeat, collect payment, the note and blocking the slot instead are all
// still here, under "More options" -- used less often than the four above,
// not less important.

interface RoomOption { id: string; name: string }
interface AppointmentTypeOption { id: string; name: string; duration_minutes: number; color: string; default_price_cents: number }
interface TeamMemberOption { id: string; full_name: string; color: string; business_hours?: unknown }
interface PatientOption { id: string; first_name: string; last_name: string | null }

const props = defineProps<{
  rooms: RoomOption[]
  appointmentTypes: AppointmentTypeOption[]
  teamMembers: TeamMemberOption[]
  prefillDate?: string
  prefillTime?: string
  prefillRoomId?: string
  prefillPractitionerId?: string
  /** The clinic's slot size, for the next-free-times search. */
  slotMinutes?: number
}>()

const emit = defineEmits<{ close: []; saved: [] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const { fire } = useAutomations()
const { issueFactura } = useFacturas()
const t = useT()

const activeTab = ref<'create' | 'availability'>('create')

function toDateInput(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function toTimeInput(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const date = ref(props.prefillDate ?? toDateInput(new Date()))
const time = ref(props.prefillTime ?? '09:00')
const roomId = ref(props.prefillRoomId ?? '')
const practitionerId = ref(props.prefillPractitionerId ?? '')
// Another slot clicked on the grid while this is open moves the booking there.
watch(
  () => [props.prefillDate, props.prefillTime, props.prefillRoomId] as const,
  ([d, tm, r]) => {
    if (d) date.value = d
    if (tm) time.value = tm
    if (r !== undefined) roomId.value = r
  },
)
// The calendar only learns who its practitioners are after mount, so a panel
// opened in that window is handed '' -- and left alone would book an
// appointment with no practitioner at all, which no calendar tab can show.
// Adopt the prefill when it lands, unless the user has already answered this
// themselves. "No practitioner" is a deliberate answer too and is also '', so
// only a flag tells the two apart.
const practitionerChosen = ref(false)
watch(
  () => props.prefillPractitionerId,
  (id) => {
    if (id && !practitionerChosen.value) practitionerId.value = id
  },
)
function choosePractitioner(id: string) {
  practitionerId.value = id
  practitionerChosen.value = true
}

const appointmentTypeId = ref(props.appointmentTypes[0]?.id ?? '')
const note = ref('')
const repeat = ref<'none' | 'daily' | 'weekly' | 'monthly' | 'care_plan'>('none')
const sendConfirmation = ref(true)
const error = ref('')
const saving = ref(false)

const overrides = ref<AppointmentTypeOverride[]>([])
onMounted(async () => {
  const { data } = await supabase.from('appointment_type_overrides').select('appointment_type_id, team_member_id, duration_minutes, price_cents')
  overrides.value = data ?? []
})

const selectedAppointmentType = computed(() => props.appointmentTypes.find((x) => x.id === appointmentTypeId.value))
const durationFor = (typeId: string, practId: string) => {
  const type = props.appointmentTypes.find((x) => x.id === typeId)
  return type ? effectiveDuration(type.duration_minutes, typeId, practId, overrides.value) : 30
}
const priceFor = (typeId: string, practId: string) => {
  const type = props.appointmentTypes.find((x) => x.id === typeId)
  return type ? effectivePriceCents(type.default_price_cents, typeId, practId, overrides.value) : 0
}
const duration = computed(() => durationFor(appointmentTypeId.value, practitionerId.value))
const effectivePrice = computed(() => priceFor(appointmentTypeId.value, practitionerId.value))

const startsAt = computed(() => new Date(`${date.value}T${time.value}`))
const endsAt = computed(() => new Date(startsAt.value.getTime() + duration.value * 60000))
const validTime = computed(() => !Number.isNaN(startsAt.value.getTime()))
const roomLabel = computed(() => props.rooms.find((r) => r.id === roomId.value)?.name ?? null)
const whenLabel = computed(() => (validTime.value ? `${formatWeekdayDate(startsAt.value)} · ${formatTime(startsAt.value)}–${formatTime(endsAt.value)}` : ''))

// -- Who else is booked: the day asked for and two weeks after it -----------
interface BookedRow { id: string; starts_at: string; ends_at: string; practitioner_id: string | null; room_id: string | null; patients: { first_name: string; last_name: string | null } | null }
interface BlockRow { starts_at: string; ends_at: string; practitioner_id: string | null; room_id: string | null }
const booked = ref<BookedRow[]>([])
const blocks = ref<BlockRow[]>([])
const SEARCH_DAYS = 14
async function loadBooked() {
  if (!store.currentClinicId || !validTime.value) return
  const from = new Date(startsAt.value)
  from.setHours(0, 0, 0, 0)
  const to = new Date(from)
  to.setDate(to.getDate() + SEARCH_DAYS)
  const [{ data: appts }, { data: blk }] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, starts_at, ends_at, practitioner_id, room_id, patients(first_name, last_name)')
      .eq('clinic_id', store.currentClinicId)
      .neq('status', 'cancelled')
      .is('deleted_at', null)
      .gte('starts_at', from.toISOString())
      .lt('starts_at', to.toISOString()),
    supabase.from('availability_blocks').select('starts_at, ends_at, practitioner_id, room_id').eq('clinic_id', store.currentClinicId).lt('starts_at', to.toISOString()).gt('ends_at', from.toISOString()),
  ])
  booked.value = (appts as unknown as BookedRow[]) ?? []
  blocks.value = blk ?? []
}
watch(date, loadBooked, { immediate: true })

const nameOf = (p: { first_name: string; last_name: string | null } | null) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim()
function busyFor(practId: string): Busy[] {
  if (!practId) return []
  return [
    ...booked.value.filter((a) => a.practitioner_id === practId).map((a) => ({ start: new Date(a.starts_at).getTime(), end: new Date(a.ends_at).getTime(), label: nameOf(a.patients) })),
    ...blocks.value
      .filter((b) => b.practitioner_id === practId || (b.practitioner_id === null && b.room_id === null))
      .map((b) => ({ start: new Date(b.starts_at).getTime(), end: new Date(b.ends_at).getTime(), label: t('a block', 'un bloqueo') })),
  ]
}
function roomBusy(room: string): Busy[] {
  if (!room) return []
  return booked.value.filter((a) => a.room_id === room).map((a) => ({ start: new Date(a.starts_at).getTime(), end: new Date(a.ends_at).getTime(), label: nameOf(a.patients) }))
}
function windowsFor(practId: string, day: Date): [string, string][] | null {
  const clinicHours = store.currentClinic?.business_hours as BusinessHours | null | undefined
  const hours = (props.teamMembers.find((m) => m.id === practId)?.business_hours ?? null) as BusinessHours | null
  if (!hasBusinessHoursConfigured(clinicHours) && !hasBusinessHoursConfigured(hours)) return null
  return practitionerWindowsForDay(windowsForDay(day, clinicHours), hours, dayKeyFor(day))
}
function outsideHours(practId: string, start: Date, end: Date) {
  const windows = windowsFor(practId, start)
  if (windows === null) return false
  const m = start.getHours() * 60 + start.getMinutes()
  const last = end.getHours() * 60 + end.getMinutes() - 1
  return !withinWindows(m, windows) || !withinWindows(last, windows)
}

// -- 3. With whom: each practitioner's answer for this time -----------------
const practitionerCards = computed(() =>
  props.teamMembers.map((m) => {
    const dur = durationFor(appointmentTypeId.value, m.id)
    const s = startsAt.value.getTime()
    const clash = validTime.value ? firstClash(s, s + dur * 60000, busyFor(m.id)) : null
    const off = validTime.value && outsideHours(m.id, startsAt.value, new Date(s + dur * 60000))
    return {
      id: m.id,
      name: m.full_name,
      disabled: !!clash || off,
      note: off ? t('Not working then', 'Fuera de horario') : clash ? t(`With ${clash.label}`, `Con ${clash.label}`) : t('Free', 'Libre'),
    }
  }),
)
const practitionerName = computed(() => props.teamMembers.find((m) => m.id === practitionerId.value)?.full_name ?? '')
const practitionerFirst = computed(() => practitionerName.value.split(' ')[0])

// -- 4. When: free, or what it clashes with, and the next free times ---------
const clash = computed(() => {
  if (!validTime.value) return null
  const s = startsAt.value.getTime()
  const e = endsAt.value.getTime()
  const p = firstClash(s, e, busyFor(practitionerId.value))
  if (p) return { who: practitionerFirst.value, label: p.label ?? '', at: formatTime(new Date(p.start)) }
  const r = firstClash(s, e, roomBusy(roomId.value))
  if (r) return { who: roomLabel.value ?? '', label: r.label ?? '', at: formatTime(new Date(r.start)) }
  return null
})
const outOfHours = computed(() => validTime.value && !!practitionerId.value && outsideHours(practitionerId.value, startsAt.value, endsAt.value))
// Booking over a clash on purpose -- two patients at once is how some
// practitioners work -- is still possible, but has to be asked for.
const allowDoubleBooking = ref(false)
watch([startsAt, practitionerId, roomId], () => (allowDoubleBooking.value = false))

const alternatives = computed(() => {
  if (!validTime.value || !practitionerId.value) return []
  const from = new Date(startsAt.value)
  from.setHours(0, 0, 0, 0)
  return findFreeSlots({
    from,
    notBefore: new Date(Math.max(Date.now(), from.getTime())),
    durationMin: duration.value,
    stepMin: props.slotMinutes ?? 30,
    windowsFor: (day) => windowsFor(practitionerId.value, day),
    busy: busyFor(practitionerId.value),
    count: 6,
    days: SEARCH_DAYS,
  }).filter((d) => d.getTime() !== startsAt.value.getTime())
})
function altDayLabel(d: Date) {
  return d.toDateString() === new Date().toDateString() ? t('today', 'hoy') : formatWeekdayDate(d).split(' ').slice(0, 2).join(' ')
}
function pickAlternative(d: Date) {
  date.value = toDateInput(d)
  time.value = toTimeInput(d)
}

// -- 1. Who: search, with the flags that change the booking -----------------
const patientMode = ref<'existing' | 'new'>('existing')
const patientQuery = ref('')
interface PatientResult extends PatientOption {
  sub: string
  flags: string[]
}
const searchResults = ref<PatientResult[]>([])
const searching = ref(false)
let searchTimer: ReturnType<typeof setTimeout>
watch(patientQuery, (q) => {
  clearTimeout(searchTimer)
  if (!q.trim()) {
    searchResults.value = []
    return
  }
  searching.value = true
  searchTimer = setTimeout(async () => {
    // "Name, phone, or email" -- phone numbers live on a separate table, so a
    // matching one is folded in as an extra id.in alongside the name match,
    // same approach as pages/patients/index.vue.
    const token = sanitizeSearchToken(q.trim())
    const { data: phoneMatches } = await supabase.from('patient_contact_numbers').select('patient_id').ilike('number', `%${token}%`)
    const phoneIds = [...new Set((phoneMatches ?? []).map((m) => m.patient_id))]
    const idClause = phoneIds.length > 0 ? `,id.in.(${phoneIds.join(',')})` : ''
    const { data } = await supabase
      .from('patients')
      .select('id, first_name, last_name')
      .or(`search_name.ilike.%${normalizeSearchTerm(token)}%,email.ilike.%${token}%${idClause}`)
      .order('first_name')
      .limit(20)
    const rows = data ?? []
    const ids = rows.map((r) => r.id)
    const [{ data: waiting }, { data: packs }, { data: visits }, { data: phones }] = ids.length
      ? await Promise.all([
          supabase.from('waitlist_entries').select('patient_id').in('patient_id', ids).eq('status', 'waiting'),
          supabase.from('package_purchases').select('patient_id, sessions_total, sessions_used, is_closed').in('patient_id', ids),
          supabase.from('appointments').select('patient_id, starts_at, appointment_types(name)').in('patient_id', ids).eq('status', 'completed').order('starts_at', { ascending: false }).limit(200),
          supabase.from('patient_contact_numbers').select('patient_id, number').in('patient_id', ids),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }]
    if (patientQuery.value !== q) return
    const waitingIds = new Set((waiting ?? []).map((w: { patient_id: string }) => w.patient_id))
    searchResults.value = rows.map((r) => {
      const last = (visits as { patient_id: string; starts_at: string; appointment_types: { name: string } | null }[] | null)?.find((v) => v.patient_id === r.id)
      const pack = (packs as { patient_id: string; sessions_total: number; sessions_used: number; is_closed: boolean }[] | null)?.find(
        (p) => p.patient_id === r.id && !p.is_closed && p.sessions_used < p.sessions_total,
      )
      const phone = (phones as { patient_id: string; number: string }[] | null)?.find((p) => p.patient_id === r.id)?.number
      const flags: string[] = []
      if (waitingIds.has(r.id)) flags.push(t('On waitlist', 'En espera'))
      if (pack) flags.push(`Bono ${pack.sessions_total - pack.sessions_used}/${pack.sessions_total}`)
      const sub = last
        ? t(`Last visit ${formatShortDate(last.starts_at)}${last.appointment_types ? ` · ${last.appointment_types.name}` : ''}`, `Última visita ${formatShortDate(last.starts_at)}${last.appointment_types ? ` · ${last.appointment_types.name}` : ''}`)
        : (phone ?? t('No visits yet', 'Sin visitas todavía'))
      return { ...r, sub, flags }
    })
    searching.value = false
  }, 250)
})
const selectedPatient = ref<PatientResult | null>(null)
function selectPatient(p: PatientResult) {
  selectedPatient.value = p
  patientQuery.value = ''
  searchResults.value = []
  loadCarePlan(p.id)
}
function clearPatient() {
  selectedPatient.value = null
  patientMode.value = 'existing'
  nextTick(() => document.querySelector<HTMLInputElement>('[data-cy=create-patient-search]')?.focus())
}
const initials = (p: PatientOption) => `${p.first_name?.[0] ?? ''}${p.last_name?.[0] ?? ''}`.toUpperCase()

const newPatientFirstName = ref('')
const newPatientLastName = ref('')
const newPatientEmail = ref('')
const newPatientPhone = ref('')
const newPatientPhoneCountry = ref(store.defaultPhoneCountry)
// "Nuevo paciente «mar»": what was typed becomes the name to start from.
function startNewPatient() {
  const q = patientQuery.value.trim()
  const [first, ...rest] = q.split(/\s+/)
  newPatientFirstName.value = first ? first[0].toUpperCase() + first.slice(1) : ''
  newPatientLastName.value = rest.join(' ')
  patientMode.value = 'new'
  carePlan.value = null
  carePlanRemaining.value = 0
  if (repeat.value === 'care_plan') repeat.value = 'none'
}

// -- Care plan bulk scheduling ---------------------------------------------
// Lets "Repeat" book a patient's whole remaining care plan at once instead
// of one visit at a time. Care plans don't auto-generate appointments
// (0056_care_plans.sql is explicit about that -- progress is inferred from
// real appointments, not a stored schedule), so this is the one place that
// actually creates the plan's future sessions in bulk.
interface CarePlan { id: string; name: string; frequency_value: number; frequency_unit: 'week' | 'month'; total_visits: number; started_at: string }
const carePlan = ref<CarePlan | null>(null)
// Visits with no appointment at all yet -- stricter than the "remaining" on
// the patient profile, which still counts a booked visit as remaining.
// Booking needs this number, or re-opening the panel mid-plan double-books.
const carePlanRemaining = ref(0)
async function loadCarePlan(patientId: string) {
  carePlan.value = null
  carePlanRemaining.value = 0
  const [{ data: plans }, { data: appts }] = await Promise.all([
    supabase.from('care_plans').select('id, name, frequency_value, frequency_unit, total_visits, started_at').eq('patient_id', patientId).order('created_at', { ascending: false }).limit(1),
    supabase.from('appointments').select('status, starts_at').eq('patient_id', patientId),
  ])
  const plan = (plans as CarePlan[] | null)?.[0] ?? null
  if (!plan) return
  const inPlan = (appts ?? []).filter((a) => a.starts_at >= plan.started_at)
  const completed = inPlan.filter((a) => a.status === 'completed').length
  const scheduled = inPlan.filter((a) => a.status === 'booked').length
  carePlan.value = plan
  carePlanRemaining.value = Math.max(0, plan.total_visits - completed - scheduled)
  if (repeat.value === 'care_plan' && carePlanRemaining.value === 0) repeat.value = 'none'
}
const carePlanFrequencyLabel = computed(() => {
  if (!carePlan.value) return ''
  const unitEs = carePlan.value.frequency_unit === 'week' ? 'semana' : 'mes'
  const unitEsPlural = carePlan.value.frequency_unit === 'week' ? 'semanas' : 'meses'
  return t(
    `every ${carePlan.value.frequency_value} ${carePlan.value.frequency_unit}${carePlan.value.frequency_value > 1 ? 's' : ''}`,
    `cada ${carePlan.value.frequency_value} ${carePlan.value.frequency_value > 1 ? unitEsPlural : unitEs}`,
  )
})

// -- Collect Payment --------------------------------------------------
const collectPayment = ref(false)
const paymentAmount = ref('')
const paymentMethod = ref<'cash' | 'card' | 'credit'>('cash')
watch([collectPayment, effectivePrice], ([on]) => {
  if (on) paymentAmount.value = (effectivePrice.value / 100).toFixed(2)
})

// -- Submit ------------------------------------------------------------------
const hasPatient = computed(() => (patientMode.value === 'existing' ? !!selectedPatient.value : !!newPatientFirstName.value.trim()))
const blockedByClash = computed(() => !!clash.value && !allowDoubleBooking.value)
const canBook = computed(() => hasPatient.value && validTime.value && !blockedByClash.value && !saving.value)
const cta = computed(() => {
  if (saving.value) return t('Booking…', 'Reservando…')
  if (!hasPatient.value) return t('Choose a patient to book', 'Elige paciente para reservar')
  if (blockedByClash.value) return t('Choose another time', 'Elige otra hora')
  return t(`Book · ${formatWeekdayDate(startsAt.value)} ${formatTime(startsAt.value)}`, `Reservar · ${formatWeekdayDate(startsAt.value)} ${formatTime(startsAt.value)}`)
})

async function save() {
  error.value = ''
  if (!canBook.value) return
  saving.value = true

  let patientId = selectedPatient.value?.id ?? ''
  if (patientMode.value === 'new') {
    const { data: newPatient, error: patientError } = await supabase
      .from('patients')
      .insert({
        account_id: store.accountId!,
        clinic_id: store.currentClinicId || null,
        first_name: newPatientFirstName.value.trim(),
        last_name: newPatientLastName.value.trim() || null,
        email: newPatientEmail.value.trim() || null,
        // The practitioner chosen for the visit becomes the patient's default
        // -- until this was set, 1,381 of 1,559 patients had none, and a
        // practitioner's dashboard read "0 total patients" while they had
        // treated thirteen. A default, not a verdict: Overview can change it.
        default_practitioner_id: practitionerId.value || null,
      })
      .select('id')
      .single()
    if (patientError || !newPatient) {
      error.value = patientError?.message ?? t('Could not create patient.', 'No se ha podido crear el paciente.')
      saving.value = false
      return
    }
    patientId = newPatient.id
    if (newPatientPhone.value.trim()) {
      // A dial prefix typed into the number itself wins over the dropdown, so
      // "+44 7700 900123" is not filed as Spanish (or vice versa).
      const { countryCode, number } = splitDialPrefix(newPatientPhone.value, newPatientPhoneCountry.value)
      await supabase.from('patient_contact_numbers').insert({ account_id: store.accountId!, patient_id: patientId, country_code: countryCode, number })
    }
  }

  if (outOfHours.value) {
    if (!confirm(t('This appointment falls outside working hours. Book it anyway?', 'Esta cita está fuera del horario de atención. ¿Reservarla de todos modos?'))) {
      saving.value = false
      return
    }
  }

  // Repeat is bounded rather than open-ended -- 8 occurrences covers a short
  // repeat block without silently filling a patient's calendar for months;
  // a care plan is capped at 26 for the same reason.
  const REPEAT_OCCURRENCES = 8
  const MAX_CARE_PLAN_OCCURRENCES = 26
  let stepDays: number
  let occurrences: number
  if (repeat.value === 'care_plan' && carePlan.value) {
    stepDays = carePlan.value.frequency_value * (carePlan.value.frequency_unit === 'month' ? 30 : 7)
    occurrences = Math.min(carePlanRemaining.value, MAX_CARE_PLAN_OCCURRENCES)
  } else {
    stepDays = { none: 0, daily: 1, weekly: 7, monthly: 30 }[repeat.value as 'none' | 'daily' | 'weekly' | 'monthly'] ?? 0
    occurrences = repeat.value === 'none' ? 1 : REPEAT_OCCURRENCES
  }

  let firstAppointmentId: string | null = null
  for (let i = 0; i < occurrences; i++) {
    const occStart = new Date(startsAt.value.getTime() + i * stepDays * 24 * 60 * 60 * 1000)
    const occEnd = new Date(occStart.getTime() + duration.value * 60000)
    const { data: created, error: apptError } = await supabase
      .from('appointments')
      .insert({
        account_id: store.accountId!,
        clinic_id: store.currentClinicId!,
        patient_id: patientId,
        room_id: roomId.value || null,
        practitioner_id: practitionerId.value || null,
        appointment_type_id: appointmentTypeId.value || null,
        starts_at: occStart.toISOString(),
        ends_at: occEnd.toISOString(),
        status: 'booked',
        note: note.value.trim() || null,
      })
      .select('id')
      .single()
    if (apptError || !created) {
      error.value = apptError?.message ?? t('Could not create appointment.', 'No se ha podido crear la cita.')
      saving.value = false
      return
    }
    if (i === 0) firstAppointmentId = created.id
    fire('appointment.booked', { patientId, appointmentId: created.id })
    if (sendConfirmation.value) useStaffFetch('/api/appointments/send-confirmation', { method: 'POST', body: { appointmentId: created.id } }).catch(() => {})
  }

  if (collectPayment.value && firstAppointmentId) {
    const amountCents = Math.round((parseFloat(paymentAmount.value) || 0) * 100)
    // Only draw a number when there is something to invoice --
    // next_invoice_number() consumes one on every call, by design.
    const { data: invoiceNumber } = amountCents > 0 ? await supabase.rpc('next_invoice_number', { p_account_id: store.accountId! }) : { data: null }
    if (invoiceNumber) {
      const { data: invoice } = await supabase
        .from('invoices')
        .insert({ account_id: store.accountId!, patient_id: patientId, appointment_id: firstAppointmentId, invoice_number: invoiceNumber, status: 'paid', total_cents: amountCents })
        .select('id')
        .single()
      if (invoice) {
        await supabase.from('invoice_line_items').insert({
          account_id: store.accountId!,
          invoice_id: invoice.id,
          description: selectedAppointmentType.value?.name ?? 'Appointment',
          quantity: 1,
          price_cents: amountCents,
        })
        if (paymentMethod.value === 'credit') {
          await supabase.from('payments').insert({ account_id: store.accountId!, patient_id: patientId, invoice_id: invoice.id, amount_cents: amountCents, method: 'credit' })
          await supabase.from('account_credits').insert({
            account_id: store.accountId!,
            patient_id: patientId,
            amount_cents: -amountCents,
            reason: `Applied to invoice ${invoiceNumber}`,
            invoice_id: invoice.id,
            created_by: store.teamMember?.id ?? null,
          })
        } else {
          const { data: payment } = await supabase
            .from('payments')
            .insert({ account_id: store.accountId!, patient_id: patientId, invoice_id: invoice.id, amount_cents: amountCents, method: paymentMethod.value, purpose: 'visit' })
            .select('id')
            .single()
          if (payment) {
            await issueFactura({ accountId: store.accountId!, patientId, paymentId: payment.id, amountCents, purpose: 'visit', serviceName: selectedAppointmentType.value?.name })
          }
        }
      }
    }
  }

  saving.value = false
  emit('saved')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !e.defaultPrevented) emit('close')
}
onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  // `autofocus` only applies on page load, not to a panel mounted later.
  nextTick(() => document.querySelector<HTMLInputElement>('[data-cy=create-patient-search]')?.focus())
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <!-- No backdrop: the grid stays readable (and clickable) beside it.
       z-50, above the help launcher (z-40) that would otherwise sit on the
       Book button in the bottom-right corner. -->
  <div
    role="dialog"
    aria-modal="false"
    aria-labelledby="new-title"
    data-cy="create-sheet"
    class="create-panel fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-surface shadow-popover sm:w-[520px]"
  >
    <div class="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-3.5 sm:px-6">
      <div class="flex min-w-0 flex-col">
        <h2 id="new-title" class="text-[20px] font-bold text-ink-900">{{ t('New appointment', 'Nueva cita') }}</h2>
        <span class="truncate text-[13px] text-ink-muted" data-cy="create-when">{{ whenLabel }}<template v-if="roomLabel"> · {{ roomLabel }}</template></span>
      </div>
      <button type="button" :aria-label="t('Close', 'Cerrar')" class="-mr-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle" @click="emit('close')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>

    <div v-if="activeTab === 'availability'" class="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
      <button type="button" class="mb-3 text-[13px] font-semibold text-brand-text" @click="activeTab = 'create'">← {{ t('Back to the booking', 'Volver a la cita') }}</button>
      <CalendarAvailabilityBlockInline :rooms="rooms" :prefill-date="date" :prefill-time="time" :prefill-room-id="roomId" @close="emit('close')" @saved="emit('saved')" />
    </div>

    <form v-else class="flex min-h-0 flex-1 flex-col" @submit.prevent="save">
      <div class="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4 sm:px-6">
        <!-- 1. Who -->
        <section>
          <label for="patient-q" class="mb-2 block text-[11px] font-bold uppercase tracking-[.06em] text-ink-muted">{{ t('Patient', 'Paciente') }}</label>
          <div v-if="selectedPatient && patientMode === 'existing'" class="flex items-center gap-3 rounded-card border-[1.5px] border-brand bg-brand-tint px-3 py-2.5" data-cy="create-patient-selected">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-[13px] font-bold text-brand-text">{{ initials(selectedPatient) }}</span>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-[14px] font-semibold text-ink-900">{{ selectedPatient.first_name }} {{ selectedPatient.last_name }}</span>
              <span class="truncate text-[12px] text-ink-muted">{{ selectedPatient.sub }}<template v-for="f in selectedPatient.flags" :key="f"> · {{ f }}</template></span>
            </span>
            <button type="button" class="h-11 shrink-0 rounded-ctl px-3 text-[13px] font-semibold text-brand-text hover:bg-surface" @click="clearPatient">{{ t('Change', 'Cambiar') }}</button>
          </div>
          <div v-else-if="patientMode === 'existing'" class="flex flex-col gap-1.5">
            <div class="flex h-11 items-center gap-2 rounded-ctl border-[1.5px] border-brand bg-surface px-3">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="shrink-0 text-ink-muted" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              <input
                id="patient-q"
                v-model="patientQuery"
                data-cy="create-patient-search"
                type="text"
                autocomplete="off"
                :placeholder="t('Search by name, phone, or email…', 'Buscar por nombre, teléfono o email…')"
                class="h-full min-w-0 flex-1 bg-transparent text-[14px] text-ink-900 outline-none"
              />
            </div>
            <button
              v-for="p in searchResults"
              :key="p.id"
              type="button"
              data-cy="create-patient-result"
              class="flex min-h-11 items-center gap-3 rounded-ctl px-2.5 py-1.5 text-left hover:bg-surface-subtle"
              @click="selectPatient(p)"
            >
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-chip-bg text-[12px] font-bold text-ink-500">{{ initials(p) }}</span>
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-[14px] font-semibold text-ink-900">{{ p.first_name }} {{ p.last_name }}</span>
                <span class="truncate text-[12px] text-ink-muted">{{ p.sub }}</span>
              </span>
              <span v-for="f in p.flags" :key="f" class="shrink-0 rounded-full border border-brand-tintBorder bg-brand-tint px-2 py-0.5 text-[11.5px] font-semibold text-brand-text" data-cy="create-patient-flag">{{ f }}</span>
            </button>
            <p v-if="patientQuery.trim() && !searching && searchResults.length === 0" class="px-2.5 text-[13px] text-ink-muted">{{ t('No matches', 'Sin resultados') }}</p>
            <button type="button" data-cy="create-new-patient" class="flex min-h-11 items-center gap-2 rounded-ctl border border-dashed border-line-control px-3 text-[13.5px] font-semibold text-brand-text hover:bg-brand-tint" @click="startNewPatient">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              <template v-if="patientQuery.trim()">{{ t(`New patient “${patientQuery.trim()}”`, `Nuevo paciente «${patientQuery.trim()}»`) }}</template>
              <template v-else>{{ t('New patient', 'Nuevo paciente') }}</template>
            </button>
          </div>
          <div v-else class="grid grid-cols-2 gap-2" data-cy="create-new-patient-form">
            <input v-model="newPatientFirstName" type="text" :placeholder="t('First name', 'Nombre')" required class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[13.5px] text-ink-700 focus:border-brand focus:outline-none" />
            <input v-model="newPatientLastName" type="text" :placeholder="t('Last name', 'Apellidos')" class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[13.5px] text-ink-700 focus:border-brand focus:outline-none" />
            <input v-model="newPatientEmail" type="email" :placeholder="t('Email', 'Email')" class="col-span-2 h-11 rounded-ctl border border-line-control bg-surface px-3 text-[13.5px] text-ink-700 focus:border-brand focus:outline-none" />
            <!-- Width pinned: a select takes the width of its LONGEST option
            ("+971 United Arab Emirates") and would leave the number field one
            character wide. The dial code is at the front, so clipping the name
            costs nothing. -->
            <div class="col-span-2 flex min-w-0 gap-2">
              <select v-model="newPatientPhoneCountry" class="h-11 w-[120px] shrink-0 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none">
                <option v-for="c in COUNTRIES_BY_NAME" :key="c.code" :value="c.code">{{ c.flag }} {{ c.dial }} {{ c.name }}</option>
              </select>
              <input v-model="newPatientPhone" type="tel" :placeholder="t('Phone', 'Teléfono')" class="h-11 min-w-0 flex-1 rounded-ctl border border-line-control bg-surface px-3 text-[13.5px] text-ink-700 focus:border-brand focus:outline-none" />
            </div>
            <button type="button" class="col-span-2 justify-self-start text-[12.5px] font-semibold text-brand-text" @click="clearPatient">{{ t('Search existing patients instead', 'Buscar un paciente existente') }}</button>
          </div>
        </section>

        <!-- 2. What for -->
        <section>
          <span class="mb-2 block text-[11px] font-bold uppercase tracking-[.06em] text-ink-muted">{{ t('Type', 'Tipo') }}</span>
          <div role="radiogroup" :aria-label="t('Appointment type', 'Tipo de cita')" class="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
            <button
              v-for="ty in appointmentTypes"
              :key="ty.id"
              type="button"
              role="radio"
              data-cy="create-type"
              :aria-checked="appointmentTypeId === ty.id"
              class="flex min-h-14 items-center gap-2.5 rounded-[11px] px-3 py-2 text-left text-ink-900"
              :class="appointmentTypeId === ty.id ? 'border-[1.5px] border-brand bg-brand-tint' : 'border border-line-control bg-surface hover:border-line-controlHover'"
              @click="appointmentTypeId = ty.id"
            >
              <span class="h-2.5 w-2.5 shrink-0 rounded-[3px]" :style="{ background: ty.color || 'rgb(var(--color-brand))' }" aria-hidden="true" />
              <span class="flex min-w-0 flex-col">
                <span class="truncate text-[14px] font-semibold">{{ ty.name }}</span>
                <span class="text-[12px] text-ink-muted">{{ durationFor(ty.id, practitionerId) }} min<template v-if="priceFor(ty.id, practitionerId)"> · {{ formatEur(priceFor(ty.id, practitionerId)) }}</template></span>
              </span>
            </button>
          </div>
        </section>

        <!-- 3. With whom: working hours and bookings decide what is offered -->
        <section>
          <span class="mb-2 block text-[11px] font-bold uppercase tracking-[.06em] text-ink-muted">{{ t('Practitioner', 'Profesional') }}</span>
          <div role="radiogroup" :aria-label="t('Practitioner', 'Profesional')" class="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
            <button
              v-for="p in practitionerCards"
              :key="p.id"
              type="button"
              role="radio"
              data-cy="create-practitioner"
              :aria-checked="practitionerId === p.id"
              :disabled="p.disabled && practitionerId !== p.id"
              class="flex min-h-14 flex-col items-start justify-center gap-0.5 rounded-[11px] px-3 py-1.5 text-left"
              :class="
                practitionerId === p.id
                  ? 'border-[1.5px] border-brand bg-brand-tint text-ink-900'
                  : p.disabled
                    ? 'cursor-not-allowed border border-dashed border-line-control bg-surface-subtle text-ink-faint'
                    : 'border border-line-control bg-surface text-ink-900 hover:border-line-controlHover'
              "
              @click="choosePractitioner(p.id)"
            >
              <span class="text-[14px] font-semibold">{{ p.name }}</span>
              <span class="text-[12px]" :class="p.disabled ? 'text-ink-muted' : 'font-semibold text-success-text'">{{ p.note }}</span>
            </button>
            <button
              type="button"
              role="radio"
              data-cy="create-practitioner"
              :aria-checked="practitionerId === ''"
              class="flex min-h-14 flex-col items-start justify-center rounded-[11px] px-3 py-1.5 text-left text-[14px] font-semibold"
              :class="practitionerId === '' ? 'border-[1.5px] border-brand bg-brand-tint text-ink-900' : 'border border-line-control bg-surface text-ink-muted hover:border-line-controlHover'"
              @click="choosePractitioner('')"
            >
              {{ t('No practitioner', 'Sin profesional') }}
            </button>
          </div>
        </section>

        <!-- 4. When: the answer to "can she come Thursday at six?" -->
        <section>
          <span class="mb-2 block text-[11px] font-bold uppercase tracking-[.06em] text-ink-muted">{{ t(`Time · ${duration} min`, `Hora · ${duration} min`) }}</span>
          <div class="grid grid-cols-2 gap-2 min-[420px]:grid-cols-3">
            <label class="flex flex-col gap-1 text-[12px] font-medium text-ink-600">{{ t('Date', 'Fecha') }}<input v-model="date" type="date" required class="h-11 rounded-ctl border border-line-control bg-surface px-2.5 text-[13.5px] text-ink-700" /></label>
            <label class="flex flex-col gap-1 text-[12px] font-medium text-ink-600">{{ t('Time', 'Hora') }}<input v-model="time" type="time" required class="h-11 rounded-ctl border border-line-control bg-surface px-2.5 text-[13.5px] text-ink-700" /></label>
            <label class="col-span-2 flex flex-col gap-1 text-[12px] font-medium text-ink-600 min-[420px]:col-span-1">{{ t('Room', 'Sala') }}
              <select v-model="roomId" class="h-11 rounded-ctl border border-line-control bg-surface px-2 text-[13.5px] text-ink-700">
                <option value="">{{ t('No room', 'Sin sala') }}</option>
                <option v-for="r in rooms" :key="r.id" :value="r.id">{{ r.name }}</option>
              </select>
            </label>
          </div>

          <div v-if="validTime && !clash" class="mt-3 flex items-center gap-2 rounded-ctl border border-success-border bg-success-bg px-3 py-2.5 text-[13px]" data-cy="create-free">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-success-accent" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
            <span><strong class="text-success-text">{{ t(`${formatTime(startsAt)}–${formatTime(endsAt)} is free`, `${formatTime(startsAt)}–${formatTime(endsAt)} está libre`) }}</strong><span class="text-ink-500"><template v-if="roomLabel">{{ t(` in ${roomLabel}`, ` en ${roomLabel}`) }}</template><template v-if="practitionerFirst">{{ t(` with ${practitionerFirst}`, ` con ${practitionerFirst}`) }}</template></span></span>
          </div>
          <div v-else-if="clash" class="mt-3 flex flex-col gap-1.5 rounded-ctl border border-warning-border bg-warning-bg px-3 py-2.5 text-[13px]" data-cy="create-clash">
            <span class="flex items-start gap-2">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" class="mt-0.5 shrink-0 text-warning-accent" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" /></svg>
              <span><strong class="text-warning-text">{{ t(`${formatTime(startsAt)}–${formatTime(endsAt)} doesn’t fit`, `${formatTime(startsAt)}–${formatTime(endsAt)} no cabe`) }}</strong><span class="text-ink-700">{{ t(`: ${clash.who} has ${clash.label} at ${clash.at}. Pick another time.`, `: ${clash.who} tiene a ${clash.label} a las ${clash.at}. Elige otro hueco.`) }}</span></span>
            </span>
            <label class="flex min-h-11 items-center gap-2 pl-6 text-[12.5px] text-ink-700">
              <input v-model="allowDoubleBooking" type="checkbox" class="h-4 w-4 accent-brand" data-cy="create-double-book" />
              {{ t('Book it anyway, overlapping', 'Reservar igualmente, solapada') }}
            </label>
          </div>

          <template v-if="alternatives.length">
            <span class="mt-3 block text-[12px] text-ink-muted">{{ t(`Other free times for ${selectedAppointmentType?.name ?? 'this'} with ${practitionerFirst}`, `Otros huecos para ${selectedAppointmentType?.name ?? 'esta cita'} con ${practitionerFirst}`) }}</span>
            <div class="mt-1.5 grid grid-cols-3 gap-2" data-cy="create-alternatives">
              <button v-for="a in alternatives" :key="a.getTime()" type="button" class="flex min-h-11 flex-col items-start justify-center rounded-ctl border border-line-control bg-surface px-2.5 py-1 text-left hover:border-brand" @click="pickAlternative(a)">
                <span class="text-[11.5px] text-ink-muted">{{ altDayLabel(a) }}</span>
                <strong class="font-mono text-[13.5px] font-medium text-ink-900">{{ formatTime(a) }}</strong>
              </button>
            </div>
          </template>
        </section>

        <details class="rounded-card border border-line" data-cy="create-more">
          <summary class="flex min-h-11 cursor-pointer items-center px-3.5 text-[13.5px] font-semibold text-ink-700">{{ t('More options', 'Más opciones') }}</summary>
          <div class="space-y-4 border-t border-line-divider px-3.5 py-3">
            <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-600">{{ t('Note (optional)', 'Nota (opcional)') }}
              <textarea v-model="note" rows="2" :placeholder="t('Any additional notes…', 'Notas adicionales…')" class="rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
            </label>
            <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-600">{{ t('Repeat', 'Repetir') }}
              <select v-model="repeat" class="h-11 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700">
                <option value="none">{{ t('Does not repeat', 'No se repite') }}</option>
                <option value="daily">{{ t('Daily (8 occurrences)', 'Diariamente (8 repeticiones)') }}</option>
                <option value="weekly">{{ t('Weekly (8 occurrences)', 'Semanalmente (8 repeticiones)') }}</option>
                <option value="monthly">{{ t('Monthly (8 occurrences)', 'Mensualmente (8 repeticiones)') }}</option>
                <option v-if="carePlan && carePlanRemaining > 0" value="care_plan">
                  {{ t(`Follow care plan — ${carePlanRemaining} sessions left, ${carePlanFrequencyLabel}`, `Seguir plan de tratamiento — ${carePlanRemaining} sesiones restantes, ${carePlanFrequencyLabel}`) }}
                </option>
              </select>
            </label>
            <p v-if="repeat === 'care_plan' && carePlan" class="text-[12px] text-ink-muted2">
              {{ t(`Books ${Math.min(carePlanRemaining, 26)} appointments from "${carePlan.name}", ${carePlanFrequencyLabel}, starting at the date/time above.`, `Reserva ${Math.min(carePlanRemaining, 26)} citas de "${carePlan.name}", ${carePlanFrequencyLabel}, empezando en la fecha/hora indicada arriba.`) }}
            </p>
            <div class="flex items-center justify-between">
              <span class="text-[12.5px] font-medium text-ink-600">{{ t('Collect payment now', 'Cobrar ahora') }}</span>
              <button type="button" role="switch" :aria-checked="collectPayment" :aria-label="t('Collect payment now', 'Cobrar ahora')" class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors" :class="collectPayment ? 'bg-brand' : 'bg-toggle-off'" @click="collectPayment = !collectPayment">
                <span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform" :class="collectPayment ? 'translate-x-[18px]' : 'translate-x-0.5'" />
              </button>
            </div>
            <div v-if="collectPayment" class="grid grid-cols-2 gap-3">
              <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-600">{{ t('Amount (€)', 'Importe (€)') }}<input v-model="paymentAmount" type="number" min="0" step="0.01" class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700" /></label>
              <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-600">{{ t('Method', 'Método') }}
                <select v-model="paymentMethod" class="h-11 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700">
                  <option value="cash">{{ t('Cash', 'Efectivo') }}</option>
                  <option value="card">{{ t('Card', 'Tarjeta') }}</option>
                  <option value="credit">{{ t('Credit on account', 'Crédito en cuenta') }}</option>
                </select>
              </label>
            </div>
            <button type="button" class="text-[12.5px] font-semibold text-brand-text" @click="activeTab = 'availability'">{{ t('Block this time instead…', 'Bloquear este horario en su lugar…') }}</button>
          </div>
        </details>

        <p v-if="error" class="text-[13px] text-danger-text">{{ error }}</p>
      </div>

      <div class="create-footer flex shrink-0 flex-col gap-3 border-t border-line bg-surface px-5 py-3 sm:px-6">
        <label class="flex min-h-11 items-center gap-2 text-[13px] text-ink-700">
          <input v-model="sendConfirmation" type="checkbox" class="h-4 w-4 accent-brand" data-cy="create-send-confirmation" />
          {{ t('Send WhatsApp confirmation', 'Enviar confirmación por WhatsApp') }}
        </label>
        <button
          type="submit"
          data-cy="create-submit"
          :disabled="!canBook"
          class="h-[52px] rounded-[11px] text-[15px] font-bold"
          :class="canBook ? 'bg-brand text-surface hover:bg-brand-hover' : 'cursor-not-allowed bg-chip-bg text-ink-muted'"
        >
          {{ cta }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.create-panel {
  animation: create-in 160ms ease-out;
}
@keyframes create-in {
  from {
    transform: translateX(24px);
    opacity: 0;
  }
  to {
    transform: none;
    opacity: 1;
  }
}
.create-footer {
  padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
}
</style>

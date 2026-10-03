<script setup lang="ts">
// "Book the next visit": a bottom sheet that offers the day the care plan
// says the patient is due, a few working days around it, and the free times
// on the chosen day, so the next visit is one tap.
//
// Reusable on purpose. The patient record opens it from Book, My Day links to
// /patients/<id>?book=1, and finishing a visit will open it with its own
// header (the `header` slot) -- so it takes only the patient and optional
// hints, and works out everything else itself.
//
// The free times are the same ones the online booking page and the patient
// app offer (utils/bookingSlots.ts): the practitioner's own hours (the
// clinic's when they have none), whole visits inside a window, clear of their
// non-cancelled, non-deleted appointments and of the availability blocks for
// them or the whole clinic -- read in the CLINIC's time zone, not the phone's.
//
// The insert is the web's staff booking (NewAppointmentPanel): same columns,
// source 'staff'. save_appointment_if_free is service-role only, so the clash
// check is the client-side one the web's move check does (utils/moveClash),
// asked again of the database right before the insert -- the slots on screen
// can be minutes old.
import type { BusinessHours } from '../../utils/businessHours'
import type { BookingBusyRange } from '../../utils/bookingSlots'
import type { AppointmentTypeOverride } from '../../utils/appointmentOverrides'
import type { ClashCandidateAppointment, ClashCandidateBlock } from '../../utils/moveClash'

const props = defineProps<{
  patientId: string
  /** Who the visit is with. Default: the patient's practitioner, else the signed-in one. */
  practitionerId?: string | null
  /** The visit's type. Default: the type of their last visit. */
  typeId?: string | null
  /** YYYY-MM-DD to centre the days on. Default: worked out from the care plan. */
  suggestedDate?: string | null
}>()

const emit = defineEmits<{
  booked: [{ appointmentId: string; startsAt: string; endsAt: string }]
  close: []
}>()

const supabase = useSupabaseClient()
const authedFetch = useAuthedFetch()
const t = useT()
const { context } = usePractitionerContext()

interface TypeRow { id: string; name: string; duration_minutes: number; sort_order: number | null }
interface PractitionerRow { id: string; full_name: string; business_hours: BusinessHours | null }
interface ClinicRow { id: string; timezone: string | null; business_hours: BusinessHours | null }
interface VisitRow { starts_at: string; appointment_type_id: string | null; practitioner_id: string | null }
interface PlanRow { frequency_value: number; frequency_unit: 'week' | 'month' }
interface PatientRow { first_name: string; default_practitioner_id: string | null; clinic_id: string | null; is_minor: boolean; do_not_contact: boolean }

const loading = ref(true)
const loadError = ref('')
const patient = ref<PatientRow | null>(null)
const types = ref<TypeRow[]>([])
const allPractitioners = ref<PractitionerRow[]>([])
const overrides = ref<AppointmentTypeOverride[]>([])
const clinic = ref<ClinicRow | null>(null)
const plan = ref<PlanRow | null>(null)
const lastVisit = ref<VisitRow | null>(null)
const nextVisit = ref<VisitRow | null>(null)

const typeId = ref('')
const practitionerId = ref('')
const anchorDate = ref('')
const selectedDate = ref('')
const selectedSlot = ref<number | null>(null)
const changing = ref(false)

// calendar_scope 'own': this person sees, and may book, only their own
// diary. Offering anyone else's free times would read them through an RLS
// filter that hides that person's appointments -- every slot would look free.
const ownDiaryOnly = computed(() => !!context.value && !context.value.isOwner && context.value.permissions.calendar_scope === 'own')

const practitioners = computed(() => {
  if (!context.value) return []
  if (ownDiaryOnly.value) {
    const me = allPractitioners.value.find((p) => p.id === context.value!.teamMemberId)
    return [me ?? { id: context.value.teamMemberId, full_name: context.value.fullName, business_hours: null }]
  }
  return allPractitioners.value
})
const practitioner = computed(() => practitioners.value.find((p) => p.id === practitionerId.value) ?? null)
const type = computed(() => types.value.find((x) => x.id === typeId.value) ?? null)
const duration = computed(() => (type.value ? effectiveDuration(type.value.duration_minutes, type.value.id, practitionerId.value, overrides.value) : 30))
const timeZone = computed(() => clinic.value?.timezone || DEFAULT_CLINIC_TIMEZONE)

// Staff booking treats "no hours set anywhere" as no restriction (the web
// calendar's opt-in rule). bookingSlotsForDay needs windows to step through,
// so that case gets a plain working day, and the sheet says so.
const FALLBACK_DAY: [string, string][] = [['08:00', '20:00']]
const FALLBACK_HOURS: BusinessHours = { mon: FALLBACK_DAY, tue: FALLBACK_DAY, wed: FALLBACK_DAY, thu: FALLBACK_DAY, fri: FALLBACK_DAY, sat: FALLBACK_DAY, sun: [] }
const hoursConfigured = computed(() => hasBusinessHoursConfigured(clinic.value?.business_hours) || hasBusinessHoursConfigured(practitioner.value?.business_hours))
const clinicHours = computed<BusinessHours | null>(() => (hoursConfigured.value ? (clinic.value?.business_hours ?? null) : FALLBACK_HOURS))

function isWorkingDay(date: string) {
  return bookingWindowsFor(date, clinicHours.value, practitioner.value?.business_hours).length > 0
}

const todayKey = computed(() => clinicDateOf(new Date(), timeZone.value))

// The care plan's cadence after the visit they are next booked for, or the
// last one they had: the date care_plan_continuity_alerts would call them due.
const suggestion = computed<{ date: string; reason: string }>(() => {
  if (props.suggestedDate) return { date: props.suggestedDate, reason: '' }
  const base = nextVisit.value ?? lastVisit.value
  if (plan.value && base) {
    const from = clinicDateOf(new Date(base.starts_at), timeZone.value)
    const date = nextDueDate(plan.value, from)
    return { date: date < todayKey.value ? todayKey.value : date, reason: `${t('Care plan', 'Plan')}: ${cadenceLabel(plan.value, t)}` }
  }
  return { date: addDaysToDate(todayKey.value, 7), reason: plan.value ? `${t('Care plan', 'Plan')}: ${cadenceLabel(plan.value, t)}` : '' }
})
// What the sheet says about where the suggested day came from.
const suggestionLead = computed(() => {
  if (props.suggestedDate) return ''
  if (suggestion.value.reason) return `${suggestion.value.reason} → ${t('around', 'hacia el')} ${longDay(suggestion.value.date)}`
  return t('No care plan: a week out', 'Sin plan: dentro de una semana')
})

function firstWorkingDayFrom(date: string) {
  for (let i = 0; i < 60; i++) {
    const d = addDaysToDate(date, i)
    if (isWorkingDay(d)) return d
  }
  return date
}

// One working day before the anchor (when that is not in the past), the
// anchor, and the working days after it -- five chips. A date chosen with
// "Other date…" is kept even when nobody works that day, so the answer
// ("no free times") is on screen rather than the choice silently moving.
const dayChips = computed(() => {
  if (!anchorDate.value) return []
  const out: string[] = []
  for (let i = 1; i <= 14; i++) {
    const d = addDaysToDate(anchorDate.value, -i)
    if (d < todayKey.value) break
    if (isWorkingDay(d)) {
      out.push(d)
      break
    }
  }
  out.push(anchorDate.value)
  for (let i = 1; out.length < 5 && i <= 60; i++) {
    const d = addDaysToDate(anchorDate.value, i)
    if (isWorkingDay(d)) out.push(d)
  }
  return out
})

const locale = computed(() => t('en-GB', 'es-ES'))
function chipWeekday(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(locale.value, { weekday: 'short', timeZone: 'UTC' })
}
function chipDay(date: string) {
  return Number(date.slice(8, 10))
}
function longDay(date: string) {
  return shortDayLabel(new Date(`${date}T12:00:00Z`), locale.value, 'UTC')
}

// -- Busy time on the chosen day -------------------------------------------
const busy = ref<BookingBusyRange[]>([])
const slotsLoading = ref(false)
const slotsError = ref('')
let busyRun = 0

async function fetchBusy(fromIso: string, toIso: string, practId: string) {
  if (!clinic.value) return { appts: [] as ClashCandidateAppointment[], blocks: [] as ClashCandidateBlock[], error: null as string | null }
  // By practitioner across the account, not the clinic: someone who works at
  // two clinics is still one person (useMoveClashCheck).
  const [appts, blocks] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, starts_at, ends_at, practitioner_id, room_id, status, deleted_at, patients(first_name, last_name)')
      .eq('practitioner_id', practId)
      .neq('status', 'cancelled')
      .is('deleted_at', null)
      .lt('starts_at', toIso)
      .gt('ends_at', fromIso),
    supabase.from('availability_blocks').select('starts_at, ends_at, practitioner_id, room_id, note').eq('clinic_id', clinic.value.id).lt('starts_at', toIso).gt('ends_at', fromIso),
  ])
  return {
    appts: (appts.data as unknown as ClashCandidateAppointment[] | null) ?? [],
    blocks: (blocks.data as ClashCandidateBlock[] | null) ?? [],
    error: appts.error?.message ?? blocks.error?.message ?? null,
  }
}

async function loadBusy() {
  if (!selectedDate.value || !practitionerId.value || !clinic.value) return
  const run = ++busyRun
  slotsLoading.value = true
  slotsError.value = ''
  const from = startOfLocalDate(selectedDate.value, timeZone.value).toISOString()
  const to = startOfLocalDate(nextDate(selectedDate.value), timeZone.value).toISOString()
  const { appts, blocks, error } = await fetchBusy(from, to, practitionerId.value)
  if (run !== busyRun) return
  if (error) slotsError.value = t('Could not load the free times.', 'No se han podido cargar las horas libres.')
  busy.value = [
    ...appts,
    // A block for this practitioner, or one naming nobody (the whole clinic).
    // A room's own block does not close the practitioner's diary.
    ...blocks.filter((b) => b.practitioner_id === practitionerId.value || (b.practitioner_id === null && b.room_id === null)),
  ]
  slotsLoading.value = false
}

const slots = computed(() => {
  if (!selectedDate.value || !practitionerId.value) return []
  return bookingSlotsForDay({
    date: selectedDate.value,
    timeZone: timeZone.value,
    clinicHours: clinicHours.value,
    practitionerHours: practitioner.value?.business_hours,
    durationMinutes: duration.value,
    busy: busy.value,
  })
})

// The time of day they usually come, preselected when it is free that day --
// most patients keep their slot.
const usualTime = computed(() => {
  const visit = nextVisit.value ?? lastVisit.value
  return visit ? clinicTimeLabel(new Date(visit.starts_at), timeZone.value) : null
})
watch(slots, (list) => {
  if (selectedSlot.value !== null && list.some((s) => s.getTime() === selectedSlot.value)) return
  const usual = usualTime.value ? list.find((s) => clinicTimeLabel(s, timeZone.value) === usualTime.value) : undefined
  selectedSlot.value = usual ? usual.getTime() : null
})

watch([selectedDate, practitionerId], () => {
  selectedSlot.value = null
  loadBusy()
})

function pickDay(date: string) {
  selectedDate.value = date
}
function onOtherDate(e: Event) {
  const value = (e.target as HTMLInputElement).value
  if (!value) return
  anchorDate.value = value < todayKey.value ? todayKey.value : value
  selectedDate.value = anchorDate.value
}

// -- Loading what the sheet needs -------------------------------------------
async function load() {
  if (!context.value) return
  loading.value = true
  loadError.value = ''
  const nowIso = new Date().toISOString()
  const [p, ty, pr, links, ov, cl, pl, last, next] = await Promise.all([
    supabase.from('patients').select('first_name, default_practitioner_id, clinic_id, is_minor, do_not_contact').eq('id', props.patientId).maybeSingle(),
    supabase.from('appointment_types').select('id, name, duration_minutes, sort_order').is('archived_at', null).order('sort_order', { nullsFirst: false }).order('name'),
    supabase.from('team_members').select('id, full_name, business_hours').is('deleted_at', null).eq('is_practitioner', true).order('full_name'),
    supabase.from('team_member_clinics').select('team_member_id, clinic_id'),
    supabase.from('appointment_type_overrides').select('appointment_type_id, team_member_id, duration_minutes, price_cents'),
    supabase.from('clinics').select('id, timezone, business_hours').is('archived_at', null).order('name'),
    supabase.from('care_plans').select('frequency_value, frequency_unit').eq('patient_id', props.patientId).order('created_at', { ascending: false }).limit(1),
    supabase
      .from('appointments')
      .select('starts_at, appointment_type_id, practitioner_id')
      .eq('patient_id', props.patientId)
      .eq('status', 'completed')
      .is('deleted_at', null)
      .order('starts_at', { ascending: false })
      .limit(1),
    supabase
      .from('appointments')
      .select('starts_at, appointment_type_id, practitioner_id')
      .eq('patient_id', props.patientId)
      .eq('status', 'booked')
      .is('deleted_at', null)
      .gt('starts_at', nowIso)
      .order('starts_at', { ascending: false })
      .limit(1),
  ])
  const failed = [p, ty, pr, cl].find((r) => r.error)
  if (failed || !p.data) {
    loadError.value = failed?.error?.message ?? t('Patient not found.', 'Paciente no encontrado.')
    loading.value = false
    return
  }
  patient.value = p.data as PatientRow
  types.value = (ty.data as TypeRow[]) ?? []
  overrides.value = (ov.data as AppointmentTypeOverride[]) ?? []
  plan.value = ((pl.data as PlanRow[]) ?? [])[0] ?? null
  lastVisit.value = ((last.data as VisitRow[]) ?? [])[0] ?? null
  nextVisit.value = ((next.data as VisitRow[]) ?? [])[0] ?? null

  const clinics = (cl.data as ClinicRow[]) ?? []
  clinic.value = clinics.find((c) => c.id === patient.value!.clinic_id) ?? clinics.find((c) => c.id === context.value!.clinicId) ?? clinics[0] ?? null

  // The practitioners who work at this clinic, when the clinic has any linked.
  const linked = new Set(((links.data as { team_member_id: string; clinic_id: string }[]) ?? []).filter((l) => l.clinic_id === clinic.value?.id).map((l) => l.team_member_id))
  const everyone = (pr.data as PractitionerRow[]) ?? []
  allPractitioners.value = linked.size > 0 ? everyone.filter((m) => linked.has(m.id)) : everyone

  const candidates = [props.practitionerId, patient.value.default_practitioner_id, lastVisit.value?.practitioner_id, context.value.teamMemberId]
  practitionerId.value = candidates.find((id) => id && practitioners.value.some((m) => m.id === id)) ?? practitioners.value[0]?.id ?? ''

  const typeCandidates = [props.typeId, lastVisit.value?.appointment_type_id, nextVisit.value?.appointment_type_id]
  typeId.value = typeCandidates.find((id) => id && types.value.some((x) => x.id === id)) ?? types.value[0]?.id ?? ''

  anchorDate.value = firstWorkingDayFrom(suggestion.value.date)
  selectedDate.value = anchorDate.value
  loading.value = false
}
watch(() => context.value?.teamMemberId, (id) => id && load(), { immediate: true })

// -- Booking -----------------------------------------------------------------
const booking = ref(false)
const bookError = ref('')

const selectedStart = computed(() => (selectedSlot.value === null ? null : new Date(selectedSlot.value)))
const ctaLabel = computed(() => {
  if (booking.value) return t('Booking…', 'Reservando…')
  if (!selectedStart.value) return t('Pick a time', 'Elige una hora')
  return `${t('Book', 'Reservar')} ${longDay(selectedDate.value)}, ${clinicTimeLabel(selectedStart.value, timeZone.value)}`
})

async function book() {
  if (!selectedStart.value || !context.value || !clinic.value || booking.value) return
  bookError.value = ''
  booking.value = true
  try {
    const start = selectedStart.value
    const end = new Date(start.getTime() + duration.value * 60000)
    // Asked again now: someone at the desk may have taken the time since the
    // slots were drawn.
    const fresh = await fetchBusy(start.toISOString(), end.toISOString(), practitionerId.value)
    const clashes = moveClashes({ appointmentId: '', practitionerId: practitionerId.value, roomId: null, startsAt: start, endsAt: end }, fresh.appts, fresh.blocks)
    if (clashes.length > 0) {
      bookError.value = t('That time has just been taken. Pick another.', 'Esa hora se acaba de ocupar. Elige otra.')
      await loadBusy()
      return
    }
    const { data: created, error } = await supabase
      .from('appointments')
      .insert({
        account_id: context.value.accountId,
        clinic_id: clinic.value.id,
        patient_id: props.patientId,
        practitioner_id: practitionerId.value || null,
        appointment_type_id: typeId.value || null,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        status: 'booked',
        source: 'staff',
      } as never)
      .select('id')
      .single()
    if (error || !created) {
      bookError.value = error?.message ?? t('Could not book the visit.', 'No se ha podido reservar la cita.')
      return
    }
    const appointmentId = (created as { id: string }).id
    // As the web's staff booking does, both fire-and-forget: the visit is
    // booked whatever happens to them. Through authedFetch, which reaches the
    // deployed API from inside the app (a relative /api/ call goes nowhere
    // there). No confirmation to a minor or a do-not-contact patient, whom
    // nothing messages.
    authedFetch('/api/automations/fire', { method: 'POST', body: { triggerEvent: 'appointment.booked', patientId: props.patientId, appointmentId } }).catch(() => {})
    if (!patient.value?.is_minor && !patient.value?.do_not_contact) {
      authedFetch('/api/appointments/send-confirmation', { method: 'POST', body: { appointmentId } }).catch(() => {})
    }
    emit('booked', { appointmentId, startsAt: start.toISOString(), endsAt: end.toISOString() })
  } finally {
    booking.value = false
  }
}
</script>


<template>
  <div class="fixed inset-0 z-50 flex flex-col justify-end bg-ink-900/40" data-cy="book-visit-sheet" @click.self="emit('close')">
    <div
      class="flex max-h-[92%] flex-col gap-3 overflow-y-auto rounded-t-[22px] bg-surface px-4 pt-2.5 shadow-popover"
      style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)"
      role="dialog"
      aria-modal="true"
      :aria-label="t('Book the next visit', 'Reservar la próxima cita')"
    >
      <div class="mx-auto mb-0.5 h-1 w-[38px] shrink-0 rounded-full bg-line-control" />
      <slot name="header" />

      <template v-if="loading">
        <UiSkeleton class="h-[58px] w-full rounded-card" />
        <div class="flex gap-1.5"><UiSkeleton v-for="i in 5" :key="i" class="h-[50px] flex-1 rounded-card" /></div>
        <div class="grid grid-cols-4 gap-1.5"><UiSkeleton v-for="i in 8" :key="i" class="h-[38px] rounded-ctl" /></div>
      </template>

      <p v-else-if="loadError" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text">{{ loadError }}</p>

      <p v-else-if="practitioners.length === 0 || types.length === 0" class="rounded-card border border-line bg-surface-page px-3.5 py-3 text-[13.5px] text-ink-muted">
        {{ practitioners.length === 0 ? t('No practitioner to book with at this clinic.', 'No hay ningún profesional con quien reservar en esta clínica.') : t('No appointment types set up yet.', 'Aún no hay tipos de cita.') }}
      </p>

      <template v-else>
        <div class="rounded-card border border-line bg-surface-page px-3.5 py-2.5">
          <p class="text-[14px] font-semibold text-ink-900">{{ t('Book the next visit', 'Reservar la próxima cita') }}</p>
          <p class="mt-0.5 text-[12.5px] leading-snug text-ink-muted2" data-cy="book-visit-context">
            <template v-if="suggestionLead">{{ suggestionLead }} · </template>
            {{ type?.name }} {{ duration }} min, {{ practitioner?.full_name }}
            <button type="button" class="ml-1 font-medium text-brand-text" @click="changing = !changing">{{ changing ? t('Done', 'Listo') : t('Change', 'Cambiar') }}</button>
          </p>
          <div v-if="changing" class="mt-2.5 grid gap-2" :class="ownDiaryOnly ? 'grid-cols-1' : 'grid-cols-2'">
            <select v-model="typeId" class="h-11 min-w-0 rounded-ctl border border-line-control bg-surface px-2.5 text-[14px] text-ink-700" :aria-label="t('Type', 'Tipo')">
              <option v-for="x in types" :key="x.id" :value="x.id">{{ x.name }}</option>
            </select>
            <select v-if="!ownDiaryOnly" v-model="practitionerId" class="h-11 min-w-0 rounded-ctl border border-line-control bg-surface px-2.5 text-[14px] text-ink-700" :aria-label="t('Practitioner', 'Profesional')">
              <option v-for="m in practitioners" :key="m.id" :value="m.id">{{ m.full_name }}</option>
            </select>
          </div>
        </div>

        <div class="flex gap-1.5" role="listbox" :aria-label="t('Day', 'Día')">
          <button
            v-for="d in dayChips"
            :key="d"
            type="button"
            role="option"
            :aria-selected="d === selectedDate"
            class="flex-1 rounded-card py-1.5 text-center"
            :class="d === selectedDate ? 'border-[1.5px] border-brand bg-brand-tint' : 'border border-line-control bg-surface'"
            :data-cy="`book-day-${d}`"
            @click="pickDay(d)"
          >
            <span class="block text-[12px] capitalize text-ink-muted2">{{ chipWeekday(d) }}</span>
            <span class="block text-[15px] font-semibold text-ink-900">{{ chipDay(d) }}</span>
          </button>
        </div>

        <div class="min-h-[86px]">
          <div v-if="slotsLoading" class="grid grid-cols-4 gap-1.5"><UiSkeleton v-for="i in 8" :key="i" class="h-[38px] rounded-ctl" /></div>
          <p v-else-if="slotsError" class="text-[13px] text-danger-text">{{ slotsError }}</p>
          <p v-else-if="slots.length === 0" class="py-3 text-center text-[13px] text-ink-muted">
            {{ isWorkingDay(selectedDate) ? t('No free times left on this day.', 'No quedan horas libres este día.') : t(`${practitioner?.full_name ?? 'They'} doesn't work this day.`, `${practitioner?.full_name ?? 'No'} no trabaja este día.`) }}
          </p>
          <div v-else class="grid grid-cols-4 gap-1.5">
            <button
              v-for="s in slots"
              :key="s.getTime()"
              type="button"
              class="h-[38px] rounded-ctl text-[14px] tabular-nums"
              :class="selectedSlot === s.getTime() ? 'bg-brand font-semibold text-white' : 'border border-line-control bg-surface text-ink-700'"
              :data-cy="`book-slot-${clinicTimeLabel(s, timeZone)}`"
              @click="selectedSlot = s.getTime()"
            >
              {{ clinicTimeLabel(s, timeZone) }}
            </button>
          </div>
          <p v-if="!hoursConfigured" class="mt-2 text-[11.5px] text-ink-faint">{{ t('No working hours set up, so 08:00–20:00 is shown.', 'No hay horario configurado; se muestra de 08:00 a 20:00.') }}</p>
        </div>

        <p v-if="bookError" class="text-[13px] text-danger-text" data-cy="book-visit-error">{{ bookError }}</p>

        <button
          type="button"
          class="flex h-11 items-center justify-center rounded-[12px] bg-brand text-[15px] font-semibold text-white disabled:opacity-50"
          :disabled="!selectedStart || booking"
          data-cy="book-visit-confirm"
          @click="book"
        >
          {{ ctaLabel }}
        </button>
      </template>

      <div class="flex items-center justify-center gap-5 pb-1">
        <label v-if="!loading && !loadError" class="relative text-[13.5px] font-medium text-brand-text">
          {{ t('Other date…', 'Otra fecha…') }}
          <input type="date" :min="todayKey" class="absolute inset-0 h-full w-full cursor-pointer opacity-0" data-cy="book-other-date" @change="onOtherDate" />
        </label>
        <button type="button" class="py-2 text-[13.5px] text-ink-muted" @click="emit('close')">{{ t('Not now', 'Ahora no') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Booking for an already-signed-in patient -- same slot-computation logic as
// pages/book/[slug].vue (the public/anonymous flow), but backed by
// get_patient_booking_info/create_patient_booking, which resolve the patient
// via auth.uid() server-side and skip contact capture entirely.

interface BookingClinic {
  id: string
  name: string
  address: string | null
  business_hours: Record<string, [string, string][]>
  /** The zone business_hours are written in. Absent before 20260930141539. */
  timezone?: string | null
}
interface BookingAppointmentType {
  id: string
  name: string
  duration_minutes: number
  color: string
  default_price_cents: number
  /** This type's booking horizon; null means the clinic's (settings.max_days_ahead). */
  online_max_days_ahead: number | null
  /**
   * "Patient doesn't choose a practitioner": booked with the first practitioner
   * listed for the clinic, as on the web page. Absent before 20260925181500.
   */
  online_bypass_practitioner?: boolean
}
// Types that are paid online when booked. The app cannot take that payment,
// so create_patient_booking refuses them and they come separately, only so
// this page can say why they are missing and where they can be booked.
interface OnlinePaymentType {
  id: string
  name: string
  default_price_cents: number
  online_deposit_cents: number | null
}
interface BookingTeamMember {
  id: string
  full_name: string
  color: string
  clinic_ids: string[]
  /**
   * Their own week, which decides their slots when set (practitionerWindowsForDay).
   * Absent before 20260930141539, when the clinic's hours were all the app had.
   */
  business_hours?: Record<string, [string, string][]> | null
}
interface BookingInfo {
  settings: { max_days_ahead: number | null; booking_slug: string | null; change_notice_hours?: number | null } | null
  clinics: BookingClinic[]
  appointment_types: BookingAppointmentType[]
  team_members: BookingTeamMember[]
  overrides: AppointmentTypeOverride[]
  // Absent from get_patient_booking_info before 20260925161500.
  online_payment_types?: OnlinePaymentType[]
}
// The appointment being moved, when this page is reached as
// /book?reschedule=<id>. reschedule_patient_appointment keeps its clinic,
// practitioner and length and only changes the time, so the slots offered are
// that practitioner's, at that length, within its own type's horizon.
interface RescheduleTarget {
  id: string
  clinic_id: string
  practitioner_id: string
  starts_at: string
  ends_at: string
  appointment_types: { name: string; online_max_days_ahead: number | null } | null
  team_members: { full_name: string } | null
}

const supabase = useSupabaseClient()
const t = useT()
const locale = computed(() => t('en-GB', 'es-ES'))

// Reached as /book?reschedule=<id> from the visits screen. The slot picker is
// identical either way -- only the RPC at the end differs -- so this reuses
// the whole flow rather than duplicating an availability calendar somewhere
// else.
const route = useRoute()
const rescheduleId = computed(() => (typeof route.query.reschedule === 'string' ? route.query.reschedule : null))
const rescheduleTarget = ref<RescheduleTarget | null>(null)

const phase = ref<'loading' | 'not_available' | 'select' | 'datetime' | 'confirm' | 'success'>('loading')

const info = ref<BookingInfo | null>(null)
const clinicId = ref('')
const appointmentTypeId = ref('')
const teamMemberId = ref('')

const clinic = computed(() => info.value?.clinics.find((c) => c.id === clinicId.value) ?? null)
const appointmentType = computed(() => info.value?.appointment_types.find((t) => t.id === appointmentTypeId.value) ?? null)
const teamMember = computed(() => info.value?.team_members.find((m) => m.id === teamMemberId.value) ?? null)
const availablePractitioners = computed(() => (info.value?.team_members ?? []).filter((m) => m.clinic_ids.includes(clinicId.value)))
// The practitioner whose calendar the slots come from. When moving an
// appointment it is the appointment's own, which may not be listed for new
// bookings -- then their hours are unknown here and the clinic's stand in;
// reschedule_patient_appointment checks the real ones.
const slotPractitioner = computed(() => info.value?.team_members.find((m) => m.id === teamMemberId.value) ?? null)
// Every time here is the clinic's, as on the web page. Slots used to be built
// with setHours, in the PHONE's zone, so a patient whose phone was set to
// another zone was offered the clinic's hours shifted by the difference.
const clinicTimeZone = computed(() => clinic.value?.timezone || DEFAULT_CLINIC_TIMEZONE)

const effectiveDurationMinutes = computed(() =>
  rescheduleTarget.value
    ? Math.round((new Date(rescheduleTarget.value.ends_at).getTime() - new Date(rescheduleTarget.value.starts_at).getTime()) / 60000)
    : appointmentType.value
    ? effectiveDuration(appointmentType.value.duration_minutes, appointmentTypeId.value, teamMemberId.value, info.value?.overrides ?? [])
    : 0,
)
const effectivePrice = computed(() =>
  appointmentType.value
    ? effectivePriceCents(appointmentType.value.default_price_cents, appointmentTypeId.value, teamMemberId.value, info.value?.overrides ?? [])
    : 0,
)

function formatPrice(cents: number) {
  return (cents / 100).toLocaleString(locale.value, { style: 'currency', currency: 'EUR' })
}

// "Patient doesn't choose a practitioner" -- pages/book/[slug].vue shows no
// practitioner choice for such a type and books the first practitioner who
// works at the clinic. The list comes in the web page's order, and
// create_patient_booking refuses anyone else for this type.
const bypassPractitioner = computed(() => !!appointmentType.value?.online_bypass_practitioner)
watch(appointmentTypeId, () => {
  if (bypassPractitioner.value) teamMemberId.value = availablePractitioners.value[0]?.id ?? ''
})

const onlinePaymentTypes = computed(() => info.value?.online_payment_types ?? [])
// The public booking page, which takes the payment these types need.
const config = useRuntimeConfig()
const webBookingUrl = computed(() => {
  const slug = info.value?.settings?.booking_slug
  return slug ? `${config.public.apiBase}/book/${encodeURIComponent(slug)}` : null
})

onMounted(async () => {
  const { data, error } = await supabase.rpc('get_patient_booking_info')
  if (error || !data) {
    phase.value = 'not_available'
    return
  }
  const parsed = data as unknown as BookingInfo
  if (parsed.clinics.length === 0) {
    phase.value = 'not_available'
    return
  }
  info.value = parsed

  if (rescheduleId.value) {
    await startReschedule(parsed)
    return
  }

  clinicId.value = parsed.clinics[0].id
  if (parsed.appointment_types.length === 1) appointmentTypeId.value = parsed.appointment_types[0].id
  const forClinic = parsed.team_members.filter((m) => m.clinic_ids.includes(clinicId.value))
  if (forClinic.length === 1 || bypassPractitioner.value) teamMemberId.value = forClinic[0]?.id ?? ''
  phase.value = 'select'
})

function onClinicChange() {
  teamMemberId.value = availablePractitioners.value.length === 1 || bypassPractitioner.value ? (availablePractitioners.value[0]?.id ?? '') : ''
}

// Moving an appointment: there is nothing to choose but the time, so this
// goes straight to the calendar with the appointment's own clinic and
// practitioner. Its clinic has to be one the app books at, for its hours.
async function startReschedule(parsed: BookingInfo) {
  const { data } = await supabase
    .from('appointments')
    .select('id, clinic_id, practitioner_id, starts_at, ends_at, appointment_types(name, online_max_days_ahead), team_members(full_name)')
    .eq('id', rescheduleId.value!)
    .maybeSingle()
  const target = data as unknown as RescheduleTarget | null
  if (!target || !parsed.clinics.some((c) => c.id === target.clinic_id)) {
    phase.value = 'not_available'
    return
  }
  rescheduleTarget.value = target
  clinicId.value = target.clinic_id
  teamMemberId.value = target.practitioner_id
  phase.value = 'datetime'
}

const canContinueFromSelect = computed(() => !!clinicId.value && !!appointmentTypeId.value && !!teamMemberId.value)

// --- date/time ---
const viewMonth = ref(startOfMonth(new Date()))
const selectedDate = ref<Date | null>(null)
const selectedSlot = ref<Date | null>(null)
// The practitioner's appointments and the blocks that apply to them (their
// own, and whole-clinic closures), for the selected day.
const busyRanges = ref<{ starts_at: string; ends_at: string }[]>([])
const slotsLoading = ref(false)

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

const monthLabel = computed(() => viewMonth.value.toLocaleDateString(locale.value, { month: 'long', year: 'numeric' }))

// How far ahead this type can be booked: its own limit, else the clinic's --
// the same fallback pages/book/[slug].vue uses, and the one
// create_patient_booking enforces (start time no later than now + that many
// days). reschedule_patient_appointment applies the same limit to a move,
// from the appointment's own type.
const typeMaxDaysAhead = computed(() =>
  rescheduleTarget.value ? (rescheduleTarget.value.appointment_types?.online_max_days_ahead ?? null) : (appointmentType.value?.online_max_days_ahead ?? null),
)
const maxDaysAhead = computed(() => typeMaxDaysAhead.value ?? info.value?.settings?.max_days_ahead ?? 90)
const typeName = computed(() => rescheduleTarget.value?.appointment_types?.name ?? appointmentType.value?.name ?? '')
const practitionerName = computed(() => rescheduleTarget.value?.team_members?.full_name ?? teamMember.value?.full_name ?? '')
const latestStart = computed(() => new Date(Date.now() + maxDaysAhead.value * 86400000))
// Calendar cells compared as the clinic's dates.
const clinicToday = computed(() => clinicDateOf(new Date(), clinicTimeZone.value))
const lastBookableDate = computed(() => clinicDateOf(latestStart.value, clinicTimeZone.value))
// reschedule_patient_appointment refuses a new time inside the clinic's
// change notice ("Please choose a time further ahead"), and this page offered
// those times all the same. The earliest start it will take, when moving.
const earliestStart = computed(() =>
  rescheduleTarget.value ? new Date(Date.now() + (info.value?.settings?.change_notice_hours ?? 0) * 3600000) : new Date(),
)
const lastBookableDay = computed(() => {
  const d = new Date(latestStart.value)
  d.setHours(23, 59, 59, 999)
  return d
})
const canGoToNextMonth = computed(() => {
  const next = new Date(viewMonth.value.getFullYear(), viewMonth.value.getMonth() + 1, 1)
  return next <= lastBookableDay.value
})
const canGoToPrevMonth = computed(() => viewMonth.value > startOfMonth(new Date()))

const calendarDays = computed(() => {
  const first = viewMonth.value
  const firstWeekday = (first.getDay() + 6) % 7 // Monday = 0
  const gridStart = new Date(first)
  gridStart.setDate(first.getDate() - firstWeekday)
  const days: { date: Date; inMonth: boolean; bookable: boolean }[] = []
  for (let i = 0; i < 42; i++) {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + i)
    const key = calendarDateKey(date)
    days.push({
      date,
      inMonth: date.getMonth() === first.getMonth(),
      bookable: dayHasHours(date) && key >= clinicToday.value && key <= lastBookableDate.value,
    })
  }
  return days
})

// The practitioner's own week when they have one, the clinic's otherwise --
// the web page's rule. The clinic's alone offered a practitioner's days off.
function dayHasHours(date: Date) {
  const hours = clinic.value?.business_hours
  if (!hours) return false
  return bookingWindowsFor(calendarDateKey(date), hours, slotPractitioner.value?.business_hours).length > 0
}

function prevMonth() {
  if (!canGoToPrevMonth.value) return
  viewMonth.value = new Date(viewMonth.value.getFullYear(), viewMonth.value.getMonth() - 1, 1)
}
function nextMonth() {
  if (!canGoToNextMonth.value) return
  viewMonth.value = new Date(viewMonth.value.getFullYear(), viewMonth.value.getMonth() + 1, 1)
}

async function selectDate(day: { date: Date; bookable: boolean }) {
  if (!day.bookable) return
  selectedDate.value = day.date
  selectedSlot.value = null
  slotsLoading.value = true
  // A day either side of the phone's day: the clinic's day can start or end
  // outside it when the two zones differ.
  const from = new Date(day.date.getTime() - 86400000).toISOString()
  const to = new Date(day.date.getTime() + 2 * 86400000).toISOString()
  const [{ data }, { data: blocked }] = await Promise.all([
    supabase.rpc('get_booking_busy_times', {
      p_clinic_id: clinicId.value,
      p_team_member_id: teamMemberId.value,
      p_from: from,
      p_to: to,
    }),
    // Closures and time blocked off, which the app never asked for: a bank
    // holiday or a practitioner's afternoon off was offered like any other.
    // One naming nobody closes the clinic for everyone, as on the web page.
    supabase.rpc('get_booking_blocked_times', { p_clinic_id: clinicId.value, p_from: from, p_to: to }),
  ])
  // The appointment being moved is busy time on this practitioner's
  // calendar, but not in its own way: reschedule_patient_appointment skips it.
  const appointments = ((data as { starts_at: string; ends_at: string }[]) ?? []).filter(
    (b) => !rescheduleTarget.value || new Date(b.starts_at).getTime() !== new Date(rescheduleTarget.value.starts_at).getTime() || new Date(b.ends_at).getTime() !== new Date(rescheduleTarget.value.ends_at).getTime(),
  )
  const blocks = ((blocked as { starts_at: string; ends_at: string; practitioner_id: string | null }[]) ?? []).filter(
    (b) => b.practitioner_id === null || b.practitioner_id === teamMemberId.value,
  )
  busyRanges.value = [...appointments, ...blocks]
  slotsLoading.value = false
}

// Built as the web page builds them (utils/bookingSlots.ts).
const daySlots = computed(() => {
  if (!selectedDate.value || effectiveDurationMinutes.value <= 0) return []
  return bookingSlotsForDay({
    date: calendarDateKey(selectedDate.value),
    timeZone: clinicTimeZone.value,
    clinicHours: clinic.value?.business_hours,
    practitionerHours: slotPractitioner.value?.business_hours,
    durationMinutes: effectiveDurationMinutes.value,
    busy: busyRanges.value,
    notBefore: earliestStart.value,
    notAfter: latestStart.value,
  })
})

function pickSlot(slot: Date) {
  selectedSlot.value = slot
  phase.value = 'confirm'
}

// --- confirm + submit ---
const note = ref('')
const submitting = ref(false)
const submitError = ref('')
const confirmation = ref<{ starts_at: string } | null>(null)


async function submitBooking() {
  if (!selectedSlot.value) return
  submitError.value = ''
  submitting.value = true

  if (rescheduleId.value) {
    const { data, error } = await supabase.rpc('reschedule_patient_appointment', {
      p_appointment_id: rescheduleId.value,
      p_starts_at: selectedSlot.value.toISOString(),
    })
    submitting.value = false
    if (error) {
      submitError.value = bookingErrorMessage(error.message, t)
      return
    }
    confirmation.value = data as unknown as { starts_at: string }
    phase.value = 'success'
    return
  }

  const { data, error } = await supabase.rpc('create_patient_booking', {
    p_clinic_id: clinicId.value,
    p_team_member_id: teamMemberId.value,
    p_appointment_type_id: appointmentTypeId.value,
    p_starts_at: selectedSlot.value.toISOString(),
    p_note: note.value,
  })
  submitting.value = false
  if (error) {
    submitError.value = bookingErrorMessage(error.message, t)
    return
  }
  confirmation.value = data as unknown as { starts_at: string }
  phase.value = 'success'
}
</script>

<template>
  <div class="flex h-full flex-col p-4">
    <div class="mb-4 flex items-center gap-2">
      <NuxtLink to="/" class="text-[13px] font-medium text-brand-text">&larr; {{ t('Back', 'Atrás') }}</NuxtLink>
      <h1 class="ml-auto text-[15px] font-semibold text-ink-900">{{ t('New appointment', 'Nueva cita') }}</h1>
    </div>

    <div v-if="phase === 'loading'" class="flex flex-1 items-center justify-center text-sm text-ink-faint">{{ t('Loading…', 'Cargando…') }}</div>
    <div v-else-if="phase === 'not_available'" class="flex flex-1 items-center justify-center px-6 text-center text-sm text-ink-muted">
      <template v-if="rescheduleId">{{ t("This appointment can't be moved from the app — please contact the clinic.", 'Esta cita no se puede cambiar desde la app: contacta con la clínica.') }}</template>
      <template v-else>{{ t("Online booking isn't available for your clinic right now — please contact them directly.", 'Ahora mismo tu clínica no tiene disponible la reserva online: contacta directamente con ella.') }}</template>
    </div>

    <div v-else-if="phase === 'select'" class="space-y-4">
      <div v-if="info!.clinics.length > 1">
        <label class="block text-[12.5px] font-medium text-ink-700">{{ t('Clinic', 'Clínica') }}</label>
        <select v-model="clinicId" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-[13.5px]" @change="onClinicChange">
          <option v-for="c in info!.clinics" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>

      <div>
        <label class="block text-[12.5px] font-medium text-ink-700">{{ t('Appointment type', 'Tipo de cita') }}</label>
        <select v-if="info!.appointment_types.length > 0" v-model="appointmentTypeId" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-[13.5px]">
          <option v-for="type in info!.appointment_types" :key="type.id" :value="type.id">{{ type.name }} ({{ type.duration_minutes }} min)</option>
        </select>
        <p v-else class="mt-1 text-[12.5px] text-ink-muted">{{ t("None of this clinic's appointments can be booked from the app.", 'Ninguna de las citas de esta clínica se puede reservar desde la app.') }}</p>
      </div>

      <!-- Types the clinic takes payment for when they are booked. The app
           cannot take a payment, so the server refuses them here; the web
           booking page can. -->
      <div v-if="onlinePaymentTypes.length > 0" class="rounded-card border border-line bg-surface-subtle p-3 text-[12.5px] text-ink-muted">
        <p>
          {{ t("These appointments are paid online when you book them, which the app can't do yet:", 'Estas citas se pagan online al reservarlas, y la app todavía no puede hacerlo:') }}
        </p>
        <ul class="mt-1 list-disc pl-4">
          <li v-for="type in onlinePaymentTypes" :key="type.id">
            {{ type.name }}<template v-if="type.online_deposit_cents"> ({{ t(`${formatPrice(type.online_deposit_cents)} deposit`, `${formatPrice(type.online_deposit_cents)} de señal`) }})</template>
          </li>
        </ul>
        <p class="mt-1">
          <template v-if="webBookingUrl">
            {{ t('Book them on the', 'Resérvalas en la') }}
            <a :href="webBookingUrl" target="_blank" rel="noopener" class="font-medium text-brand-text">{{ t("clinic's booking page", 'página de reservas de la clínica') }}</a>
            {{ t('or contact the clinic.', 'o contacta con la clínica.') }}
          </template>
          <template v-else>{{ t('Contact the clinic to book them.', 'Contacta con la clínica para reservarlas.') }}</template>
        </p>
      </div>

      <!-- As on the web page: a type the clinic assigns the practitioner for
           offers no choice. -->
      <div v-if="!bypassPractitioner">
        <label class="block text-[12.5px] font-medium text-ink-700">{{ t('Practitioner', 'Profesional') }}</label>
        <select v-model="teamMemberId" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-[13.5px]">
          <option v-for="m in availablePractitioners" :key="m.id" :value="m.id">{{ m.full_name }}</option>
        </select>
      </div>
      <p v-else-if="!teamMemberId" class="text-[12.5px] text-ink-muted">{{ t('No practitioner can be booked for this at this clinic.', 'En esta clínica no hay ningún profesional con quien reservar esto.') }}</p>

      <UiBtn variant="primary" class="w-full" :disabled="!canContinueFromSelect" @click="phase = 'datetime'">{{ t('Continue', 'Continuar') }}</UiBtn>
    </div>

    <div v-else-if="phase === 'datetime'" class="space-y-4">
      <div class="flex items-center justify-between">
        <button type="button" class="px-2 text-[13px] text-ink-muted disabled:opacity-30" :disabled="!canGoToPrevMonth" :aria-label="t('Previous month', 'Mes anterior')" @click="prevMonth">&lsaquo;</button>
        <p class="text-[13.5px] font-medium text-ink-900 first-letter:uppercase">{{ monthLabel }}</p>
        <button type="button" class="px-2 text-[13px] text-ink-muted disabled:opacity-30" :disabled="!canGoToNextMonth" :aria-label="t('Next month', 'Mes siguiente')" @click="nextMonth">&rsaquo;</button>
      </div>
      <p class="text-[12px] text-ink-faint">
        {{
          rescheduleTarget
            ? t(`${typeName} can be moved up to ${maxDaysAhead} days ahead.`, `${typeName} se puede mover a una fecha de hasta ${maxDaysAhead} días vista.`)
            : t(`${typeName} can be booked up to ${maxDaysAhead} days ahead.`, `${typeName} se puede reservar con hasta ${maxDaysAhead} días de antelación.`)
        }}
      </p>
      <div class="grid grid-cols-7 gap-1 text-center text-[12px]">
        <button
          v-for="day in calendarDays"
          :key="day.date.toISOString()"
          type="button"
          class="aspect-square rounded-ctl"
          :class="[
            !day.inMonth ? 'text-ink-faint2' : day.bookable ? 'text-ink-900' : 'text-ink-faint',
            selectedDate && isSameDay(day.date, selectedDate) ? 'bg-brand text-white' : day.bookable ? 'hover:bg-surface-subtle' : '',
          ]"
          :disabled="!day.bookable"
          @click="selectDate(day)"
        >
          {{ day.date.getDate() }}
        </button>
      </div>

      <div v-if="selectedDate">
        <div v-if="slotsLoading" class="text-[13px] text-ink-faint">{{ t('Loading times…', 'Cargando horas…') }}</div>
        <div v-else-if="daySlots.length === 0" class="text-[13px] text-ink-faint">{{ t('No times available this day.', 'No hay horas disponibles este día.') }}</div>
        <div v-else class="grid grid-cols-3 gap-2">
          <button
            v-for="slot in daySlots"
            :key="slot.toISOString()"
            type="button"
            class="rounded-ctl border border-line-control py-2 text-[12.5px] text-ink-700 hover:border-brand hover:text-brand-text"
            @click="pickSlot(slot)"
          >
            {{ slot.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: clinicTimeZone }) }}
          </button>
        </div>
      </div>
    </div>

    <div v-else-if="phase === 'confirm'" class="space-y-4">
      <div class="rounded-card border border-line bg-surface p-4">
        <p class="text-[13.5px] font-medium text-ink-900">{{ typeName }}</p>
        <p v-if="practitionerName" class="mt-1 text-[12.5px] text-ink-muted">{{ t('with', 'con') }} {{ practitionerName }}</p>
        <p class="mt-1 text-[12.5px] text-ink-muted first-letter:uppercase">{{ selectedSlot?.toLocaleString(locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: clinicTimeZone }) }}</p>
        <p v-if="appointmentType && !rescheduleTarget" class="mt-1 text-[12.5px] text-ink-muted">{{ formatPrice(effectivePrice) }}</p>
      </div>
      <!-- The reschedule RPC moves the existing appointment and takes no
           note, so asking for one here would quietly discard it. -->
      <div v-if="!rescheduleId">
        <label class="block text-[12.5px] font-medium text-ink-700">{{ t('Note (optional)', 'Nota (opcional)') }}</label>
        <textarea v-model="note" rows="3" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-[13.5px]" />
      </div>
      <p v-else class="text-[12.5px] text-ink-muted">{{ t('This will move your existing appointment to the time above.', 'Tu cita actual se moverá a la hora de arriba.') }}</p>
      <p v-if="submitError" class="text-[12.5px] text-danger-text">{{ submitError }}</p>
      <UiBtn variant="primary" class="w-full" :disabled="submitting" @click="submitBooking">{{ submitting ? t('Booking…', 'Reservando…') : t('Confirm booking', 'Confirmar reserva') }}</UiBtn>
      <button type="button" class="w-full text-center text-[12.5px] text-ink-muted" @click="phase = 'datetime'">&larr; {{ t('Choose a different time', 'Elegir otra hora') }}</button>
    </div>

    <div v-else-if="phase === 'success'" class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <p class="text-[15px] font-semibold text-ink-900">{{ t('Appointment booked', 'Cita reservada') }}</p>
      <p class="text-[13px] text-ink-muted first-letter:uppercase">{{ confirmation && new Date(confirmation.starts_at).toLocaleString(locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: clinicTimeZone }) }}</p>
      <NuxtLink to="/" class="mt-2 text-[13px] font-medium text-brand-text">{{ t('Back to home', 'Volver al inicio') }}</NuxtLink>
    </div>
  </div>
</template>

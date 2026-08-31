<script setup lang="ts">
import { COUNTRIES } from '~/utils/countries'
import { effectiveDuration, effectivePriceCents, type AppointmentTypeOverride } from '~/utils/appointmentOverrides'
import { intersectWindows } from '~/utils/businessHours'

definePageMeta({ layout: false })

interface BookingClinic {
  id: string
  name: string
  address: string | null
  business_hours: Record<string, [string, string][]>
}
interface BookingAppointmentType {
  id: string
  name: string
  duration_minutes: number
  color: string
  default_price_cents: number
  online_payment_required: boolean
  online_bookable_by: 'all' | 'new_patients' | 'existing_patients'
  online_bypass_practitioner: boolean
  online_max_days_ahead: number | null
  online_deposit_cents: number | null
}
interface BookingTeamMember {
  id: string
  full_name: string
  color: string
  clinic_ids: string[]
  business_hours: Record<string, [string, string][]> | null
}
interface BookingInfo {
  account: {
    id: string
    name: string
    appointment_confirmation_enabled: boolean
    appointment_confirmation_channels: string[]
    online_booking_max_days_ahead: number
    online_booking_gtm_id: string | null
    online_booking_primary_color: string | null
    online_booking_secondary_color: string | null
    online_booking_background_color: string | null
    online_booking_text_overrides: Record<string, string>
    discount_codes_enabled: boolean
  }
  clinics: BookingClinic[]
  appointment_types: BookingAppointmentType[]
  team_members: BookingTeamMember[]
  overrides: AppointmentTypeOverride[]
}

const route = useRoute()
const slug = route.params.slug as string
const supabase = useSupabaseClient()

const phase = ref<'loading' | 'not_found' | 'select' | 'datetime' | 'details' | 'payment' | 'success'>('loading')

const info = ref<BookingInfo | null>(null)
const clinicId = ref('')
const appointmentTypeId = ref('')
const teamMemberId = ref('')
// True once a valid ?type= deep-link has forced the appointment type -- a
// marketing page linking to one specific offer (e.g. a promo's discounted
// first visit) shouldn't let the patient switch to some other, unrelated
// service from the dropdown.
const typeLockedByQuery = ref(false)

const clinic = computed(() => info.value?.clinics.find((c) => c.id === clinicId.value) ?? null)
const appointmentType = computed(() => info.value?.appointment_types.find((t) => t.id === appointmentTypeId.value) ?? null)
const teamMember = computed(() => info.value?.team_members.find((m) => m.id === teamMemberId.value) ?? null)
const availablePractitioners = computed(() => (info.value?.team_members ?? []).filter((m) => m.clinic_ids.includes(clinicId.value)))

const effectiveDurationMinutes = computed(() =>
  appointmentType.value
    ? effectiveDuration(appointmentType.value.duration_minutes, appointmentTypeId.value, teamMemberId.value, info.value?.overrides ?? [])
    : 0,
)
const effectivePrice = computed(() =>
  appointmentType.value
    ? effectivePriceCents(appointmentType.value.default_price_cents, appointmentTypeId.value, teamMemberId.value, info.value?.overrides ?? [])
    : 0,
)

function formatPrice(cents: number) {
  return (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
}

// Overrides the theme's brand color CSS vars for just this page's root
// element -- every bg-brand/text-brand-text/hover:bg-brand-tint class already
// on this page picks it up for free, same rgb-triplet convention theme.css
// uses (see tailwind.config.ts's themeColor()).
function hexToRgbTriplet(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}
const brandStyle = computed(() => {
  const style: Record<string, string> = {}
  const primary = info.value?.account.online_booking_primary_color ? hexToRgbTriplet(info.value.account.online_booking_primary_color) : null
  const secondary = info.value?.account.online_booking_secondary_color ? hexToRgbTriplet(info.value.account.online_booking_secondary_color) : null
  const background = info.value?.account.online_booking_background_color ? hexToRgbTriplet(info.value.account.online_booking_background_color) : null
  if (primary) {
    style['--color-brand'] = primary
    style['--color-brand-hover'] = primary
    style['--color-brand-text'] = primary
  }
  if (secondary) style['--color-brand-tint'] = secondary
  // Overrides the page's own background -- separate from the brand accent
  // colors above, this is what actually shows through around the card when
  // the widget is embedded (e.g. to match a marketing site's own tone).
  if (background) style['--color-surface-page'] = background
  return style
})

function t(key: string, fallback: string) {
  return info.value?.account.online_booking_text_overrides?.[key] || fallback
}

// --- discount code (validated server-side at submit, in create_public_booking) ---
const discountCode = ref('')
const discountAppliedCents = ref(0)

onMounted(async () => {
  // This is a public storefront other sites embed -- it must never follow
  // the visitor's OS/browser dark-mode preference (or an internal staff
  // member's saved theme, if previewed from inside the app). Always light,
  // with brand colors layered on top via brandStyle above.
  document.documentElement.setAttribute('data-theme', 'light')

  const { data, error } = await supabase.rpc('get_public_booking_info', { p_slug: slug })
  if (error || !data) {
    phase.value = 'not_found'
    return
  }
  const parsed = data as unknown as BookingInfo
  if (parsed.clinics.length === 0) {
    phase.value = 'not_found'
    return
  }
  info.value = parsed
  clinicId.value = parsed.clinics[0].id
  // Marketing pages can deep-link straight into a specific offer (e.g. a
  // promo page's own appointment type/practitioner) via ?type=&practitioner=
  // -- falls back to the usual auto-select when absent or invalid.
  const queryTypeId = typeof route.query.type === 'string' ? route.query.type : null
  const queryPractitionerId = typeof route.query.practitioner === 'string' ? route.query.practitioner : null
  if (queryTypeId && parsed.appointment_types.some((t) => t.id === queryTypeId)) {
    appointmentTypeId.value = queryTypeId
    typeLockedByQuery.value = true
  } else if (parsed.appointment_types.length === 1) {
    appointmentTypeId.value = parsed.appointment_types[0].id
  }
  const forClinic = parsed.team_members.filter((m) => m.clinic_ids.includes(clinicId.value))
  if (queryPractitionerId && forClinic.some((m) => m.id === queryPractitionerId)) {
    teamMemberId.value = queryPractitionerId
  } else if (forClinic.length === 1 || bypassPractitioner.value) {
    teamMemberId.value = forClinic[0]?.id ?? ''
  }
  phase.value = 'select'

  if (parsed.account.online_booking_gtm_id) {
    const script = document.createElement('script')
    script.async = true
    script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(parsed.account.online_booking_gtm_id)}`
    document.head.appendChild(script)
  }
})

// Restore whatever theme the visitor actually had if they navigate away
// within the same session (only relevant when staff preview this page from
// inside the authenticated app) -- setPreference re-resolves and re-applies
// the stored preference, same as it does on a normal toggle.
onUnmounted(() => {
  const { preference, setPreference } = useTheme()
  setPreference(preference.value)
})

function onClinicChange() {
  const forClinic = availablePractitioners.value
  teamMemberId.value = forClinic.length === 1 || bypassPractitioner.value ? (forClinic[0]?.id ?? '') : ''
}

// "Bypass practitioner selection" shows any available practitioner rather
// than asking the patient to pick one -- this app has no per-type
// practitioner-eligibility list yet, so "any" is simplified to "the first
// one offering this clinic", same one-practitioner auto-pick the page
// already did before this feature existed.
const bypassPractitioner = computed(() => !!appointmentType.value?.online_bypass_practitioner)
watch(appointmentTypeId, () => {
  if (bypassPractitioner.value) teamMemberId.value = availablePractitioners.value[0]?.id ?? ''
})

const canContinueFromSelect = computed(() => !!clinicId.value && !!appointmentTypeId.value && !!teamMemberId.value)

// --- date/time ---
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const WEEKDAY_LABELS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do']

const viewMonth = ref(startOfMonth(new Date()))
const selectedDate = ref<Date | null>(null)
const selectedSlot = ref<Date | null>(null)
const busyRanges = ref<{ starts_at: string; ends_at: string }[]>([])
const slotsLoading = ref(false)

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function today() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

const monthLabel = computed(() =>
  viewMonth.value.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase())
)

// Per-type override falls back to the account default, same convention as
// every other appointment_type_overrides-style field in this app.
const maxAllowedDate = computed(() => {
  const days = appointmentType.value?.online_max_days_ahead ?? info.value?.account.online_booking_max_days_ahead ?? 90
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(23, 59, 59, 999)
  return d
})

const calendarDays = computed(() => {
  const first = viewMonth.value
  const firstWeekday = (first.getDay() + 6) % 7 // Monday = 0
  const gridStart = new Date(first)
  gridStart.setDate(first.getDate() - firstWeekday)
  const days: { date: Date; inMonth: boolean; bookable: boolean }[] = []
  for (let i = 0; i < 42; i++) {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + i)
    days.push({ date, inMonth: date.getMonth() === first.getMonth(), bookable: dayHasHours(date) && date >= today() && date <= maxAllowedDate.value })
  }
  return days
})

function dayHasHours(date: Date) {
  const hours = clinic.value?.business_hours
  if (!hours) return false
  const clinicWindows = hours[WEEKDAY_KEYS[date.getDay()]] ?? []
  const windows = intersectWindows(clinicWindows, teamMember.value?.business_hours?.[WEEKDAY_KEYS[date.getDay()]])
  return windows.length > 0
}

function prevMonth() {
  viewMonth.value = new Date(viewMonth.value.getFullYear(), viewMonth.value.getMonth() - 1, 1)
}
function nextMonth() {
  viewMonth.value = new Date(viewMonth.value.getFullYear(), viewMonth.value.getMonth() + 1, 1)
}

async function selectDate(day: { date: Date; bookable: boolean }) {
  if (!day.bookable) return
  selectedDate.value = day.date
  selectedSlot.value = null
  slotsLoading.value = true
  const dayStart = new Date(day.date)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(day.date)
  dayEnd.setHours(23, 59, 59, 999)
  const { data } = await supabase.rpc('get_booking_busy_times', {
    p_clinic_id: clinicId.value,
    p_team_member_id: teamMemberId.value,
    p_from: dayStart.toISOString(),
    p_to: dayEnd.toISOString(),
  })
  busyRanges.value = (data as { starts_at: string; ends_at: string }[]) ?? []
  slotsLoading.value = false
}

const daySlots = computed(() => {
  if (!selectedDate.value || !appointmentType.value) return []
  const weekday = WEEKDAY_KEYS[selectedDate.value.getDay()]
  const clinicWindows = clinic.value?.business_hours?.[weekday] ?? []
  const windows = intersectWindows(clinicWindows, teamMember.value?.business_hours?.[weekday])
  const duration = effectiveDurationMinutes.value
  const now = new Date()
  const slots: Date[] = []
  for (const [startStr, endStr] of windows) {
    const [sh, sm] = startStr.split(':').map(Number)
    const [eh, em] = endStr.split(':').map(Number)
    let cursor = new Date(selectedDate.value)
    cursor.setHours(sh, sm, 0, 0)
    const windowEnd = new Date(selectedDate.value)
    windowEnd.setHours(eh, em, 0, 0)
    while (true) {
      const slotEnd = new Date(cursor.getTime() + duration * 60000)
      if (slotEnd > windowEnd) break
      if (cursor > now) {
        const overlaps = busyRanges.value.some((b) => new Date(b.starts_at) < slotEnd && new Date(b.ends_at) > cursor)
        if (!overlaps) slots.push(new Date(cursor))
      }
      cursor = new Date(cursor.getTime() + duration * 60000)
    }
  }
  return slots
})

const morningSlots = computed(() => daySlots.value.filter((s) => s.getHours() < 14))
const afternoonSlots = computed(() => daySlots.value.filter((s) => s.getHours() >= 14))

function pickSlot(slot: Date) {
  selectedSlot.value = slot
  phase.value = 'details'
}

// --- patient details ---
const firstName = ref('')
const lastName = ref('')
const email = ref('')
const dialCode = ref('ES')
const phoneNumber = ref('')
const note = ref('')
const submitting = ref(false)
const submitError = ref('')
const confirmation = ref<{ starts_at: string } | null>(null)
const invoiceId = ref('')
const paymentRequiredCents = ref(0)

async function submitBooking() {
  if (!selectedSlot.value) return
  submitError.value = ''
  submitting.value = true
  const { data, error } = await supabase.rpc('create_public_booking', {
    p_account_slug: slug,
    p_clinic_id: clinicId.value,
    p_team_member_id: teamMemberId.value,
    p_appointment_type_id: appointmentTypeId.value,
    p_starts_at: selectedSlot.value.toISOString(),
    p_first_name: firstName.value,
    p_last_name: lastName.value,
    p_email: email.value,
    // Bare number, no dial prefix -- country_code is stored separately and
    // every display site (DetailSidebar.vue, ContactNumbersEditor.vue)
    // already prepends the dial code itself from country_code.
    p_phone: phoneNumber.value,
    p_country_code: dialCode.value,
    p_note: note.value,
    p_discount_code: discountCode.value.trim() || undefined,
  })
  submitting.value = false
  if (error) {
    submitError.value = error.message
    return
  }
  const result = data as unknown as { appointment_id: string; starts_at: string; invoice_id: string | null; payment_required_cents: number; discount_applied_cents: number }
  confirmation.value = result
  discountAppliedCents.value = result.discount_applied_cents ?? 0
  // Conversion event for whatever's listening on the account's GTM container
  // (Settings > Online Booking > General) -- the appointment already exists
  // at this point regardless of payment, so this fires once per real booking
  // rather than only after a successful online payment.
  ;(window as any).dataLayer = (window as any).dataLayer || []
  ;(window as any).dataLayer.push({
    event: 'booking_completed',
    booking_appointment_type: appointmentType.value?.name ?? '',
    booking_value: effectivePrice.value ? effectivePrice.value / 100 : 0,
    booking_currency: 'EUR',
  })
  // Fire-and-forget, same as the staff-booking side (AppointmentModal.vue) --
  // a failed confirmation send should never block the success screen the
  // patient is about to see.
  $fetch('/api/public-booking/send-confirmation', { method: 'POST', body: { accountSlug: slug, appointmentId: result.appointment_id } }).catch(() => {})
  // Booking always succeeds first regardless of payment -- if the type requires
  // online payment, the appointment already exists (visible to staff) before
  // the patient even sees the payment step, so a dropped connection here never
  // leaves a charged customer with no booking or a booking silently unpaid
  // and untracked.
  if (result.invoice_id && result.payment_required_cents > 0) {
    invoiceId.value = result.invoice_id
    paymentRequiredCents.value = result.payment_required_cents
    phase.value = 'payment'
  } else {
    phase.value = 'success'
  }
}

function onPaymentSucceeded() {
  phase.value = 'success'
}

function backToDatetime() {
  phase.value = 'datetime'
}

function proceedToDatetime() {
  phase.value = 'datetime'
}

// --- iframe embed: report height to parent so a fixed-height iframe isn't needed ---
if (import.meta.client) {
  const reportHeight = () => {
    if (window.self === window.top) return
    window.parent.postMessage({ source: 'quiroflow-booking', height: document.documentElement.scrollHeight }, '*')
  }
  onMounted(() => {
    reportHeight()
    const observer = new ResizeObserver(reportHeight)
    observer.observe(document.documentElement)
  })
}
</script>

<template>
  <div class="min-h-screen bg-surface-page px-4 py-10" :style="brandStyle">
    <div class="mx-auto max-w-5xl">
      <div v-if="phase === 'loading'" class="py-24 text-center text-sm text-ink-faint">Cargando…</div>

      <div v-else-if="phase === 'not_found'" class="rounded-card border border-line bg-surface p-10 text-center">
        <p class="text-ink-muted">La reserva online no está disponible para esta clínica.</p>
      </div>

      <template v-else-if="info">
        <h1 class="text-center text-2xl font-semibold text-ink-900">{{ t('heading', 'Reservar una cita') }}</h1>
        <p class="mt-1 text-center text-sm text-ink-muted">{{ info.account.name }}</p>

        <!-- Step 0: service / practitioner selection -->
        <div v-if="phase === 'select'" class="mx-auto mt-8 max-w-md rounded-card border border-line bg-surface p-6 shadow-card">
          <div v-if="info.clinics.length > 1">
            <label class="block text-sm font-medium text-ink-700">Clínica</label>
            <select v-model="clinicId" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm" @change="onClinicChange">
              <option v-for="c in info.clinics" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>
          <div v-if="info.appointment_types.length > 1 && !typeLockedByQuery" class="mt-4">
            <label class="block text-sm font-medium text-ink-700">Servicio</label>
            <select v-model="appointmentTypeId" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm">
              <option v-for="t in info.appointment_types" :key="t.id" :value="t.id">
                {{ t.name }} — {{ t.duration_minutes }} min
              </option>
            </select>
          </div>
          <div v-if="!bypassPractitioner && availablePractitioners.length > 1" class="mt-4">
            <label class="block text-sm font-medium text-ink-700">{{ t('choose_practitioner', 'Profesional') }}</label>
            <select v-model="teamMemberId" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm">
              <option v-for="m in availablePractitioners" :key="m.id" :value="m.id">{{ m.full_name }}</option>
            </select>
          </div>
          <p v-if="availablePractitioners.length === 0" class="mt-4 text-sm text-danger-text">
            No hay profesionales disponibles para reserva online en esta clínica.
          </p>
          <UiBtn type="button" variant="primary" class="mt-6 w-full" :disabled="!canContinueFromSelect" @click="proceedToDatetime">
            Continuar
          </UiBtn>
        </div>

        <!-- Step 1: date & time -->
        <div v-else-if="phase === 'datetime'">
          <p class="mt-6 text-center text-xs font-semibold uppercase tracking-wide text-warning-text">Paso 1 de 2</p>
          <h2 class="text-center text-xl font-semibold text-ink-900">{{ t('choose_datetime', 'Elija su fecha y hora') }}</h2>

          <div class="mt-6 grid gap-6 md:grid-cols-3">
            <div class="rounded-card border border-line bg-surface p-4 shadow-card">
              <div class="flex items-center justify-between">
                <button type="button" class="rounded p-1 text-ink-faint hover:bg-surface-subtle" @click="prevMonth">&lsaquo;</button>
                <span class="text-sm font-semibold text-ink-900">{{ monthLabel }}</span>
                <button type="button" class="rounded p-1 text-ink-faint hover:bg-surface-subtle" @click="nextMonth">&rsaquo;</button>
              </div>
              <div class="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-medium text-ink-faint">
                <span v-for="l in WEEKDAY_LABELS" :key="l">{{ l }}</span>
              </div>
              <div class="mt-1 grid grid-cols-7 gap-1">
                <button
                  v-for="(day, i) in calendarDays"
                  :key="i"
                  type="button"
                  :disabled="!day.bookable"
                  class="aspect-square rounded-full text-sm"
                  :class="[
                    !day.inMonth ? 'text-ink-faint' : day.bookable ? 'text-ink-700 hover:bg-brand-tint' : 'text-ink-faint',
                    selectedDate && isSameDay(day.date, selectedDate) ? 'bg-brand text-white hover:bg-brand' : '',
                  ]"
                  @click="selectDate(day)"
                >
                  {{ day.date.getDate() }}
                </button>
              </div>
            </div>

            <div class="rounded-card border border-line bg-surface p-4 shadow-card">
              <p v-if="!selectedDate" class="text-sm text-ink-faint">Elija un día del calendario.</p>
              <template v-else>
                <p class="text-sm font-semibold text-ink-900">
                  {{ selectedDate.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) }}
                </p>
                <div v-if="slotsLoading" class="mt-3 text-sm text-ink-faint">Cargando horarios…</div>
                <template v-else>
                  <div v-if="daySlots.length === 0" class="mt-3 text-sm text-ink-faint">No hay horas disponibles ese día.</div>
                  <div v-if="morningSlots.length" class="mt-3">
                    <p class="text-xs font-medium uppercase text-ink-faint">Mañana</p>
                    <div class="mt-1.5 flex flex-wrap gap-2">
                      <button
                        v-for="s in morningSlots"
                        :key="s.toISOString()"
                        type="button"
                        class="rounded-ctl bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover"
                        @click="pickSlot(s)"
                      >
                        {{ s.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) }}
                      </button>
                    </div>
                  </div>
                  <div v-if="afternoonSlots.length" class="mt-3">
                    <p class="text-xs font-medium uppercase text-ink-faint">Tarde</p>
                    <div class="mt-1.5 flex flex-wrap gap-2">
                      <button
                        v-for="s in afternoonSlots"
                        :key="s.toISOString()"
                        type="button"
                        class="rounded-ctl bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover"
                        @click="pickSlot(s)"
                      >
                        {{ s.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) }}
                      </button>
                    </div>
                  </div>
                </template>
              </template>
            </div>

            <BookingSummary :clinic="clinic" :appointment-type="appointmentType" :price-cents="effectivePrice" :team-member="teamMember" :slot="selectedSlot" :format-price="formatPrice" :online-payment-required="appointmentType?.online_payment_required" :deposit-cents="appointmentType?.online_deposit_cents" />
          </div>
        </div>

        <!-- Step 2: patient details -->
        <div v-else-if="phase === 'details'">
          <div class="mt-6 flex items-center justify-between">
            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-warning-text">Paso 2 de 2</p>
              <h2 class="text-xl font-semibold text-ink-900">{{ t('enter_details', 'Introduzca sus datos') }}</h2>
            </div>
            <UiBtn type="button" variant="secondary" @click="backToDatetime">
              &larr; Atrás
            </UiBtn>
          </div>

          <div class="mt-6 grid gap-6 md:grid-cols-3">
            <form class="rounded-card border border-line bg-surface p-6 shadow-card md:col-span-2" @submit.prevent="submitBooking">
              <div class="grid gap-4 sm:grid-cols-2">
                <div>
                  <label class="block text-sm font-medium text-ink-700">Nombre *</label>
                  <input v-model="firstName" type="text" required placeholder="Su nombre" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-ink-700">Apellidos</label>
                  <input v-model="lastName" type="text" placeholder="Sus apellidos" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-ink-700">Correo electrónico *</label>
                  <input v-model="email" type="email" required placeholder="Su dirección de correo" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-ink-700">Número de móvil</label>
                  <div class="mt-1 flex gap-2">
                    <select v-model="dialCode" class="rounded-ctl border border-line-control px-2 py-2 text-sm">
                      <option v-for="c in COUNTRIES" :key="c.code" :value="c.code">{{ c.flag }} {{ c.dial }}</option>
                    </select>
                    <input v-model="phoneNumber" type="tel" class="w-full rounded-ctl border border-line-control px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
                  </div>
                </div>
              </div>
              <div class="mt-4">
                <label class="block text-sm font-medium text-ink-700">Notas</label>
                <textarea v-model="note" rows="3" placeholder="¿Algo que quiera que sepamos?" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"></textarea>
              </div>
              <div v-if="info.account.discount_codes_enabled" class="mt-4">
                <label class="block text-sm font-medium text-ink-700">Código de descuento</label>
                <input v-model="discountCode" type="text" placeholder="Opcional" class="mt-1 w-full max-w-[200px] rounded-ctl border border-line-control px-3 py-2 text-sm uppercase focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
              </div>
              <p v-if="submitError" class="mt-3 text-sm text-danger-text">{{ submitError }}</p>
              <UiBtn type="submit" variant="primary" class="mt-5" :disabled="submitting">
                {{ submitting ? 'Reservando…' : t('confirm_button', 'Reservar cita') }}
              </UiBtn>
            </form>

            <BookingSummary :clinic="clinic" :appointment-type="appointmentType" :price-cents="effectivePrice" :team-member="teamMember" :slot="selectedSlot" :format-price="formatPrice" :online-payment-required="appointmentType?.online_payment_required" :deposit-cents="appointmentType?.online_deposit_cents" />
          </div>
        </div>

        <!-- Step 3: payment (only when the appointment type requires it) -->
        <div v-else-if="phase === 'payment'" class="mx-auto mt-8 max-w-md">
          <h2 class="text-center text-xl font-semibold text-ink-900">Pago</h2>
          <p class="mt-1 text-center text-sm text-ink-muted">Su cita ya está reservada. Complete el pago para confirmarla.</p>
          <BookingPayment class="mt-6" :account-slug="slug" :invoice-id="invoiceId" :amount-cents="paymentRequiredCents" :format-price="formatPrice" @paid="onPaymentSucceeded" />
        </div>

        <!-- Success -->
        <div v-else-if="phase === 'success'" class="mx-auto mt-10 max-w-md rounded-card border border-line bg-surface p-8 text-center shadow-card">
          <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-bg text-2xl text-success-text">✓</div>
          <h2 class="mt-4 text-lg font-semibold text-ink-900">{{ t('success_heading', '¡Cita reservada!') }}</h2>
          <p class="mt-2 text-sm text-ink-muted">
            {{ confirmation ? new Date(confirmation.starts_at).toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short' }) : '' }}
          </p>
          <p class="mt-1 text-sm text-ink-muted">{{ teamMember?.full_name }} · {{ clinic?.name }}</p>
          <p v-if="discountAppliedCents > 0" class="mt-1 text-sm text-success-text">Descuento aplicado: {{ formatPrice(discountAppliedCents) }}</p>
          <p
            v-if="info.account.appointment_confirmation_enabled && info.account.appointment_confirmation_channels.includes('email')"
            class="mt-4 text-xs text-ink-faint"
          >
            Le hemos enviado los detalles a {{ email }}.
          </p>
        </div>
      </template>
    </div>
  </div>
</template>

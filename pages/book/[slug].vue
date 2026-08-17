<script setup lang="ts">
import { COUNTRIES } from '~/utils/countries'

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
}
interface BookingTeamMember {
  id: string
  full_name: string
  color: string
  clinic_ids: string[]
}
interface BookingInfo {
  account: { id: string; name: string }
  clinics: BookingClinic[]
  appointment_types: BookingAppointmentType[]
  team_members: BookingTeamMember[]
}

const route = useRoute()
const slug = route.params.slug as string
const supabase = useSupabaseClient()

const phase = ref<'loading' | 'not_found' | 'select' | 'datetime' | 'details' | 'success'>('loading')

const info = ref<BookingInfo | null>(null)
const clinicId = ref('')
const appointmentTypeId = ref('')
const teamMemberId = ref('')

const clinic = computed(() => info.value?.clinics.find((c) => c.id === clinicId.value) ?? null)
const appointmentType = computed(() => info.value?.appointment_types.find((t) => t.id === appointmentTypeId.value) ?? null)
const teamMember = computed(() => info.value?.team_members.find((m) => m.id === teamMemberId.value) ?? null)
const availablePractitioners = computed(() => (info.value?.team_members ?? []).filter((m) => m.clinic_ids.includes(clinicId.value)))

function formatPrice(cents: number) {
  return (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
}

onMounted(async () => {
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
  if (parsed.appointment_types.length === 1) appointmentTypeId.value = parsed.appointment_types[0].id
  const forClinic = parsed.team_members.filter((m) => m.clinic_ids.includes(clinicId.value))
  if (forClinic.length === 1) teamMemberId.value = forClinic[0].id
  phase.value = 'select'
})

function onClinicChange() {
  const forClinic = availablePractitioners.value
  teamMemberId.value = forClinic.length === 1 ? forClinic[0].id : ''
}

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

const calendarDays = computed(() => {
  const first = viewMonth.value
  const firstWeekday = (first.getDay() + 6) % 7 // Monday = 0
  const gridStart = new Date(first)
  gridStart.setDate(first.getDate() - firstWeekday)
  const days: { date: Date; inMonth: boolean; bookable: boolean }[] = []
  for (let i = 0; i < 42; i++) {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + i)
    days.push({ date, inMonth: date.getMonth() === first.getMonth(), bookable: dayHasHours(date) && date >= today() })
  }
  return days
})

function dayHasHours(date: Date) {
  const hours = clinic.value?.business_hours
  if (!hours) return false
  const windows = hours[WEEKDAY_KEYS[date.getDay()]]
  return !!windows && windows.length > 0
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
  const windows = clinic.value?.business_hours?.[WEEKDAY_KEYS[selectedDate.value.getDay()]] ?? []
  const duration = appointmentType.value.duration_minutes
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

async function submitBooking() {
  if (!selectedSlot.value) return
  submitError.value = ''
  submitting.value = true
  const dial = COUNTRIES.find((c) => c.code === dialCode.value)?.dial ?? ''
  const { data, error } = await supabase.rpc('create_public_booking', {
    p_account_slug: slug,
    p_clinic_id: clinicId.value,
    p_team_member_id: teamMemberId.value,
    p_appointment_type_id: appointmentTypeId.value,
    p_starts_at: selectedSlot.value.toISOString(),
    p_first_name: firstName.value,
    p_last_name: lastName.value,
    p_email: email.value,
    p_phone: phoneNumber.value ? `${dial} ${phoneNumber.value}` : '',
    p_note: note.value,
  })
  submitting.value = false
  if (error) {
    submitError.value = error.message
    return
  }
  confirmation.value = data as unknown as { starts_at: string }
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
  <div class="min-h-screen bg-stone-50 px-4 py-10">
    <div class="mx-auto max-w-5xl">
      <div v-if="phase === 'loading'" class="py-24 text-center text-sm text-gray-400">Cargando…</div>

      <div v-else-if="phase === 'not_found'" class="rounded-lg border border-gray-200 bg-white p-10 text-center">
        <p class="text-gray-500">La reserva online no está disponible para esta clínica.</p>
      </div>

      <template v-else-if="info">
        <h1 class="text-center text-2xl font-semibold text-gray-900">Reservar una cita</h1>
        <p class="mt-1 text-center text-sm text-gray-500">{{ info.account.name }}</p>

        <!-- Step 0: service / practitioner selection -->
        <div v-if="phase === 'select'" class="mx-auto mt-8 max-w-md rounded-lg border border-gray-200 bg-white p-6">
          <div v-if="info.clinics.length > 1">
            <label class="block text-sm font-medium text-gray-700">Clínica</label>
            <select v-model="clinicId" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" @change="onClinicChange">
              <option v-for="c in info.clinics" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>
          <div v-if="info.appointment_types.length > 1" class="mt-4">
            <label class="block text-sm font-medium text-gray-700">Servicio</label>
            <select v-model="appointmentTypeId" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
              <option v-for="t in info.appointment_types" :key="t.id" :value="t.id">
                {{ t.name }} — {{ t.duration_minutes }} min
              </option>
            </select>
          </div>
          <div v-if="availablePractitioners.length > 1" class="mt-4">
            <label class="block text-sm font-medium text-gray-700">Profesional</label>
            <select v-model="teamMemberId" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
              <option v-for="m in availablePractitioners" :key="m.id" :value="m.id">{{ m.full_name }}</option>
            </select>
          </div>
          <p v-if="availablePractitioners.length === 0" class="mt-4 text-sm text-red-600">
            No hay profesionales disponibles para reserva online en esta clínica.
          </p>
          <button
            type="button"
            :disabled="!canContinueFromSelect"
            class="mt-6 w-full rounded-md bg-green-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-900 disabled:opacity-50"
            @click="proceedToDatetime"
          >
            Continuar
          </button>
        </div>

        <!-- Step 1: date & time -->
        <div v-else-if="phase === 'datetime'">
          <p class="mt-6 text-center text-xs font-semibold uppercase tracking-wide text-amber-700">Paso 1 de 2</p>
          <h2 class="text-center text-xl font-semibold text-gray-900">Elija su fecha y hora</h2>

          <div class="mt-6 grid gap-6 md:grid-cols-3">
            <div class="rounded-lg border border-gray-200 bg-white p-4">
              <div class="flex items-center justify-between">
                <button type="button" class="rounded p-1 text-gray-400 hover:bg-gray-100" @click="prevMonth">&lsaquo;</button>
                <span class="text-sm font-semibold text-gray-900">{{ monthLabel }}</span>
                <button type="button" class="rounded p-1 text-gray-400 hover:bg-gray-100" @click="nextMonth">&rsaquo;</button>
              </div>
              <div class="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-medium text-gray-400">
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
                    !day.inMonth ? 'text-gray-300' : day.bookable ? 'text-gray-700 hover:bg-green-50' : 'text-gray-300',
                    selectedDate && isSameDay(day.date, selectedDate) ? 'bg-green-800 text-white hover:bg-green-800' : '',
                  ]"
                  @click="selectDate(day)"
                >
                  {{ day.date.getDate() }}
                </button>
              </div>
            </div>

            <div class="rounded-lg border border-gray-200 bg-white p-4">
              <p v-if="!selectedDate" class="text-sm text-gray-400">Elija un día del calendario.</p>
              <template v-else>
                <p class="text-sm font-semibold text-gray-900">
                  {{ selectedDate.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) }}
                </p>
                <div v-if="slotsLoading" class="mt-3 text-sm text-gray-400">Cargando horarios…</div>
                <template v-else>
                  <div v-if="daySlots.length === 0" class="mt-3 text-sm text-gray-400">No hay horas disponibles ese día.</div>
                  <div v-if="morningSlots.length" class="mt-3">
                    <p class="text-xs font-medium uppercase text-gray-400">Mañana</p>
                    <div class="mt-1.5 flex flex-wrap gap-2">
                      <button
                        v-for="s in morningSlots"
                        :key="s.toISOString()"
                        type="button"
                        class="rounded-md bg-green-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-900"
                        @click="pickSlot(s)"
                      >
                        {{ s.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) }}
                      </button>
                    </div>
                  </div>
                  <div v-if="afternoonSlots.length" class="mt-3">
                    <p class="text-xs font-medium uppercase text-gray-400">Tarde</p>
                    <div class="mt-1.5 flex flex-wrap gap-2">
                      <button
                        v-for="s in afternoonSlots"
                        :key="s.toISOString()"
                        type="button"
                        class="rounded-md bg-green-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-900"
                        @click="pickSlot(s)"
                      >
                        {{ s.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) }}
                      </button>
                    </div>
                  </div>
                </template>
              </template>
            </div>

            <BookingSummary :clinic="clinic" :appointment-type="appointmentType" :team-member="teamMember" :slot="selectedSlot" :format-price="formatPrice" />
          </div>
        </div>

        <!-- Step 2: patient details -->
        <div v-else-if="phase === 'details'">
          <div class="mt-6 flex items-center justify-between">
            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-amber-700">Paso 2 de 2</p>
              <h2 class="text-xl font-semibold text-gray-900">Introduzca sus datos</h2>
            </div>
            <button type="button" class="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50" @click="backToDatetime">
              &larr; Atrás
            </button>
          </div>

          <div class="mt-6 grid gap-6 md:grid-cols-3">
            <form class="rounded-lg border border-gray-200 bg-white p-6 md:col-span-2" @submit.prevent="submitBooking">
              <div class="grid gap-4 sm:grid-cols-2">
                <div>
                  <label class="block text-sm font-medium text-gray-700">Nombre *</label>
                  <input v-model="firstName" type="text" required placeholder="Su nombre" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-700 focus:outline-none focus:ring-1 focus:ring-green-700" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700">Apellidos</label>
                  <input v-model="lastName" type="text" placeholder="Sus apellidos" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-700 focus:outline-none focus:ring-1 focus:ring-green-700" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700">Correo electrónico *</label>
                  <input v-model="email" type="email" required placeholder="Su dirección de correo" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-700 focus:outline-none focus:ring-1 focus:ring-green-700" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700">Número de móvil</label>
                  <div class="mt-1 flex gap-2">
                    <select v-model="dialCode" class="rounded-md border border-gray-300 px-2 py-2 text-sm">
                      <option v-for="c in COUNTRIES" :key="c.code" :value="c.code">{{ c.flag }} {{ c.dial }}</option>
                    </select>
                    <input v-model="phoneNumber" type="tel" class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-700 focus:outline-none focus:ring-1 focus:ring-green-700" />
                  </div>
                </div>
              </div>
              <div class="mt-4">
                <label class="block text-sm font-medium text-gray-700">Notas</label>
                <textarea v-model="note" rows="3" placeholder="¿Algo que quiera que sepamos?" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-700 focus:outline-none focus:ring-1 focus:ring-green-700"></textarea>
              </div>
              <p v-if="submitError" class="mt-3 text-sm text-red-600">{{ submitError }}</p>
              <button type="submit" :disabled="submitting" class="mt-5 rounded-md bg-green-800 px-5 py-2.5 text-sm font-medium text-white hover:bg-green-900 disabled:opacity-50">
                {{ submitting ? 'Reservando…' : 'Reservar cita' }}
              </button>
            </form>

            <BookingSummary :clinic="clinic" :appointment-type="appointmentType" :team-member="teamMember" :slot="selectedSlot" :format-price="formatPrice" />
          </div>
        </div>

        <!-- Success -->
        <div v-else-if="phase === 'success'" class="mx-auto mt-10 max-w-md rounded-lg border border-gray-200 bg-white p-8 text-center">
          <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-2xl text-green-800">✓</div>
          <h2 class="mt-4 text-lg font-semibold text-gray-900">¡Cita reservada!</h2>
          <p class="mt-2 text-sm text-gray-500">
            {{ confirmation ? new Date(confirmation.starts_at).toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short' }) : '' }}
          </p>
          <p class="mt-1 text-sm text-gray-500">{{ teamMember?.full_name }} · {{ clinic?.name }}</p>
          <p class="mt-4 text-xs text-gray-400">Le hemos enviado los detalles a {{ email }}.</p>
        </div>
      </template>
    </div>
  </div>
</template>

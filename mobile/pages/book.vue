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
  clinics: BookingClinic[]
  appointment_types: BookingAppointmentType[]
  team_members: BookingTeamMember[]
}

const supabase = useSupabaseClient()

const phase = ref<'loading' | 'not_available' | 'select' | 'datetime' | 'confirm' | 'success'>('loading')

const info = ref<BookingInfo | null>(null)
const clinicId = ref('')
const appointmentTypeId = ref('')
const teamMemberId = ref('')

const clinic = computed(() => info.value?.clinics.find((c) => c.id === clinicId.value) ?? null)
const appointmentType = computed(() => info.value?.appointment_types.find((t) => t.id === appointmentTypeId.value) ?? null)
const teamMember = computed(() => info.value?.team_members.find((m) => m.id === teamMemberId.value) ?? null)
const availablePractitioners = computed(() => (info.value?.team_members ?? []).filter((m) => m.clinic_ids.includes(clinicId.value)))

function formatPrice(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'EUR' })
}

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
  clinicId.value = parsed.clinics[0].id
  if (parsed.appointment_types.length === 1) appointmentTypeId.value = parsed.appointment_types[0].id
  const forClinic = parsed.team_members.filter((m) => m.clinic_ids.includes(clinicId.value))
  if (forClinic.length === 1) teamMemberId.value = forClinic[0].id
  phase.value = 'select'
})

function onClinicChange() {
  teamMemberId.value = availablePractitioners.value.length === 1 ? availablePractitioners.value[0].id : ''
}

const canContinueFromSelect = computed(() => !!clinicId.value && !!appointmentTypeId.value && !!teamMemberId.value)

// --- date/time ---
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

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

const monthLabel = computed(() => viewMonth.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))

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
  const { data, error } = await supabase.rpc('create_patient_booking', {
    p_clinic_id: clinicId.value,
    p_team_member_id: teamMemberId.value,
    p_appointment_type_id: appointmentTypeId.value,
    p_starts_at: selectedSlot.value.toISOString(),
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
</script>

<template>
  <div class="flex min-h-screen flex-col p-4">
    <div class="mb-4 flex items-center gap-2">
      <NuxtLink to="/" class="text-[13px] font-medium text-brand-text">&larr; Back</NuxtLink>
      <h1 class="ml-auto text-[15px] font-semibold text-ink-900">New appointment</h1>
    </div>

    <div v-if="phase === 'loading'" class="flex flex-1 items-center justify-center text-sm text-ink-faint">Loading…</div>
    <div v-else-if="phase === 'not_available'" class="flex flex-1 items-center justify-center px-6 text-center text-sm text-ink-muted">
      Online booking isn't available for your clinic right now — please contact them directly.
    </div>

    <div v-else-if="phase === 'select'" class="space-y-4">
      <div v-if="info!.clinics.length > 1">
        <label class="block text-[12.5px] font-medium text-ink-700">Clinic</label>
        <select v-model="clinicId" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-[13.5px]" @change="onClinicChange">
          <option v-for="c in info!.clinics" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>

      <div>
        <label class="block text-[12.5px] font-medium text-ink-700">Appointment type</label>
        <select v-model="appointmentTypeId" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-[13.5px]">
          <option v-for="t in info!.appointment_types" :key="t.id" :value="t.id">{{ t.name }} ({{ t.duration_minutes }} min)</option>
        </select>
      </div>

      <div>
        <label class="block text-[12.5px] font-medium text-ink-700">Practitioner</label>
        <select v-model="teamMemberId" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-[13.5px]">
          <option v-for="m in availablePractitioners" :key="m.id" :value="m.id">{{ m.full_name }}</option>
        </select>
      </div>

      <UiBtn variant="primary" class="w-full" :disabled="!canContinueFromSelect" @click="phase = 'datetime'">Continue</UiBtn>
    </div>

    <div v-else-if="phase === 'datetime'" class="space-y-4">
      <div class="flex items-center justify-between">
        <button type="button" class="px-2 text-[13px] text-ink-muted" @click="prevMonth">&lsaquo;</button>
        <p class="text-[13.5px] font-medium text-ink-900">{{ monthLabel }}</p>
        <button type="button" class="px-2 text-[13px] text-ink-muted" @click="nextMonth">&rsaquo;</button>
      </div>
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
        <div v-if="slotsLoading" class="text-[13px] text-ink-faint">Loading times…</div>
        <div v-else-if="daySlots.length === 0" class="text-[13px] text-ink-faint">No times available this day.</div>
        <div v-else class="grid grid-cols-3 gap-2">
          <button
            v-for="slot in daySlots"
            :key="slot.toISOString()"
            type="button"
            class="rounded-ctl border border-line-control py-2 text-[12.5px] text-ink-700 hover:border-brand hover:text-brand-text"
            @click="pickSlot(slot)"
          >
            {{ slot.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
          </button>
        </div>
      </div>
    </div>

    <div v-else-if="phase === 'confirm'" class="space-y-4">
      <div class="rounded-card border border-line bg-surface p-4">
        <p class="text-[13.5px] font-medium text-ink-900">{{ appointmentType?.name }}</p>
        <p class="mt-1 text-[12.5px] text-ink-muted">with {{ teamMember?.full_name }}</p>
        <p class="mt-1 text-[12.5px] text-ink-muted">{{ selectedSlot?.toLocaleString([], { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) }}</p>
        <p v-if="appointmentType" class="mt-1 text-[12.5px] text-ink-muted">{{ formatPrice(appointmentType.default_price_cents) }}</p>
      </div>
      <div>
        <label class="block text-[12.5px] font-medium text-ink-700">Note (optional)</label>
        <textarea v-model="note" rows="3" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-[13.5px]" />
      </div>
      <p v-if="submitError" class="text-[12.5px] text-danger-text">{{ submitError }}</p>
      <UiBtn variant="primary" class="w-full" :disabled="submitting" @click="submitBooking">{{ submitting ? 'Booking…' : 'Confirm booking' }}</UiBtn>
      <button type="button" class="w-full text-center text-[12.5px] text-ink-muted" @click="phase = 'datetime'">&larr; Choose a different time</button>
    </div>

    <div v-else-if="phase === 'success'" class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <p class="text-[15px] font-semibold text-ink-900">Appointment booked</p>
      <p class="text-[13px] text-ink-muted">{{ confirmation && new Date(confirmation.starts_at).toLocaleString([], { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) }}</p>
      <NuxtLink to="/" class="mt-2 text-[13px] font-medium text-brand-text">Back to home</NuxtLink>
    </div>
  </div>
</template>

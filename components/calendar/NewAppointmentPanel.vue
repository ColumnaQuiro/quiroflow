<script setup lang="ts">
import { hasBusinessHoursConfigured, isWithinBusinessHours } from '~/utils/businessHours'
import { effectivePriceCents, effectiveDuration, type AppointmentTypeOverride } from '~/utils/appointmentOverrides'
import { normalizeSearchTerm } from '~/utils/searchText'

interface RoomOption { id: string; name: string }
interface AppointmentTypeOption { id: string; name: string; duration_minutes: number; color: string; default_price_cents: number }
interface TeamMemberOption { id: string; full_name: string; color: string }
interface PatientOption { id: string; first_name: string; last_name: string | null }

const props = defineProps<{
  rooms: RoomOption[]
  appointmentTypes: AppointmentTypeOption[]
  teamMembers: TeamMemberOption[]
  prefillDate?: string
  prefillTime?: string
  prefillRoomId?: string
  prefillPractitionerId?: string
}>()

const emit = defineEmits<{ close: []; saved: [] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const { fire } = useAutomations()

const activeTab = ref<'create' | 'availability'>('create')

function toDateInput(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const date = ref(props.prefillDate ?? toDateInput(new Date().toISOString()))
const time = ref(props.prefillTime ?? '09:00')
const roomId = ref(props.prefillRoomId ?? '')
const practitionerId = ref(props.prefillPractitionerId ?? '')
const appointmentTypeId = ref(props.appointmentTypes[0]?.id ?? '')
const note = ref('')
const repeat = ref<'none' | 'daily' | 'weekly' | 'monthly'>('none')
const error = ref('')
const saving = ref(false)

const headerLabel = computed(() => {
  const d = new Date(`${date.value}T${time.value}`)
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' })
  const month = d.toLocaleDateString('en-US', { month: 'short' })
  const timeLabel = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  return `${weekday}, ${month} ${d.getDate()}, ${d.getFullYear()} at ${timeLabel}`
})
const roomLabel = computed(() => props.rooms.find((r) => r.id === roomId.value)?.name ?? null)

const overrides = ref<AppointmentTypeOverride[]>([])
onMounted(async () => {
  const { data } = await supabase.from('appointment_type_overrides').select('appointment_type_id, team_member_id, duration_minutes, price_cents')
  overrides.value = data ?? []
})

const selectedAppointmentType = computed(() => props.appointmentTypes.find((t) => t.id === appointmentTypeId.value))
const duration = computed(() =>
  selectedAppointmentType.value ? effectiveDuration(selectedAppointmentType.value.duration_minutes, appointmentTypeId.value, practitionerId.value, overrides.value) : 30,
)
const effectivePrice = computed(() =>
  selectedAppointmentType.value ? effectivePriceCents(selectedAppointmentType.value.default_price_cents, appointmentTypeId.value, practitionerId.value, overrides.value) : 0,
)

// -- Patient: existing (search) or new (inline mini-form) -----------------
const patientMode = ref<'existing' | 'new'>('existing')
const patientQuery = ref('')
const searchResults = ref<PatientOption[]>([])
let searchTimer: ReturnType<typeof setTimeout>
watch(patientQuery, (q) => {
  clearTimeout(searchTimer)
  if (!q.trim()) {
    searchResults.value = []
    return
  }
  searchTimer = setTimeout(async () => {
    const { data } = await supabase
      .from('patients')
      .select('id, first_name, last_name')
      .ilike('search_name', `%${normalizeSearchTerm(q.trim())}%`)
      .order('first_name')
      .limit(20)
    searchResults.value = data ?? []
  }, 250)
})
const selectedPatient = ref<PatientOption | null>(null)
function selectPatient(p: PatientOption) {
  selectedPatient.value = p
  patientQuery.value = ''
  searchResults.value = []
}

const newPatientFirstName = ref('')
const newPatientLastName = ref('')
const newPatientEmail = ref('')
const newPatientPhone = ref('')

// -- Collect Payment --------------------------------------------------
const collectPayment = ref(false)
const paymentAmount = ref('')
const paymentMethod = ref<'cash' | 'card' | 'credit'>('cash')
watch([collectPayment, effectivePrice], ([on]) => {
  if (on) paymentAmount.value = (effectivePrice.value / 100).toFixed(2)
})

async function save() {
  error.value = ''
  if (patientMode.value === 'existing' ? !selectedPatient.value : !newPatientFirstName.value.trim()) {
    error.value = patientMode.value === 'existing' ? 'Select a patient.' : "Enter the new patient's first name."
    return
  }
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
      })
      .select('id')
      .single()
    if (patientError || !newPatient) {
      error.value = patientError?.message ?? 'Could not create patient.'
      saving.value = false
      return
    }
    patientId = newPatient.id
    if (newPatientPhone.value.trim()) {
      await supabase.from('patient_contact_numbers').insert({
        account_id: store.accountId!,
        patient_id: patientId,
        country_code: 'ES',
        number: newPatientPhone.value.trim(),
      })
    }
  }

  const startsAt = new Date(`${date.value}T${time.value}`)
  const hours = store.currentClinic?.business_hours
  if (hasBusinessHoursConfigured(hours) && !isWithinBusinessHours(startsAt, hours)) {
    if (!confirm("This appointment falls outside the clinic's working hours. Book it anyway?")) {
      saving.value = false
      return
    }
  }

  // Repeat is intentionally bounded rather than open-ended -- 8 occurrences
  // covers a typical short care-plan block without ever silently filling a
  // patient's calendar for months from one click.
  const REPEAT_OCCURRENCES = 8
  const stepDays = { none: 0, daily: 1, weekly: 7, monthly: 30 }[repeat.value]
  const occurrences = repeat.value === 'none' ? 1 : REPEAT_OCCURRENCES

  let firstAppointmentId: string | null = null
  for (let i = 0; i < occurrences; i++) {
    const occStart = new Date(startsAt.getTime() + i * stepDays * 24 * 60 * 60 * 1000)
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
      error.value = apptError?.message ?? 'Could not create appointment.'
      saving.value = false
      return
    }
    if (i === 0) firstAppointmentId = created.id
    fire('appointment.booked', { patientId, appointmentId: created.id })
    useStaffFetch('/api/appointments/send-confirmation', { method: 'POST', body: { appointmentId: created.id } }).catch(() => {})
  }

  if (collectPayment.value && firstAppointmentId) {
    const amountCents = Math.round((parseFloat(paymentAmount.value) || 0) * 100)
    if (amountCents > 0) {
      const { count } = await supabase.from('invoices').select('id', { count: 'exact', head: true })
      const invoiceNumber = `INV-${String((count ?? 0) + 1).padStart(4, '0')}`
      const { data: invoice } = await supabase
        .from('invoices')
        .insert({
          account_id: store.accountId!,
          patient_id: patientId,
          appointment_id: firstAppointmentId,
          invoice_number: invoiceNumber,
          status: 'paid',
          total_cents: amountCents,
        })
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
          await supabase.from('payments').insert({ account_id: store.accountId!, invoice_id: invoice.id, amount_cents: amountCents, method: 'credit' })
          await supabase.from('account_credits').insert({
            account_id: store.accountId!,
            patient_id: patientId,
            amount_cents: -amountCents,
            reason: `Applied to invoice ${invoiceNumber}`,
            invoice_id: invoice.id,
            created_by: store.teamMember?.id ?? null,
          })
        } else {
          await supabase.from('payments').insert({ account_id: store.accountId!, invoice_id: invoice.id, amount_cents: amountCents, method: paymentMethod.value })
        }
      }
    }
  }

  saving.value = false
  emit('saved')
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex justify-end bg-ink-900/30" @click.self="emit('close')">
    <div class="flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-line bg-surface p-6 shadow-popover">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="flex items-center gap-1.5 text-[16px] font-[640] text-ink-900">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" class="shrink-0 text-ink-muted2" aria-hidden="true">
              <rect x="2" y="3" width="12" height="11" rx="1.3" />
              <path d="M2 6.5h12M5 1.5v3M11 1.5v3" stroke-linecap="round" />
            </svg>
            {{ headerLabel }}
          </h2>
          <p v-if="roomLabel" class="mt-0.5 text-[12.5px] text-ink-muted2">{{ roomLabel }}</p>
        </div>
        <button type="button" class="text-ink-faint hover:text-ink-600" @click="emit('close')">✕</button>
      </div>

      <div class="mt-4 flex gap-1 border-b border-line">
        <button
          v-for="tab in (['create', 'availability'] as const)"
          :key="tab"
          type="button"
          class="-mb-px border-b-2 px-3 py-2 text-[13px] font-medium"
          :class="activeTab === tab ? 'border-brand text-brand-text' : 'border-transparent text-ink-muted2 hover:text-ink-600'"
          @click="activeTab = tab"
        >
          {{ tab === 'create' ? 'Create Appointment' : 'Availability Manager' }}
        </button>
      </div>

      <form v-if="activeTab === 'create'" class="mt-4 space-y-4" @submit.prevent="save">
        <div>
          <label class="block text-[12.5px] font-medium text-ink-600">Appointment Type</label>
          <select v-model="appointmentTypeId" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none">
            <option value="">No type</option>
            <option v-for="t in appointmentTypes" :key="t.id" :value="t.id">{{ t.name }} ({{ effectiveDuration(t.duration_minutes, t.id, practitionerId, overrides) }} min)</option>
          </select>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-[12.5px] font-medium text-ink-600">Date</label>
            <input v-model="date" type="date" required class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
          </div>
          <div>
            <label class="block text-[12.5px] font-medium text-ink-600">Time</label>
            <input v-model="time" type="time" required class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-[12.5px] font-medium text-ink-600">Room</label>
            <select v-model="roomId" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none">
              <option value="">No room</option>
              <option v-for="r in rooms" :key="r.id" :value="r.id">{{ r.name }}</option>
            </select>
          </div>
          <div>
            <label class="block text-[12.5px] font-medium text-ink-600">Practitioner</label>
            <select v-model="practitionerId" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none">
              <option value="">Unassigned</option>
              <option v-for="m in teamMembers" :key="m.id" :value="m.id">{{ m.full_name }}</option>
            </select>
          </div>
        </div>

        <div>
          <label class="block text-[12.5px] font-medium text-ink-600">Patient</label>
          <div class="mt-1 flex gap-2">
            <button
              type="button"
              class="flex flex-1 items-center justify-center gap-1.5 rounded-ctl border px-3 py-2 text-[13px] font-medium"
              :class="patientMode === 'existing' ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-600 hover:bg-surface-subtle'"
              @click="patientMode = 'existing'"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" class="shrink-0" aria-hidden="true">
                <circle cx="6.8" cy="6.8" r="4.3" />
                <path d="M13 13l-3-3" stroke-linecap="round" />
              </svg>
              Existing Patient
            </button>
            <button
              type="button"
              class="flex flex-1 items-center justify-center gap-1.5 rounded-ctl border px-3 py-2 text-[13px] font-medium"
              :class="patientMode === 'new' ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-600 hover:bg-surface-subtle'"
              @click="patientMode = 'new'"
            >
              + New Patient
            </button>
          </div>

          <template v-if="patientMode === 'existing'">
            <input
              v-model="patientQuery"
              type="text"
              :placeholder="selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name ?? ''}` : 'Search by name, phone, or email…'"
              class="mt-2 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none"
            />
            <ul v-if="patientQuery" class="mt-1 max-h-40 overflow-y-auto rounded-ctl border border-line">
              <li v-for="p in searchResults" :key="p.id" class="cursor-pointer px-3 py-1.5 text-[13px] text-ink-700 hover:bg-surface-subtle" @click="selectPatient(p)">
                {{ p.first_name }} {{ p.last_name }}
              </li>
              <li v-if="searchResults.length === 0" class="px-3 py-1.5 text-[13px] text-ink-faint">No matches</li>
            </ul>
            <p v-if="selectedPatient && !patientQuery" class="mt-1 text-[12.5px] text-ink-muted2">
              Selected: <span class="font-medium text-ink-900">{{ selectedPatient.first_name }} {{ selectedPatient.last_name }}</span>
            </p>
          </template>

          <div v-else class="mt-2 grid grid-cols-2 gap-2">
            <input v-model="newPatientFirstName" type="text" placeholder="First name" required class="rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
            <input v-model="newPatientLastName" type="text" placeholder="Last name" class="rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
            <input v-model="newPatientEmail" type="email" placeholder="Email" class="rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
            <input v-model="newPatientPhone" type="tel" placeholder="Phone" class="rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
          </div>
        </div>

        <div>
          <label class="block text-[12.5px] font-medium text-ink-600">Note (Optional)</label>
          <textarea v-model="note" rows="2" placeholder="Any additional notes…" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
        </div>

        <div>
          <label class="block text-[12.5px] font-medium text-ink-600">Repeat</label>
          <select v-model="repeat" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none">
            <option value="none">Does not repeat</option>
            <option value="daily">Daily (8 occurrences)</option>
            <option value="weekly">Weekly (8 occurrences)</option>
            <option value="monthly">Monthly (8 occurrences)</option>
          </select>
        </div>

        <div class="flex items-center justify-between">
          <label class="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-600">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" class="shrink-0" aria-hidden="true">
              <rect x="1.5" y="3.5" width="13" height="9" rx="1.3" />
              <path d="M1.5 6.5h13" />
            </svg>
            Collect Payment
          </label>
          <button
            type="button"
            role="switch"
            :aria-checked="collectPayment"
            class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
            :class="collectPayment ? 'bg-brand' : 'bg-toggle-off'"
            @click="collectPayment = !collectPayment"
          >
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform" :class="collectPayment ? 'translate-x-[18px]' : 'translate-x-0.5'" />
          </button>
        </div>

        <div v-if="collectPayment" class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-[12.5px] font-medium text-ink-600">Amount (€)</label>
            <input v-model="paymentAmount" type="number" min="0" step="0.01" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
          </div>
          <div>
            <label class="block text-[12.5px] font-medium text-ink-600">Method</label>
            <select v-model="paymentMethod" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none">
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="credit">Credit on account</option>
            </select>
          </div>
        </div>

        <p v-if="error" class="text-[13px] text-danger-text">{{ error }}</p>

        <div class="flex justify-end gap-2 pt-2">
          <UiBtn variant="secondary" :disabled="saving" @click="emit('close')">Cancel</UiBtn>
          <UiBtn variant="primary" :disabled="saving" @click="save">{{ saving ? 'Creating…' : 'Create' }}</UiBtn>
        </div>
      </form>

      <div v-else class="mt-4">
        <CalendarAvailabilityBlockInline :rooms="rooms" :prefill-date="date" :prefill-time="time" :prefill-room-id="roomId" @close="emit('close')" @saved="emit('saved')" />
      </div>
    </div>
  </div>
</template>

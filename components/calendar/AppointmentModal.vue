<script setup lang="ts">
import { hasBusinessHoursConfigured, isWithinBusinessHours } from '~/utils/businessHours'
import { computeBonoStatus } from '~/utils/bonoStatus'
import { effectiveDuration, effectivePriceCents, type AppointmentTypeOverride } from '~/utils/appointmentOverrides'
import { normalizeSearchTerm } from '~/utils/searchText'

interface RoomOption { id: string; name: string }
interface AppointmentTypeOption { id: string; name: string; duration_minutes: number; color: string; default_price_cents: number }
interface TeamMemberOption { id: string; full_name: string; color: string }
interface PatientOption { id: string; first_name: string; last_name: string | null }

interface EditingAppointment {
  id: string
  patient_id: string
  room_id: string | null
  practitioner_id: string | null
  appointment_type_id: string | null
  starts_at: string
  ends_at: string
  status: string
}

const props = defineProps<{
  mode: 'create' | 'edit'
  rooms: RoomOption[]
  appointmentTypes: AppointmentTypeOption[]
  teamMembers: TeamMemberOption[]
  appointment?: EditingAppointment
  prefillDate?: string
  prefillTime?: string
  prefillRoomId?: string
  initialTab?: 'details' | 'billing' | 'history' | 'notes'
}>()

const emit = defineEmits<{ close: []; saved: [] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const { fire } = useAutomations()

function toDateInput(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function toTimeInput(iso: string) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function minutesBetween(startIso: string, endIso: string) {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000)
}

const activeTab = ref<'details' | 'billing' | 'history' | 'notes'>(props.initialTab ?? 'details')

const patientId = ref(props.appointment?.patient_id ?? '')
const patientQuery = ref('')
const roomId = ref(props.appointment?.room_id ?? props.prefillRoomId ?? props.rooms[0]?.id ?? '')
const practitionerId = ref(props.appointment?.practitioner_id ?? '')
const appointmentTypeId = ref(props.appointment?.appointment_type_id ?? '')
const date = ref(props.appointment ? toDateInput(props.appointment.starts_at) : (props.prefillDate ?? toDateInput(new Date().toISOString())))
const time = ref(props.appointment ? toTimeInput(props.appointment.starts_at) : (props.prefillTime ?? '09:00'))
const duration = ref(props.appointment ? minutesBetween(props.appointment.starts_at, props.appointment.ends_at) : 30)
const status = ref(props.appointment?.status ?? 'booked')
const error = ref('')
const saving = ref(false)

// Small, account-wide, bounded by types x practitioners -- unlike the
// patient search below, safe to just bulk-fetch once.
const overrides = ref<AppointmentTypeOverride[]>([])
onMounted(async () => {
  const { data } = await supabase.from('appointment_type_overrides').select('appointment_type_id, team_member_id, duration_minutes, price_cents')
  overrides.value = data ?? []
})

watch([appointmentTypeId, practitionerId], ([typeId, practId]) => {
  const type = props.appointmentTypes.find((t) => t.id === typeId)
  if (type) duration.value = effectiveDuration(type.duration_minutes, typeId, practId, overrides.value)
})

// Patients aren't preloaded -- an account can have thousands, and PostgREST
// silently caps an unfiltered/unlimited select well under that, which used
// to make patients past the cap unfindable here even though they showed up
// fine in the (already server-side-searched) command palette. Searches the
// DB directly instead, same approach as AppCommandPalette.vue.
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
const selectedPatientLabel = computed(() => (selectedPatient.value ? `${selectedPatient.value.first_name} ${selectedPatient.value.last_name ?? ''}` : ''))

function selectPatient(p: PatientOption) {
  patientId.value = p.id
  selectedPatient.value = p
  patientQuery.value = ''
}

// Editing an existing appointment starts with a patient already selected,
// so fetch just that one record for the label instead of searching.
if (props.appointment?.patient_id) {
  supabase
    .from('patients')
    .select('id, first_name, last_name')
    .eq('id', props.appointment.patient_id)
    .single()
    .then(({ data }) => {
      if (data) selectedPatient.value = data
    })
}

const selectedAppointmentType = computed(() => props.appointmentTypes.find((t) => t.id === appointmentTypeId.value))
const effectivePrice = computed(() =>
  selectedAppointmentType.value
    ? effectivePriceCents(selectedAppointmentType.value.default_price_cents, appointmentTypeId.value, practitionerId.value, overrides.value)
    : 0,
)

// Only loads once a patient is actually selected -- usePatientFinancialSummary
// no-ops on an empty id, and re-fetches automatically as patientId changes.
const { loading: bonoLoading, balanceCents, activePackages } = usePatientFinancialSummary(patientId)
const bonoStatus = computed(() =>
  computeBonoStatus({
    balanceCents: balanceCents.value,
    activePackage: activePackages.value[0]
      ? { sessionsTotal: activePackages.value[0].sessions_total, sessionsUsed: activePackages.value[0].sessions_used, priceCents: activePackages.value[0].price_cents }
      : null,
    appointmentPriceCents: effectivePrice.value,
  }),
)

async function save() {
  error.value = ''
  if (!patientId.value) {
    error.value = 'Select a patient.'
    return
  }
  saving.value = true

  const startsAt = new Date(`${date.value}T${time.value}`)
  const endsAt = new Date(startsAt.getTime() + duration.value * 60000)

  const hours = store.currentClinic?.business_hours
  if (hasBusinessHoursConfigured(hours) && (!isWithinBusinessHours(startsAt, hours) || !isWithinBusinessHours(new Date(endsAt.getTime() - 1), hours))) {
    if (!confirm('This appointment falls outside the clinic\'s working hours. Book it anyway?')) {
      saving.value = false
      return
    }
  }

  const timeChanged = props.mode === 'edit' && (startsAt.toISOString() !== props.appointment!.starts_at || endsAt.toISOString() !== props.appointment!.ends_at)

  const payload = {
    account_id: store.accountId!,
    clinic_id: store.currentClinicId!,
    patient_id: patientId.value,
    room_id: roomId.value || null,
    practitioner_id: practitionerId.value || null,
    appointment_type_id: appointmentTypeId.value || null,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    status: status.value,
    ...(timeChanged ? { rescheduled: true } : {}),
  }

  const result = props.mode === 'create'
    ? await supabase.from('appointments').insert(payload).select('id').single()
    : await supabase.from('appointments').update(payload).eq('id', props.appointment!.id)

  saving.value = false
  if (result.error) {
    error.value = result.error.message
    return
  }

  if (props.mode === 'create') {
    const newId = (result.data as { id: string } | null)?.id
    if (newId) {
      fire('appointment.booked', { patientId: patientId.value, appointmentId: newId })
      useStaffFetch('/api/appointments/send-confirmation', { method: 'POST', body: { appointmentId: newId } }).catch(() => {})
    }
  } else {
    if (status.value !== props.appointment!.status) {
      const trigger = { completed: 'appointment.completed', cancelled: 'appointment.cancelled', no_show: 'appointment.no_show' }[status.value]
      if (trigger) fire(trigger, { patientId: patientId.value, appointmentId: props.appointment!.id })
      await maybeApplyStatusFee(status.value)
    }
    // Independent of the status check above -- a save can change both the
    // time and the status at once, and each should fire its own automation.
    if (timeChanged) fire('appointment.rescheduled', { patientId: patientId.value, appointmentId: props.appointment!.id })
  }
  emit('saved')
}

// Cancellation/missed-appointment fees from Settings > Scheduling Policies.
// A plain confirm() rather than a full dialog like the reschedule one --
// there's no reason/note/next-appointment context to show here, just "charge
// the configured fee or not."
async function maybeApplyStatusFee(newStatus: string) {
  const feeColumn = newStatus === 'cancelled' ? 'cancellation_fee_cents' : newStatus === 'no_show' ? 'missed_appointment_fee_cents' : null
  if (!feeColumn) return
  const { data: account } = await supabase.from('accounts').select(feeColumn).eq('id', store.accountId!).maybeSingle()
  const feeCents = (account as Record<string, number | null> | null)?.[feeColumn]
  if (!feeCents) return

  const label = newStatus === 'cancelled' ? 'cancellation' : 'missed appointment'
  if (!confirm(`Apply the €${(feeCents / 100).toFixed(2)} ${label} fee to this patient's account?`)) return

  const { count } = await supabase.from('invoices').select('id', { count: 'exact', head: true })
  const invoiceNumber = `INV-${String((count ?? 0) + 1).padStart(4, '0')}`
  const { data: invoice } = await supabase
    .from('invoices')
    .insert({ account_id: store.accountId!, patient_id: patientId.value, invoice_number: invoiceNumber, status: 'unpaid', total_cents: feeCents })
    .select('id')
    .single()
  if (!invoice) return
  await supabase.from('invoice_line_items').insert({
    account_id: store.accountId!,
    invoice_id: invoice.id,
    description: newStatus === 'cancelled' ? 'Cancellation fee' : 'Missed appointment fee',
    quantity: 1,
    price_cents: feeCents,
  })
}

async function remove() {
  if (!props.appointment) return
  if (!confirm('Delete this appointment?')) return
  saving.value = true
  // Soft delete -- the calendar's "Hide deleted" toggle needs a real record
  // to hide rather than nothing at all, same idea as `rescheduled` already
  // being a flag instead of a hard state change.
  const { error: deleteError } = await supabase.from('appointments').update({ deleted_at: new Date().toISOString() }).eq('id', props.appointment.id)
  saving.value = false
  if (deleteError) {
    error.value = deleteError.message
    return
  }
  emit('saved')
}

</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/30 p-4" @click.self="emit('close')">
    <div class="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-card border border-line bg-surface p-6 shadow-popover">
      <div class="flex items-center justify-between">
        <h2 class="text-[16px] font-[640] text-ink-900">
          {{ mode === 'create' ? 'New Appointment' : 'Edit Appointment' }}
        </h2>
        <button type="button" class="text-ink-faint hover:text-ink-600" @click="emit('close')">✕</button>
      </div>

      <div v-if="mode === 'edit'" class="mt-4 flex gap-1 border-b border-line">
        <button
          v-for="tab in (['details', 'billing', 'history', 'notes'] as const)"
          :key="tab"
          type="button"
          class="-mb-px border-b-2 px-3 py-2 text-[13px] font-medium capitalize"
          :class="activeTab === tab ? 'border-brand text-brand-text' : 'border-transparent text-ink-muted2 hover:text-ink-600'"
          @click="activeTab = tab"
        >
          {{ tab }}
        </button>
      </div>

      <form v-if="mode === 'create' || activeTab === 'details'" class="mt-4 space-y-4" @submit.prevent="save">
        <div>
          <label class="block text-[12.5px] font-medium text-ink-600">Patient</label>
          <input
            v-model="patientQuery"
            type="text"
            :placeholder="selectedPatientLabel || 'Search patients…'"
            class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none"
          />
          <ul v-if="patientQuery" class="mt-1 max-h-40 overflow-y-auto rounded-ctl border border-line">
            <li
              v-for="p in searchResults"
              :key="p.id"
              class="cursor-pointer px-3 py-1.5 text-[13px] text-ink-700 hover:bg-surface-subtle"
              @click="selectPatient(p)"
            >
              {{ p.first_name }} {{ p.last_name }}
            </li>
            <li v-if="searchResults.length === 0" class="px-3 py-1.5 text-[13px] text-ink-faint">No matches</li>
          </ul>
          <p v-if="selectedPatientLabel && !patientQuery" class="mt-1 text-[12.5px] text-ink-muted2">
            Selected: <span class="font-medium text-ink-900">{{ selectedPatientLabel }}</span>
            <NuxtLink :to="`/patients/${patientId}`" target="_blank" class="ml-2 text-brand-text hover:text-brand-hover">View patient &rarr;</NuxtLink>
          </p>
          <BonoStatusBadge v-if="patientId && !bonoLoading" class="mt-2" :tone="bonoStatus.tone" :label="bonoStatus.label" />
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
            <label class="block text-[12.5px] font-medium text-ink-600">Duration (min)</label>
            <input v-model.number="duration" type="number" min="5" step="5" required class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
          </div>
          <div>
            <label class="block text-[12.5px] font-medium text-ink-600">Type</label>
            <select v-model="appointmentTypeId" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none">
              <option value="">No type</option>
              <option v-for="t in appointmentTypes" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
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

        <div v-if="mode === 'edit'">
          <label class="block text-[12.5px] font-medium text-ink-600">Status</label>
          <select v-model="status" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none">
            <option value="booked">Booked</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="no_show">No show</option>
          </select>
        </div>

        <p v-if="error" class="text-[13px] text-danger-text">{{ error }}</p>

        <div class="flex items-center justify-between">
          <div class="flex gap-3">
            <UiBtn variant="primary" :disabled="saving" @click="save">
              {{ saving ? 'Saving…' : 'Save' }}
            </UiBtn>
            <UiBtn variant="secondary" @click="emit('close')">
              Cancel
            </UiBtn>
          </div>
          <button v-if="mode === 'edit'" type="button" class="text-[13px] font-medium text-danger-text hover:opacity-80" @click="remove">
            Delete
          </button>
        </div>
      </form>

      <div v-if="mode === 'edit' && activeTab === 'billing'" class="mt-4">
        <CalendarAppointmentBillingTab
          :appointment-id="appointment!.id"
          :patient-id="appointment!.patient_id"
          :appointment-type-name="selectedAppointmentType?.name"
          :appointment-type-price-cents="effectivePrice"
          @completed="status = 'completed'"
        />
      </div>

      <div v-if="mode === 'edit' && activeTab === 'history'" class="mt-4">
        <CalendarAppointmentHistoryTab :patient-id="appointment!.patient_id" :exclude-appointment-id="appointment!.id" />
      </div>

      <div v-if="mode === 'edit' && activeTab === 'notes'" class="mt-4">
        <AppointmentsNotesPanel :appointment-id="appointment!.id" />
      </div>
    </div>
  </div>
</template>

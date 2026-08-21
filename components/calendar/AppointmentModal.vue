<script setup lang="ts">
import { hasBusinessHoursConfigured, isWithinBusinessHours } from '~/utils/businessHours'

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
  patients: PatientOption[]
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

watch(appointmentTypeId, (id) => {
  const type = props.appointmentTypes.find((t) => t.id === id)
  if (type) duration.value = type.duration_minutes
})

const filteredPatients = computed(() => {
  if (!patientQuery.value) return props.patients.slice(0, 20)
  const q = patientQuery.value.toLowerCase()
  return props.patients
    .filter((p) => `${p.first_name} ${p.last_name ?? ''}`.toLowerCase().includes(q))
    .slice(0, 20)
})

const selectedPatientLabel = computed(() => {
  const p = props.patients.find((p) => p.id === patientId.value)
  return p ? `${p.first_name} ${p.last_name ?? ''}` : ''
})

const selectedAppointmentType = computed(() => props.appointmentTypes.find((t) => t.id === appointmentTypeId.value))

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
    if (newId) fire('appointment.booked', { patientId: patientId.value, appointmentId: newId })
  } else if (status.value !== props.appointment!.status) {
    const trigger = { completed: 'appointment.completed', cancelled: 'appointment.cancelled', no_show: 'appointment.no_show' }[status.value]
    if (trigger) fire(trigger, { patientId: patientId.value, appointmentId: props.appointment!.id })
  }
  emit('saved')
}

async function remove() {
  if (!props.appointment) return
  if (!confirm('Delete this appointment?')) return
  saving.value = true
  const { error: deleteError } = await supabase.from('appointments').delete().eq('id', props.appointment.id)
  saving.value = false
  if (deleteError) {
    error.value = deleteError.message
    return
  }
  emit('saved')
}

</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-ink-900/30 p-4" @click.self="emit('close')">
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
              v-for="p in filteredPatients"
              :key="p.id"
              class="cursor-pointer px-3 py-1.5 text-[13px] text-ink-700 hover:bg-surface-subtle"
              @click="patientId = p.id; patientQuery = ''"
            >
              {{ p.first_name }} {{ p.last_name }}
            </li>
            <li v-if="filteredPatients.length === 0" class="px-3 py-1.5 text-[13px] text-ink-faint">No matches</li>
          </ul>
          <p v-if="selectedPatientLabel && !patientQuery" class="mt-1 text-[12.5px] text-ink-muted2">
            Selected: <span class="font-medium text-ink-900">{{ selectedPatientLabel }}</span>
            <NuxtLink :to="`/patients/${patientId}`" target="_blank" class="ml-2 text-brand-text hover:text-brand-hover">View patient &rarr;</NuxtLink>
          </p>
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
          :appointment-type-price-cents="selectedAppointmentType?.default_price_cents"
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

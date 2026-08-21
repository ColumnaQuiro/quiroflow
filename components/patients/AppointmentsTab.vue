<script setup lang="ts">
const props = defineProps<{ patientId: string; firstName?: string; lastName?: string | null; preferredLanguage?: string }>()

interface AppointmentRow {
  id: string
  starts_at: string
  status: string
  practitioner_name: string | null
  appointment_types: { name: string } | null
  team_members: { full_name: string } | null
  calendar_resources: { name: string } | null
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const appointments = ref<AppointmentRow[]>([])
const loading = ref(true)

onMounted(async () => {
  const { data } = await supabase
    .from('appointments')
    .select('id, starts_at, status, practitioner_name, appointment_types(name), team_members(full_name), calendar_resources(name)')
    .eq('patient_id', props.patientId)
    .order('starts_at', { ascending: false })
  appointments.value = (data as unknown as AppointmentRow[]) ?? []
  loading.value = false
})

function practitionerLabel(appt: AppointmentRow) {
  return appt.team_members?.full_name ?? appt.practitioner_name ?? 'N/A'
}

function isUpcoming(appt: AppointmentRow) {
  return appt.status === 'booked' && new Date(appt.starts_at) > new Date()
}

const notesAppointmentId = ref<string | null>(null)
const confirmingAppointment = ref<AppointmentRow | null>(null)
const confirmationAutofill = computed<Record<string, string>>(() => {
  if (!confirmingAppointment.value) return {} as Record<string, string>
  const starts = new Date(confirmingAppointment.value.starts_at)
  return {
    appointment_date: starts.toLocaleDateString(),
    appointment_time: starts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }
})
</script>

<template>
  <div>
    <PatientsPhaseStats :patient-id="patientId" />

    <div class="rounded-lg border border-gray-200 bg-white">
    <div v-if="loading" class="p-6 text-center text-sm text-gray-400">Loading…</div>
    <div v-else-if="appointments.length === 0" class="p-8 text-center text-sm text-gray-400">
      No appointments yet.
    </div>
    <table v-else class="w-full text-sm">
      <thead class="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
        <tr>
          <th class="px-4 py-2">Date</th>
          <th class="px-4 py-2">Type</th>
          <th class="px-4 py-2">Practitioner</th>
          <th class="px-4 py-2">Room</th>
          <th class="px-4 py-2">Status</th>
          <th class="px-4 py-2"></th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
        <tr v-for="appt in appointments" :key="appt.id">
          <td class="px-4 py-2.5 text-gray-900">{{ new Date(appt.starts_at).toLocaleString() }}</td>
          <td class="px-4 py-2.5 text-gray-500">{{ appt.appointment_types?.name ?? 'N/A' }}</td>
          <td class="px-4 py-2.5 text-gray-500">{{ practitionerLabel(appt) }}</td>
          <td class="px-4 py-2.5 text-gray-500">{{ appt.calendar_resources?.name ?? '—' }}</td>
          <td class="px-4 py-2.5 text-gray-500">{{ appt.status }}</td>
          <td class="px-4 py-2.5 text-right">
            <div class="flex items-center justify-end gap-2">
              <button type="button" class="text-xs font-medium text-indigo-600 hover:text-indigo-500" @click="notesAppointmentId = appt.id">
                Notes
              </button>
              <button
                v-if="isUpcoming(appt)"
                type="button"
                class="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
                @click="confirmingAppointment = appt"
              >
                Send Confirmation
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    </div>

    <div v-if="notesAppointmentId" class="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" @click.self="notesAppointmentId = null">
      <div class="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-gray-900">Visit notes</h2>
          <button type="button" class="text-gray-400 hover:text-gray-600" @click="notesAppointmentId = null">✕</button>
        </div>
        <div class="mt-4">
          <AppointmentsNotesPanel :appointment-id="notesAppointmentId" />
        </div>
      </div>
    </div>

    <SendWhatsAppModal
      v-if="confirmingAppointment"
      :patient-id="patientId"
      :patient-first-name="firstName ?? ''"
      :patient-preferred-language="preferredLanguage"
      :appointment-id="confirmingAppointment.id"
      :default-template-name="store.whatsappConfirmationTemplateName"
      :autofill="confirmationAutofill"
      :allow-template-override="false"
      @close="confirmingAppointment = null"
    />
  </div>
</template>

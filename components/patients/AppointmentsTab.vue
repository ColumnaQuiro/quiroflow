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

const counts = ref({ completed: 0, cancelled: 0, no_show: 0 })
const showPercentage = computed(() => {
  const denom = counts.value.completed + counts.value.no_show
  if (denom === 0) return null
  return Math.round((counts.value.completed / denom) * 100)
})

async function load() {
  const { data } = await supabase
    .from('appointments')
    .select('id, starts_at, status, practitioner_name, appointment_types(name), team_members(full_name), calendar_resources(name)')
    .eq('patient_id', props.patientId)
    .is('deleted_at', null)
    .order('starts_at', { ascending: false })
  appointments.value = (data as unknown as AppointmentRow[]) ?? []

  const nextCounts = { completed: 0, cancelled: 0, no_show: 0 }
  for (const a of appointments.value) {
    if (a.status in nextCounts) (nextCounts as Record<string, number>)[a.status]++
  }
  counts.value = nextCounts

  loading.value = false
}
onMounted(load)

function practitionerLabel(appt: AppointmentRow) {
  return appt.team_members?.full_name ?? appt.practitioner_name ?? 'N/A'
}

function isUpcoming(appt: AppointmentRow) {
  return appt.status === 'booked' && new Date(appt.starts_at) > new Date()
}

const statusTone: Record<string, 'success' | 'warning' | 'danger' | 'brand' | 'neutral'> = {
  completed: 'success',
  cancelled: 'warning',
  no_show: 'danger',
  booked: 'brand',
}
const statusLabel: Record<string, string> = {
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'Missed',
  booked: 'Booked',
}

const sendMenuOpen = ref(false)
const sending = ref(false)
const sendMessage = ref('')
async function sendHistory(channel: 'email' | 'whatsapp') {
  sendMenuOpen.value = false
  sending.value = true
  sendMessage.value = ''
  try {
    await useStaffFetch(`/api/patients/${props.patientId}/appointment-history/${channel === 'email' ? 'send' : 'send-whatsapp'}`, { method: 'POST' })
    sendMessage.value = `Sent by ${channel === 'email' ? 'email' : 'WhatsApp'}.`
  } catch (e: any) {
    sendMessage.value = e?.data?.statusMessage ?? 'Failed to send.'
  }
  sending.value = false
  setTimeout(() => (sendMessage.value = ''), 4000)
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
  <div class="space-y-4">
    <div class="grid grid-cols-4 gap-3">
      <div class="rounded-card border border-line bg-surface p-4 shadow-card">
        <p class="text-[11.5px] text-ink-muted2">Completed</p>
        <p class="mt-1 font-mono text-[20px] font-semibold text-success-text">{{ loading ? '—' : counts.completed }}</p>
      </div>
      <div class="rounded-card border border-line bg-surface p-4 shadow-card">
        <p class="text-[11.5px] text-ink-muted2">Cancelled</p>
        <p class="mt-1 font-mono text-[20px] font-semibold text-warning-accent">{{ loading ? '—' : counts.cancelled }}</p>
      </div>
      <div class="rounded-card border border-line bg-surface p-4 shadow-card">
        <p class="text-[11.5px] text-ink-muted2">Missed</p>
        <p class="mt-1 font-mono text-[20px] font-semibold text-danger-text">{{ loading ? '—' : counts.no_show }}</p>
      </div>
      <div class="rounded-card border border-line bg-surface p-4 shadow-card">
        <p class="text-[11.5px] text-ink-muted2">Show rate</p>
        <p class="mt-1 font-mono text-[20px] font-semibold text-ink-900">{{ loading || showPercentage === null ? '—' : `${showPercentage}%` }}</p>
      </div>
    </div>

    <div class="rounded-card border border-line bg-surface shadow-card">
      <div class="flex items-center justify-between border-b border-line-divider px-4 py-3">
        <p class="text-[13.5px] font-semibold text-ink-700">Visit history</p>
        <div class="flex items-center gap-2">
          <span v-if="sendMessage" class="text-[12px] text-ink-faint">{{ sendMessage }}</span>
          <div class="relative">
            <UiBtn variant="secondary" size="sm" :disabled="sending" @click="sendMenuOpen = !sendMenuOpen">{{ sending ? 'Sending…' : 'Send history' }}</UiBtn>
            <div v-if="sendMenuOpen" class="absolute right-0 z-10 mt-1 w-36 rounded-ctl border border-line bg-surface py-1 shadow-popover">
              <button type="button" class="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink-700 hover:bg-surface-subtle" @click="sendHistory('email')">Email</button>
              <button type="button" class="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink-700 hover:bg-surface-subtle" @click="sendHistory('whatsapp')">WhatsApp</button>
            </div>
          </div>
          <UiBtn variant="primary" size="sm" @click="navigateTo('/calendar')">Book visit</UiBtn>
        </div>
      </div>

      <div v-if="loading" class="p-8 text-center text-[13px] text-ink-faint">Loading…</div>
      <div v-else-if="appointments.length === 0" class="p-8 text-center text-[13px] text-ink-faint">No appointments yet.</div>
      <table v-else class="w-full text-[13px]">
        <thead class="border-b border-line-divider text-left text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          <tr>
            <th class="px-4 py-2">When</th>
            <th class="px-4 py-2">Type</th>
            <th class="px-4 py-2">Practitioner</th>
            <th class="px-4 py-2">Status</th>
            <th class="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line-row">
          <tr v-for="appt in appointments" :key="appt.id" class="h-[46px]">
            <td class="px-4 text-ink-700">
              {{ new Date(appt.starts_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }}
              <span v-if="appt.calendar_resources?.name" class="ml-1 text-ink-faint">&middot; {{ appt.calendar_resources.name }}</span>
            </td>
            <td class="px-4 text-ink-muted">{{ appt.appointment_types?.name ?? 'N/A' }}</td>
            <td class="px-4 text-ink-muted">{{ practitionerLabel(appt) }}</td>
            <td class="px-4">
              <UiPill :tone="statusTone[appt.status] ?? 'neutral'">{{ statusLabel[appt.status] ?? appt.status }}</UiPill>
            </td>
            <td class="px-4 text-right">
              <div class="flex items-center justify-end gap-3">
                <button type="button" class="text-[12px] font-medium text-brand-text hover:text-brand-hover" @click="notesAppointmentId = appt.id">
                  Notes
                </button>
                <UiBtn v-if="isUpcoming(appt)" size="sm" variant="secondary" @click="confirmingAppointment = appt">Send confirmation</UiBtn>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="notesAppointmentId" class="fixed inset-0 z-20 flex items-center justify-center bg-ink-900/40 p-4" @click.self="notesAppointmentId = null">
      <div class="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-card bg-surface p-6 shadow-drawer">
        <div class="flex items-center justify-between">
          <h2 class="text-[15px] font-semibold text-ink-900">Visit notes</h2>
          <button type="button" class="text-ink-faint hover:text-ink-600" @click="notesAppointmentId = null">✕</button>
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

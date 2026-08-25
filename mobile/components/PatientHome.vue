<script setup lang="ts">
const props = defineProps<{ patientId: string; patientFirstName: string }>()

interface AppointmentRow {
  id: string
  starts_at: string
  status: string
  appointment_types: { name: string } | null
}

const supabase = useSupabaseClient()
const { loading: financeLoading, balanceCents, activeMembership, activePackages } = usePatientFinancialSummary(() => props.patientId)

const appointmentsLoading = ref(true)
const appointments = ref<AppointmentRow[]>([])

async function loadAppointments() {
  appointmentsLoading.value = true
  const { data } = await supabase
    .from('appointments')
    .select('id, starts_at, status, appointment_types(name)')
    .eq('patient_id', props.patientId)
    .gte('starts_at', new Date().toISOString())
    .order('starts_at')
  appointments.value = (data as unknown as AppointmentRow[]) ?? []
  appointmentsLoading.value = false
}
onMounted(loadAppointments)
watch(() => props.patientId, loadAppointments)

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="flex-1 space-y-5 p-4">
    <h1 class="text-lg font-semibold text-ink-900">Hi, {{ patientFirstName }}</h1>

    <NuxtLink to="/messages" class="flex items-center justify-between rounded-card border border-line bg-surface px-4 py-3">
      <span class="text-[13.5px] font-medium text-ink-900">Messages</span>
      <span class="text-[13px] text-ink-faint">&rarr;</span>
    </NuxtLink>

    <section>
      <div class="flex items-center justify-between">
        <h2 class="text-[13px] font-semibold text-ink-700">Upcoming appointments</h2>
        <NuxtLink to="/book" class="text-[12.5px] font-medium text-brand-text">+ New</NuxtLink>
      </div>
      <div class="mt-2 overflow-hidden rounded-card border border-line bg-surface">
        <div v-if="appointmentsLoading" class="p-4 text-[13px] text-ink-faint">Loading…</div>
        <ul v-else-if="appointments.length > 0" class="divide-y divide-line">
          <li v-for="appt in appointments" :key="appt.id" class="px-4 py-3">
            <p class="text-[13.5px] font-medium text-ink-900">{{ formatDate(appt.starts_at) }}</p>
            <p class="text-[12.5px] text-ink-muted">{{ appt.appointment_types?.name ?? 'Appointment' }} &middot; {{ appt.status }}</p>
          </li>
        </ul>
        <p v-else class="p-4 text-center text-[13px] text-ink-faint">No upcoming appointments.</p>
      </div>
    </section>

    <section>
      <h2 class="text-[13px] font-semibold text-ink-700">Bono / balance</h2>
      <div class="mt-2 rounded-card border border-line bg-surface p-4">
        <div v-if="financeLoading" class="text-[13px] text-ink-faint">Loading…</div>
        <template v-else>
          <p v-if="balanceCents !== 0" class="text-[13px]" :class="balanceCents > 0 ? 'text-success-text' : 'text-danger-text'">
            {{ balanceCents > 0 ? `€${(balanceCents / 100).toFixed(2)} credit on account` : `€${(Math.abs(balanceCents) / 100).toFixed(2)} owed` }}
          </p>
          <p v-else class="text-[13px] text-ink-muted">Balance is settled.</p>

          <div v-if="activePackages.length > 0" class="mt-2 space-y-1 border-t border-line-divider pt-2">
            <p v-for="pkg in activePackages" :key="pkg.id" class="text-[12.5px] text-ink-muted">
              {{ pkg.package_name }} — {{ pkg.sessions_total - pkg.sessions_used }} of {{ pkg.sessions_total }} sessions left
            </p>
          </div>
          <p v-if="activeMembership" class="mt-2 border-t border-line-divider pt-2 text-[12.5px] text-ink-muted">
            {{ activeMembership.membership_name }} membership active
          </p>
        </template>
      </div>
    </section>

    <section>
      <h2 class="text-[13px] font-semibold text-ink-700">Care plan</h2>
      <div class="mt-2">
        <PatientsPhaseStats :patient-id="patientId" :editable="false" />
      </div>
    </section>
  </div>
</template>

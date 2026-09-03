<script setup lang="ts">
const props = defineProps<{ patientId: string; excludeAppointmentId?: string }>()
const supabase = useSupabaseClient()
const t = useT()

interface AppointmentRow {
  id: string
  starts_at: string
  status: string
  appointment_types: { name: string } | null
  team_members: { full_name: string } | null
}

const appointments = ref<AppointmentRow[]>([])
const loading = ref(true)

onMounted(async () => {
  const { data } = await supabase
    .from('appointments')
    .select('id, starts_at, status, appointment_types(name), team_members(full_name)')
    .eq('patient_id', props.patientId)
    .order('starts_at', { ascending: false })
    .limit(25)
  appointments.value = ((data as unknown as AppointmentRow[]) ?? []).filter((a) => a.id !== props.excludeAppointmentId)
  loading.value = false
})

const statusClass: Record<string, string> = {
  booked: 'bg-blue-50 text-blue-700',
  completed: 'bg-green-50 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
  no_show: 'bg-red-50 text-red-700',
}
</script>

<template>
  <div class="text-sm">
    <div v-if="loading" class="text-gray-400">{{ t('Loading…', 'Cargando…') }}</div>
    <p v-else-if="appointments.length === 0" class="text-gray-400">{{ t('No other appointments.', 'No hay otras citas.') }}</p>
    <ul v-else class="max-h-72 space-y-1.5 overflow-y-auto">
      <li v-for="appt in appointments" :key="appt.id" class="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2">
        <div>
          <p class="font-medium text-gray-900">
            {{ new Date(appt.starts_at).toLocaleDateString() }} &middot;
            {{ new Date(appt.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
          </p>
          <p class="text-xs text-gray-500">{{ appt.appointment_types?.name ?? t('N/A', 'N/D') }} &middot; {{ appt.team_members?.full_name ?? t('Unassigned', 'Sin asignar') }}</p>
        </div>
        <span class="rounded px-1.5 py-0.5 text-xs font-medium" :class="statusClass[appt.status] ?? 'bg-gray-100 text-gray-500'">{{ appt.status }}</span>
      </li>
    </ul>
  </div>
</template>

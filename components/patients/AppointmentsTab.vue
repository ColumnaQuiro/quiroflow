<script setup lang="ts">
const props = defineProps<{ patientId: string }>()

interface AppointmentRow {
  id: string
  starts_at: string
  status: string
  appointment_types: { name: string } | null
}

const supabase = useSupabaseClient()
const appointments = ref<AppointmentRow[]>([])
const loading = ref(true)

onMounted(async () => {
  const { data } = await supabase
    .from('appointments')
    .select('id, starts_at, status, appointment_types(name)')
    .eq('patient_id', props.patientId)
    .order('starts_at', { ascending: false })
  appointments.value = (data as unknown as AppointmentRow[]) ?? []
  loading.value = false
})
</script>

<template>
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
          <th class="px-4 py-2">Status</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
        <tr v-for="appt in appointments" :key="appt.id">
          <td class="px-4 py-2.5 text-gray-900">{{ new Date(appt.starts_at).toLocaleString() }}</td>
          <td class="px-4 py-2.5 text-gray-500">{{ appt.appointment_types?.name ?? 'N/A' }}</td>
          <td class="px-4 py-2.5 text-gray-500">{{ appt.status }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

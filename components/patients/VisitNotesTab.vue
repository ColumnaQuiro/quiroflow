<script setup lang="ts">
const props = defineProps<{ patientId: string }>()

interface VisitNoteRow {
  id: string
  body: string
  created_at: string
  appointments: { starts_at: string } | null
}

const supabase = useSupabaseClient()
const notes = ref<VisitNoteRow[]>([])
const loading = ref(true)

onMounted(async () => {
  const { data } = await supabase
    .from('visit_notes')
    .select('id, body, created_at, appointments!inner(starts_at, patient_id)')
    .eq('appointments.patient_id', props.patientId)
    .order('created_at', { ascending: false })
  notes.value = (data as unknown as VisitNoteRow[]) ?? []
  loading.value = false
})
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white">
    <div v-if="loading" class="p-6 text-center text-sm text-gray-400">Loading…</div>
    <div v-else-if="notes.length === 0" class="p-8 text-center text-sm text-gray-400">
      No visit notes yet — these get added from an appointment.
    </div>
    <ul v-else class="divide-y divide-gray-100">
      <li v-for="note in notes" :key="note.id" class="px-4 py-3">
        <p class="text-xs text-gray-500">{{ new Date(note.appointments?.starts_at ?? note.created_at).toLocaleString() }}</p>
        <p class="mt-1 whitespace-pre-wrap text-sm text-gray-900">{{ note.body }}</p>
      </li>
    </ul>
  </div>
</template>

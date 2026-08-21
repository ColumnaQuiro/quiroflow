<script setup lang="ts">
const props = defineProps<{ patientId: string }>()

interface VisitNoteRow {
  id: string
  body: string
  created_at: string
  appointments: {
    starts_at: string
    appointment_types: { name: string } | null
    team_members: { full_name: string } | null
    practitioner_name: string | null
  } | null
}

const supabase = useSupabaseClient()
const notes = ref<VisitNoteRow[]>([])
const loading = ref(true)

onMounted(async () => {
  const { data } = await supabase
    .from('visit_notes')
    .select(
      'id, body, created_at, appointments!inner(starts_at, patient_id, appointment_types(name), team_members(full_name), practitioner_name)',
    )
    .eq('appointments.patient_id', props.patientId)
    .order('created_at', { ascending: false })
  notes.value = (data as unknown as VisitNoteRow[]) ?? []
  loading.value = false
})

function practitionerLabel(note: VisitNoteRow) {
  return note.appointments?.team_members?.full_name ?? note.appointments?.practitioner_name ?? null
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="loading" class="rounded-card border border-line bg-surface p-8 text-center text-[13px] text-ink-faint shadow-card">Loading…</div>
    <div v-else-if="notes.length === 0" class="rounded-card border border-line bg-surface p-8 text-center text-[13px] text-ink-faint shadow-card">
      No visit notes yet — these get added from an appointment.
    </div>
    <div v-for="note in notes" :key="note.id" class="rounded-card border border-line bg-surface p-4 shadow-card">
      <div class="flex items-baseline justify-between gap-2">
        <p class="text-[13.5px] font-semibold text-ink-700">
          {{ new Date(note.appointments?.starts_at ?? note.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }}
        </p>
        <p class="truncate text-[12px] text-ink-muted2">
          {{ note.appointments?.appointment_types?.name ?? 'Visit' }}
          <template v-if="practitionerLabel(note)"> &middot; {{ practitionerLabel(note) }}</template>
        </p>
      </div>
      <div class="mt-2.5">
        <p class="text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">Note</p>
        <p class="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-600">{{ note.body }}</p>
      </div>
    </div>
  </div>
</template>

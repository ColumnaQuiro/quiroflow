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
const { can } = usePermission()
const t = useT()
const notes = ref<VisitNoteRow[]>([])
const loading = ref(true)
const deletingId = ref<string | null>(null)

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('visit_notes')
    .select(
      'id, body, created_at, appointments!inner(starts_at, patient_id, appointment_types(name), team_members(full_name), practitioner_name)',
    )
    .eq('appointments.patient_id', props.patientId)
    .order('created_at', { ascending: false })
  notes.value = (data as unknown as VisitNoteRow[]) ?? []
  loading.value = false
}
onMounted(load)
// Defense-in-depth alongside practitioner.vue's :key on the charting pane:
// if this component is ever reused for a different patientId without being
// remounted, this history list should follow rather than silently keep
// showing the previous patient's notes next to the new patient's name.
watch(() => props.patientId, load)

function practitionerLabel(note: VisitNoteRow) {
  return note.appointments?.team_members?.full_name ?? note.appointments?.practitioner_name ?? null
}

// RLS (staff delete visit_notes, migration 0046) already gates this by the
// visit_notes_delete permission and by created_by unless the account's
// visit_notes_scope is 'all' -- can() here just avoids showing a button
// that would fail, not the actual access control.
async function deleteNote(note: VisitNoteRow) {
  if (!confirm(t('Delete this note? This cannot be undone.', '¿Eliminar esta nota? Esta acción no se puede deshacer.'))) return
  deletingId.value = note.id
  const { error } = await supabase.from('visit_notes').delete().eq('id', note.id)
  if (!error) notes.value = notes.value.filter((n) => n.id !== note.id)
  deletingId.value = null
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 3" :key="i" class="space-y-2 rounded-card border border-line bg-surface p-4 shadow-card">
        <div class="flex items-baseline justify-between gap-2">
          <UiSkeleton class="h-3.5 w-24 rounded-ctlSm" />
          <UiSkeleton class="h-3 w-20 rounded-ctlSm" />
        </div>
        <UiSkeleton class="h-3 w-full rounded-ctlSm" />
        <UiSkeleton class="h-3 w-2/3 rounded-ctlSm" />
      </div>
    </div>
    <div v-else-if="notes.length === 0" class="rounded-card border border-line bg-surface p-8 text-center text-[13px] text-ink-faint shadow-card">
      {{ t('No visit notes yet — these get added from an appointment.', 'Aún no hay notas de la visita — se añaden desde una cita.') }}
    </div>
    <div v-for="note in notes" :key="note.id" class="group relative rounded-card border border-line bg-surface p-4 shadow-card">
      <div class="flex items-baseline justify-between gap-2">
        <p class="text-[13.5px] font-semibold text-ink-700">
          {{ new Date(note.appointments?.starts_at ?? note.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }}
        </p>
        <p class="truncate text-[12px] text-ink-muted2">
          {{ note.appointments?.appointment_types?.name ?? t('Visit', 'Visita') }}
          <template v-if="practitionerLabel(note)"> &middot; {{ practitionerLabel(note) }}</template>
        </p>
      </div>
      <div class="mt-2.5">
        <p class="text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">{{ t('Note', 'Nota') }}</p>
        <p class="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-600">{{ note.body }}</p>
      </div>
      <button
        v-if="can('visit_notes_delete')"
        type="button"
        :disabled="deletingId === note.id"
        class="absolute right-3 top-3 text-[11.5px] font-medium text-ink-faint opacity-0 hover:text-danger-text group-hover:opacity-100 disabled:opacity-50"
        :title="t('Delete note', 'Eliminar nota')"
        @click="deleteNote(note)"
      >
        {{ deletingId === note.id ? t('Deleting…', 'Eliminando…') : t('Delete', 'Eliminar') }}
      </button>
    </div>
  </div>
</template>

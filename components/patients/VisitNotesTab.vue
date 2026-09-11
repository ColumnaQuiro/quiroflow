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

// Which note is open for editing, and its draft -- kept apart from the note
// itself so cancelling restores the original rather than having to reload.
// Same shape as appointments/NotesPanel.vue, which has had editing since it
// was written; this tab only ever got the delete half.
const editingId = ref<string | null>(null)
const editDraft = ref('')
const savingEdit = ref(false)

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
function startEdit(note: VisitNoteRow) {
  editingId.value = note.id
  editDraft.value = note.body
}

function cancelEdit() {
  editingId.value = null
  editDraft.value = ''
}

// Same RLS note as delete below: 'staff update visit_notes' gates this by
// visit_notes_edit and, unless visit_notes_scope is 'all', by created_by.
async function saveEdit(note: VisitNoteRow) {
  const body = editDraft.value.trim()
  if (!body || body === note.body) {
    cancelEdit()
    return
  }
  savingEdit.value = true
  const { error } = await supabase.from('visit_notes').update({ body }).eq('id', note.id)
  savingEdit.value = false
  if (error) return
  // Patched in place rather than reloaded: the list is ordered by created_at
  // and an edit does not move a note, so a round-trip would only make the
  // note being read flicker.
  note.body = body
  cancelEdit()
}

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

        <template v-if="editingId === note.id">
          <textarea
            v-model="editDraft"
            rows="5"
            class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink-700 focus:border-brand focus:outline-none"
          />
          <div class="mt-2 flex items-center gap-2">
            <UiBtn size="sm" variant="primary" :disabled="savingEdit || !editDraft.trim()" @click="saveEdit(note)">
              {{ savingEdit ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}
            </UiBtn>
            <UiBtn size="sm" variant="ghost" :disabled="savingEdit" @click="cancelEdit">{{ t('Cancel', 'Cancelar') }}</UiBtn>
          </div>
        </template>

        <p v-else class="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-600">{{ note.body }}</p>
      </div>

      <div v-if="editingId !== note.id" class="absolute right-3 top-3 flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
        <UiIconBtn v-if="can('visit_notes_edit')" icon="pencil" :label="t('Edit note', 'Editar nota')" @click="startEdit(note)" />
        <UiIconBtn
          v-if="can('visit_notes_delete')"
          icon="trash"
          tone="danger"
          :disabled="deletingId === note.id"
          :label="deletingId === note.id ? t('Deleting…', 'Eliminando…') : t('Delete note', 'Eliminar nota')"
          @click="deleteNote(note)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface VisitNote {
  id: string
  body: string
  created_at: string
}

// `listings`: off where the listing already sits beside today's note (My Day).
const props = withDefaults(defineProps<{ appointmentId: string; listings?: boolean }>(), { listings: true })

const supabase = useSupabaseClient()
const store = useAccountStore()
const { can } = usePermission()
const t = useT()

const notes = ref<VisitNote[]>([])
const newNote = ref('')
const loading = ref(true)

// The box at the bottom is a note being written, and it is saved as it is
// typed (useVisitNoteAutosave): the first save creates it, later ones update
// it. "Add note" used to be the only thing that wrote it, and a note typed
// and then left -- the dialog closed, the next patient opened -- was lost.
// The button now only says "this one is finished": it moves the note up
// into the list and empties the box for another.
//
// That needs visit_notes_edit, since every save after the first is an
// update. A role that may add a note but not change one keeps the button as
// the moment it is written, and the box is still written -- once, as a new
// note -- if it is left with text in it.
const draftId = ref<string | null>(null)
// The visit the box is writing for. Changed only after anything pending has
// been written, so a late save cannot land on the next visit.
let writingFor = props.appointmentId
const canAutosave = computed(() => can('visit_notes_edit'))
const draft = useVisitNoteAutosave({
  appointmentId: () => writingFor,
  noteId: draftId,
  body: () => newNote.value,
  onSaved: (row) => {
    upsertNote(row)
    // Without visit_notes_edit a written note is finished: anything typed
    // after it can only become another one.
    if (!canAutosave.value) {
      draftId.value = null
      if (newNote.value.trim() === row.body) newNote.value = ''
    }
  },
})
const { state: draftState, errorKind: draftErrorKind } = draft
const finishing = ref(false)

/** The list, without the note still in the box. */
const listed = computed(() => notes.value.filter((n) => n.id !== draftId.value))

function upsertNote(row: VisitNote) {
  const existing = notes.value.find((n) => n.id === row.id)
  if (existing) existing.body = row.body
  else notes.value = [row, ...notes.value]
}

const editor = useVisitNoteEditing((id, body) => {
  const note = notes.value.find((n) => n.id === id)
  if (note) note.body = body
})
const { editingId, editDraft, startEdit, finishEdit, cancelEdit, onEditInput, editState, editErrorKind } = editor

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('visit_notes')
    .select('id, body, created_at')
    .eq('appointment_id', props.appointmentId)
    .order('created_at', { ascending: false })
  notes.value = data ?? []
  loading.value = false
}
onMounted(load)
watch(
  () => props.appointmentId,
  async () => {
    await Promise.all([draft.save(), finishEdit()])
    writingFor = props.appointmentId
    draftId.value = null
    newNote.value = ''
    draft.reset()
    await load()
  },
)

function onNewNoteInput() {
  draft.changed({ schedule: canAutosave.value })
}

async function addNote() {
  if (!newNote.value.trim()) return
  finishing.value = true
  await draft.save()
  finishing.value = false
  if (draft.state.value === 'error') return
  draftId.value = null
  newNote.value = ''
  draft.reset()
}

async function removeNote(id: string) {
  if (!confirm(t('Delete this note?', '¿Eliminar esta nota?'))) return
  await supabase.from('visit_notes').delete().eq('id', id)
  notes.value = notes.value.filter((n) => n.id !== id)
}
</script>

<template>
  <div>
    <AppointmentsSpinalListings v-if="listings && store.accountId" class="mb-3" :appointment-id="appointmentId" :account-id="store.accountId" :team-member-id="store.teamMember?.id ?? null" :editable="can('visit_notes_edit')" />
    <div v-if="loading" class="space-y-2">
      <UiSkeleton v-for="i in 2" :key="i" class="h-16 w-full rounded-ctl" />
    </div>
    <ul v-else-if="listed.length > 0" class="space-y-2">
      <li v-for="note in listed" :key="note.id" class="group rounded-ctl border border-warning-border bg-warning-bg2 p-3">
        <template v-if="editingId === note.id">
          <textarea
            v-model="editDraft"
            rows="6"
            class="w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink-800 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            @input="onEditInput"
          ></textarea>
          <div class="mt-2 flex flex-wrap items-center gap-1.5">
            <UiBtn size="sm" variant="primary" :disabled="editState === 'saving' || !editDraft.trim()" @click="finishEdit">
              {{ t('Save', 'Guardar') }}
            </UiBtn>
            <UiBtn size="sm" variant="ghost" @click="cancelEdit">{{ t('Cancel', 'Cancelar') }}</UiBtn>
            <AppointmentsNoteSaveStatus class="ml-1" :state="editState" :error-kind="editErrorKind" />
          </div>
        </template>
        <template v-else>
          <p class="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-800">{{ note.body }}</p>
          <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p class="text-[11.5px] text-ink-muted2">{{ new Date(note.created_at).toLocaleString() }}</p>
            <!-- Always present rather than revealed on hover: this is a
            touch-heavy screen (a practitioner charting mid-visit, often on a
            tablet), and a hover-only control is unreachable there. -->
            <!-- Gated the way patients/VisitNotesTab.vue gated them: RLS
            (0046) already refuses an edit without visit_notes_edit and a
            delete without visit_notes_delete, but it refuses them silently --
            the button just does nothing. The default Practitioner role has
            edit and NOT delete, so this is the ordinary case, not an exotic
            one. -->
            <div class="flex shrink-0 items-center gap-1.5">
              <UiIconBtn v-if="can('visit_notes_edit')" icon="pencil" :label="t('Edit', 'Editar')" @click="startEdit(note, appointmentId)" />
              <UiIconBtn v-if="can('visit_notes_delete')" icon="trash" tone="danger" :label="t('Delete', 'Eliminar')" @click="removeNote(note.id)" />
            </div>
          </div>
        </template>
      </li>
    </ul>

    <!-- A textarea, not a single-line input: these notes run to whole
    paragraphs of subjective history, and a one-line field hid all but the
    tail of what was being typed. -->
    <div class="mt-3">
      <textarea
        v-model="newNote"
        rows="3"
        :placeholder="t('Add a note…', 'Añade una nota…')"
        class="w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink-800 placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        data-cy="new-visit-note"
        @input="onNewNoteInput"
      ></textarea>
      <div class="mt-2 flex items-center justify-between gap-2">
        <AppointmentsNoteSaveStatus :state="draftState" :error-kind="draftErrorKind" />
        <UiBtn size="sm" variant="secondary" class="ml-auto" :disabled="finishing || !newNote.trim()" @click="addNote">
          {{ finishing ? t('Adding…', 'Añadiendo…') : t('Add note', 'Añadir nota') }}
        </UiBtn>
      </div>
    </div>
  </div>
</template>

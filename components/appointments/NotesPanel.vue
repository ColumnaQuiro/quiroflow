<script setup lang="ts">
interface VisitNote {
  id: string
  body: string
  created_at: string
}

const props = defineProps<{ appointmentId: string }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const notes = ref<VisitNote[]>([])
const newNote = ref('')
const loading = ref(true)
const saving = ref(false)

// Which note is open for editing, and the draft being edited. Kept separate
// from the note itself so cancelling leaves the stored body untouched.
const editingId = ref<string | null>(null)
const editDraft = ref('')
const savingEdit = ref(false)

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
watch(() => props.appointmentId, load)

async function addNote() {
  if (!newNote.value.trim()) return
  saving.value = true
  await supabase.from('visit_notes').insert({
    account_id: store.accountId!,
    appointment_id: props.appointmentId,
    body: newNote.value.trim(),
    created_by: store.teamMember?.id ?? null,
  })
  newNote.value = ''
  saving.value = false
  await load()
}

function startEdit(note: VisitNote) {
  editingId.value = note.id
  editDraft.value = note.body
}

function cancelEdit() {
  editingId.value = null
  editDraft.value = ''
}

async function saveEdit(note: VisitNote) {
  const body = editDraft.value.trim()
  if (!body || body === note.body) {
    cancelEdit()
    return
  }
  savingEdit.value = true
  await supabase.from('visit_notes').update({ body }).eq('id', note.id)
  // Patch in place rather than reloading: the list is ordered by created_at
  // and an edit doesn't move a note, so a round-trip would only make the
  // note the practitioner is looking at flicker.
  note.body = body
  savingEdit.value = false
  cancelEdit()
}

async function removeNote(id: string) {
  if (!confirm(t('Delete this note?', '¿Eliminar esta nota?'))) return
  await supabase.from('visit_notes').delete().eq('id', id)
  notes.value = notes.value.filter((n) => n.id !== id)
  if (editingId.value === id) cancelEdit()
}
</script>

<template>
  <div>
    <div v-if="loading" class="space-y-2">
      <UiSkeleton v-for="i in 2" :key="i" class="h-16 w-full rounded-ctl" />
    </div>
    <ul v-else-if="notes.length > 0" class="space-y-2">
      <li v-for="note in notes" :key="note.id" class="group rounded-ctl border border-warning-border bg-warning-bg2 p-3">
        <template v-if="editingId === note.id">
          <textarea
            v-model="editDraft"
            rows="6"
            class="w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink-800 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          ></textarea>
          <div class="mt-2 flex items-center gap-1.5">
            <UiBtn size="sm" variant="primary" :disabled="savingEdit || !editDraft.trim()" @click="saveEdit(note)">
              {{ savingEdit ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}
            </UiBtn>
            <UiBtn size="sm" variant="ghost" @click="cancelEdit">{{ t('Cancel', 'Cancelar') }}</UiBtn>
          </div>
        </template>
        <template v-else>
          <p class="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-800">{{ note.body }}</p>
          <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p class="text-[11.5px] text-ink-muted2">{{ new Date(note.created_at).toLocaleString() }}</p>
            <!-- Always present rather than revealed on hover: this is a
            touch-heavy screen (a practitioner charting mid-visit, often on a
            tablet), and a hover-only control is unreachable there. -->
            <div class="flex shrink-0 items-center gap-1.5">
              <UiBtn size="sm" variant="ghost" @click="startEdit(note)">{{ t('Edit', 'Editar') }}</UiBtn>
              <UiBtn size="sm" variant="ghost" class="hover:text-danger-text" @click="removeNote(note.id)">{{ t('Delete', 'Eliminar') }}</UiBtn>
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
      ></textarea>
      <div class="mt-2 flex justify-end">
        <UiBtn size="sm" variant="secondary" :disabled="saving || !newNote.trim()" @click="addNote">
          {{ saving ? t('Adding…', 'Añadiendo…') : t('Add note', 'Añadir nota') }}
        </UiBtn>
      </div>
    </div>
  </div>
</template>

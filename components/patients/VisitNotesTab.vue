<script setup lang="ts">
import { listingSummary, sideLettersFor, type Listings } from '~/utils/spinalListings'
import { NOTE_SECTIONS, composeVisitNote, parseVisitNote, visitNoteEditSections, type NoteSection } from '~/utils/visitNote'
const props = defineProps<{ patientId: string }>()

interface VisitNoteRow {
  id: string
  appointment_id: string
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
const { formatShortDateYear } = useDates()
const notes = ref<VisitNoteRow[]>([])
const loading = ref(true)
const deletingId = ref<string | null>(null)

// The pencil: corrected in place and saved as it is typed
// (useVisitNoteEditing), the same as appointments/NotesPanel.vue.
const { editingId, editDraft, startEdit, finishEdit, cancelEdit, onEditInput, editState, editErrorKind } = useVisitNoteEditing((id, body) => {
  const note = notes.value.find((n) => n.id === id)
  if (note) note.body = body
})

// A charted note is corrected in its four boxes, the way it was written,
// rather than as one block of text with "Subjective:" typed into it -- which
// is what the pencil used to open, and where deleting a label by accident
// quietly turned a section into loose text. The boxes are put back together
// in the charting pane's own shape (composeVisitNote) and saved as before. A
// note written as free text is corrected as free text.
const editSections = reactive<Record<NoteSection, string>>({ Subjective: '', Objective: '', Action: '', Plan: '' })
const editStructured = ref(false)
async function beginEdit(note: VisitNoteRow) {
  await startEdit(note, note.appointment_id)
  if (editingId.value !== note.id) return
  editStructured.value = parseVisitNote(note.body).structured
  Object.assign(editSections, visitNoteEditSections(note.body))
}
function onSectionInput() {
  // Four empty boxes are an empty note, not four bare labels: left blank, the
  // autosave writes nothing and Save stays off, as with the single box.
  const blank = NOTE_SECTIONS.every((s) => !editSections[s].trim())
  editDraft.value = blank ? '' : composeVisitNote(editSections)
  onEditInput()
}
function rowsFor(text: string) {
  return Math.min(12, Math.max(2, text.split('\n').length + Math.floor(text.length / 90)))
}
const editFieldId = useId()

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('visit_notes')
    .select(
      'id, appointment_id, body, created_at, appointments!inner(starts_at, patient_id, appointment_types(name), team_members(full_name), practitioner_name)',
    )
    .eq('appointments.patient_id', props.patientId)
  // Newest VISIT first, as the Clinical tab orders them. Ordering by the
  // note's own created_at put a back-dated or late-written note above more
  // recent visits -- and it is the visit's date each card shows, and the
  // newest card that opens in full, so the two must agree.
  notes.value = ((data as unknown as VisitNoteRow[]) ?? []).slice().sort((a, b) => {
    const at = a.appointments?.starts_at ?? a.created_at
    const bt = b.appointments?.starts_at ?? b.created_at
    return bt.localeCompare(at) || b.created_at.localeCompare(a.created_at)
  })
  // Each visit's listing beside its note -- unless the note already carries
  // it, as one charted on My Day does in its "Ajustado: …" line.
  const ids = [...new Set(notes.value.map((n) => n.appointment_id))]
  const byAppt = new Map<string, Listings>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data: rows } = await supabase.from('visit_listings').select('appointment_id, listings').in('appointment_id', ids.slice(i, i + 200))
    for (const r of (rows as { appointment_id: string; listings: Listings }[] | null) ?? []) byAppt.set(r.appointment_id, r.listings)
  }
  listingByAppt.value = byAppt
  loading.value = false
}
const listingByAppt = ref<Map<string, Listings>>(new Map())
function listingLine(note: VisitNoteRow) {
  const summary = listingSummary(listingByAppt.value.get(note.appointment_id), (x) => x, sideLettersFor(t))
  return summary && !note.body.includes(summary) ? summary : ''
}
onMounted(load)
// Defense-in-depth alongside practitioner.vue's :key on the charting pane:
// if this component is ever reused for a different patientId without being
// remounted, this history list should follow rather than silently keep
// showing the previous patient's notes next to the new patient's name.
watch(() => props.patientId, load)

function metaLine(note: VisitNoteRow) {
  return [note.appointments?.appointment_types?.name ?? t('Visit', 'Visita'), practitionerLabel(note)].filter(Boolean).join(' · ')
}
function visitDay(note: VisitNoteRow) {
  return formatShortDateYear(note.appointments?.starts_at ?? note.created_at)
}

function practitionerLabel(note: VisitNoteRow) {
  return note.appointments?.team_members?.full_name ?? note.appointments?.practitioner_name ?? null
}

// RLS (staff delete visit_notes, migration 0046) already gates this by the
// visit_notes_delete permission and by created_by unless the account's
// visit_notes_scope is 'all' -- can() here just avoids showing a button
// that would fail, not the actual access control. The same goes for the
// edit ('staff update visit_notes', visit_notes_edit).
const deleteAsk = ref<VisitNoteRow | null>(null)
async function deleteNote() {
  const note = deleteAsk.value
  if (!note) return
  deleteAsk.value = null
  deletingId.value = note.id
  const { error } = await supabase.from('visit_notes').delete().eq('id', note.id)
  if (!error) notes.value = notes.value.filter((n) => n.id !== note.id)
  deletingId.value = null
}
</script>

<template>
  <div class="space-y-3" data-cy="note-history">
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 3" :key="i" class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <div class="space-y-1.5 border-b border-line-divider bg-surface-subtle px-4 py-3">
          <UiSkeleton class="h-3.5 w-24 rounded-ctlSm" />
          <UiSkeleton class="h-3 w-40 rounded-ctlSm" />
        </div>
        <div class="space-y-2 px-4 py-3">
          <UiSkeleton class="h-3 w-full rounded-ctlSm" />
          <UiSkeleton class="h-3 w-2/3 rounded-ctlSm" />
        </div>
      </div>
    </div>
    <div v-else-if="notes.length === 0" class="rounded-card border border-line bg-surface p-8 text-center text-[13px] text-ink-faint shadow-card">
      {{ t('No visit notes yet. Each note belongs to a visit and is written from its appointment.', 'Aún no hay notas de visita. Cada nota pertenece a una cita y se escribe desde ella.') }}
    </div>

    <!-- One card per visit. Its actions sit in the card's header, always
         shown: they used to float over the top-right corner on hover only,
         on top of the practitioner's name, and a touch screen never showed
         them at all. -->
    <article
      v-for="(note, index) in notes"
      :key="note.id"
      class="overflow-hidden rounded-card border bg-surface shadow-card"
      :class="editingId === note.id ? 'border-brand-tintBorder' : 'border-line'"
      data-cy="note-history-item"
    >
      <header class="flex items-start gap-3 border-b border-line-divider bg-surface-subtle px-4 py-3">
        <div class="min-w-0 flex-1">
          <h3 class="text-[14px] font-semibold leading-tight text-ink-900">{{ visitDay(note) }}</h3>
          <p class="mt-1 truncate text-[12.5px] text-ink-muted">{{ metaLine(note) }}</p>
          <p v-if="listingLine(note)" class="mt-1.5 text-[12.5px] text-ink-700" data-cy="note-history-listing">
            <span class="font-semibold text-ink-900">{{ t('Listing', 'Listado') }}</span>
            <span class="text-ink-faint3" aria-hidden="true"> · </span>{{ listingLine(note) }}
          </p>
        </div>
        <div v-if="editingId !== note.id && (can('visit_notes_edit') || can('visit_notes_delete'))" class="-my-0.5 flex shrink-0 items-center gap-1">
          <UiBtn v-if="can('visit_notes_edit')" size="sm" :aria-label="`${t('Edit note', 'Editar nota')} · ${visitDay(note)}`" data-cy="note-history-edit" @click="beginEdit(note)">
            <svg class="h-[15px] w-[15px]" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
            </svg>
            {{ t('Edit', 'Editar') }}
          </UiBtn>
          <UiIconBtn
            v-if="can('visit_notes_delete')"
            icon="trash"
            tone="danger"
            :disabled="deletingId === note.id"
            :label="deletingId === note.id ? t('Deleting…', 'Eliminando…') : t('Delete note', 'Eliminar nota')"
            class="!h-8 !w-8 touch:!h-10 touch:!w-10"
            data-cy="note-history-delete"
            @click="deleteAsk = note"
          />
        </div>
      </header>

      <div class="px-4 pb-1">
        <template v-if="editingId === note.id">
          <div v-if="editStructured" class="divide-y divide-line-divider">
            <div v-for="key in NOTE_SECTIONS" :key="key" class="flex flex-wrap gap-x-4 gap-y-1.5 py-3">
              <PatientsVisitNoteSectionLabel :section="key" :for="`${editFieldId}-${key}`" class="w-[7.5rem] shrink-0 self-start pt-2" />
              <textarea
                :id="`${editFieldId}-${key}`"
                v-model="editSections[key]"
                :rows="rowsFor(editSections[key])"
                class="min-w-[14rem] flex-1 rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13.5px] leading-relaxed text-ink-700 focus:border-brand focus:outline-none"
                :data-cy="`note-history-edit-${key}`"
                @input="onSectionInput"
              />
            </div>
          </div>
          <div v-else class="py-3">
            <textarea
              v-model="editDraft"
              :aria-label="t('Note', 'Nota')"
              :rows="rowsFor(editDraft) + 1"
              class="w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13.5px] leading-relaxed text-ink-700 focus:border-brand focus:outline-none"
              @input="onEditInput"
            />
          </div>
          <div class="flex flex-wrap items-center gap-2 border-t border-line-divider py-3">
            <UiBtn size="sm" variant="primary" :disabled="editState === 'saving' || !editDraft.trim()" data-cy="note-history-save" @click="finishEdit">
              {{ t('Save', 'Guardar') }}
            </UiBtn>
            <UiBtn size="sm" variant="ghost" :disabled="editState === 'saving'" @click="cancelEdit">{{ t('Cancel', 'Cancelar') }}</UiBtn>
            <AppointmentsNoteSaveStatus :state="editState" :error-kind="editErrorKind" />
          </div>
        </template>

        <!-- The newest note in full; older ones three lines a section, every
             heading still showing, opened in place. -->
        <PatientsVisitNoteSections v-else :body="note.body" :collapsible="index > 0" />
      </div>
    </article>

    <!-- !mt-0: the parent's space-y would push the fixed scrim down. -->
    <UiConfirmDialog
      v-if="deleteAsk"
      class="!mt-0"
      tone="danger"
      :title="t('Delete this note?', '¿Eliminar esta nota?')"
      :confirm-label="t('Delete note', 'Eliminar nota')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="deleteNote"
      @cancel="deleteAsk = null"
    >
      <p class="text-[14px] leading-snug text-ink-700">
        {{ t(`The note from ${visitDay(deleteAsk)} will be deleted. This can't be undone.`, `Se eliminará la nota del ${visitDay(deleteAsk)}. Esta acción no se puede deshacer.`) }}
      </p>
    </UiConfirmDialog>
  </div>
</template>

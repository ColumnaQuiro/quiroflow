// Saves one visit_notes row as it is typed, so a note never depends on
// someone remembering to press a button.
//
// Practitioners were losing notes on the web: the Quick Note and the "Visit
// notes" dialog only wrote anything on "Add note", the SOAP boxes on My Day
// only on "Save note" or on switching patient, and an edit only on "Save". A
// note typed and then left -- the dialog closed, the tab closed, the next
// patient opened from somewhere else -- was simply gone. The phone app has
// saved as you type from the start (mobile/composables/useVisitNoteDraft.ts,
// which also decides WHICH note is today's); this is the same engine for the
// web screens, which each already know which note they are writing.
//
// What it promises:
//   - Saves 800 ms after the last change, when the tab is hidden, and when the
//     screen holding it goes away (the dialog closes, the patient changes).
//   - One save at a time, in order. While `noteId` is null the first save
//     inserts and sets it; every later one updates that same row -- never a
//     second insert, including when an insert landed but its reply was lost.
//   - A failed save keeps the text on screen, says so, and retries: on a
//     back-off, and as soon as the browser is back online. That carries on
//     after the screen is closed, for as long as the page is open.
//   - While anything is unsaved, closing or reloading the tab asks first.
//   - A refused write (RLS) returns no rows rather than an error, so every
//     write is read back and "no row" counts as a failure. A refusal is
//     reported, not retried: it would be refused again.
//   - A blank note is never written: a note cannot be empty, and removing one
//     is the delete permission's job. What was saved before stays.
//
// The caller marks a change with `changed()` (on input). Nothing is saved
// without one, so loading a note into the box never rewrites it.

export type VisitNoteAutosaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export interface AutosavedVisitNote {
  id: string
  body: string
  created_at: string
}

const DEBOUNCE_MS = 800
const MAX_RETRY_MS = 30_000

export function useVisitNoteAutosave(opts: {
  appointmentId: () => string
  /** The row being written; null until the first save creates it. */
  noteId: Ref<string | null>
  /** The text to save, as it stands now. */
  body: () => string
  /** After every confirmed save, with whether it created the row. */
  onSaved?: (row: AutosavedVisitNote, created: boolean) => void
}) {
  const supabase = useSupabaseClient()
  const store = useAccountStore()

  const state = ref<VisitNoteAutosaveState>('idle')
  const errorKind = ref<'offline' | 'refused' | 'failed' | null>(null)
  const savedAt = ref<Date | null>(null)

  let dirty = false
  let debounce: ReturnType<typeof setTimeout> | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let retryMs = 2000
  let chain: Promise<void> = Promise.resolve()
  // Bumped by reset(): a save that started before it must not hand its row
  // to whatever the box holds now (a stale id here once turned a save for one
  // patient into an update of another's note -- see ExamAutofill).
  let generation = 0
  // Bodies sent in inserts whose reply never came: one of them may be in the
  // database already, and inserting again would put the note there twice.
  let unconfirmedInserts: string[] = []
  let unmounted = false

  /**
   * Something changed: save it shortly. With `schedule: false` it is only
   * held as unsaved -- saved by save(), when the screen goes, or when the tab
   * is hidden -- for a role that may add a note but not change one, whose
   * every save would otherwise be a new note.
   */
  function changed({ schedule = true } = {}) {
    dirty = true
    if (state.value !== 'saving') state.value = 'dirty'
    errorKind.value = null
    clearTimeout(debounce)
    if (schedule) debounce = setTimeout(() => void save(), DEBOUNCE_MS)
    listen()
  }

  /** Save whatever is pending now, and wait for it (and anything queued). */
  function save(): Promise<void> {
    clearTimeout(debounce)
    chain = chain.then(saveNow, saveNow)
    return chain
  }

  /** Mark the box as changed and save it now, even if it was not typed in. */
  function saveNowForced(): Promise<void> {
    dirty = true
    return save()
  }

  /** The box now holds a different note (or none): forget anything pending. */
  function reset() {
    generation++
    dirty = false
    unconfirmedInserts = []
    clearTimeout(debounce)
    clearTimeout(retry)
    retryMs = 2000
    state.value = opts.noteId.value ? 'saved' : 'idle'
    errorKind.value = null
    savedAt.value = null
    unlistenIfSettled()
  }

  async function saveNow() {
    if (!dirty) return
    const body = opts.body().trim()
    if (!body) {
      // Nothing to write; whatever was saved before stays.
      dirty = false
      state.value = opts.noteId.value ? 'saved' : 'idle'
      unlistenIfSettled()
      return
    }
    const accountId = store.accountId
    if (!accountId) return

    const gen = generation
    const appointmentId = opts.appointmentId()
    const me = store.teamMember?.id ?? null
    clearTimeout(retry)
    dirty = false
    state.value = 'saving'
    errorKind.value = null

    let row: AutosavedVisitNote | null = null
    let created = false
    try {
      if (!opts.noteId.value && unconfirmedInserts.length && me) {
        // Compared here rather than filtered in the query: a note is
        // paragraphs of free text, too long and too full of commas to sit in
        // a URL. One person's notes on one visit are a handful of rows.
        const { data, error } = await supabase
          .from('visit_notes')
          .select('id, body, created_at')
          .eq('appointment_id', appointmentId)
          .eq('created_by', me)
          .order('created_at', { ascending: false })
          .limit(20)
        if (error) throw error
        const landed = (data as AutosavedVisitNote[] | null)?.find((n) => unconfirmedInserts.includes(n.body))
        if (landed && gen === generation) {
          opts.noteId.value = landed.id
          created = true
        }
      }
      if (opts.noteId.value) {
        const id = opts.noteId.value
        const { data, error } = await supabase.from('visit_notes').update({ body }).eq('id', id).select('id, body, created_at')
        if (error) throw error
        row = (data as AutosavedVisitNote[] | null)?.[0] ?? null
        if (!row) {
          // No row changed: deleted elsewhere, or this person may not change
          // it. Deleted means the text becomes a new note again.
          const { data: still } = await supabase.from('visit_notes').select('id').eq('id', id).maybeSingle()
          if (!still && gen === generation) {
            opts.noteId.value = null
            dirty = true
            return await saveNow()
          }
          errorKind.value = 'refused'
        }
      } else {
        unconfirmedInserts.push(body)
        const { data, error } = await supabase
          .from('visit_notes')
          .insert({ account_id: accountId, appointment_id: appointmentId, body, created_by: me })
          .select('id, body, created_at')
          .single()
        if (error) throw error
        row = data as AutosavedVisitNote
        created = true
      }
    } catch (err) {
      errorKind.value = failureKind(err)
    }

    if (gen !== generation) return

    if (row) {
      unconfirmedInserts = []
      opts.noteId.value = row.id
      savedAt.value = new Date()
      retryMs = 2000
      opts.onSaved?.(row, created)
      // Typed more while this was in flight: that part is still to save.
      if (opts.body().trim() !== body) {
        dirty = true
        state.value = 'dirty'
        clearTimeout(debounce)
        debounce = setTimeout(() => void save(), unmounted ? 0 : DEBOUNCE_MS)
      } else {
        state.value = 'saved'
      }
      unlistenIfSettled()
      return
    }

    dirty = true
    state.value = 'error'
    if (errorKind.value === 'refused') {
      unlistenIfSettled()
      return
    }
    retry = setTimeout(() => void save(), retryMs)
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS)
  }

  /** Offline, refused by RLS (42501), or anything else. */
  function failureKind(err: unknown): 'offline' | 'refused' | 'failed' {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
    if ((err as { code?: string } | null)?.code === '42501') return 'refused'
    return 'failed'
  }

  /** Text that would be lost if the page went now. */
  const unsaved = () => dirty || state.value === 'saving'

  // -- Page events ---------------------------------------------------------------
  // Attached while something is unsaved, and kept past unmount until it has
  // been saved: closing the dialog must not cancel the retry that would
  // rescue its text.
  let listening = false
  function onOnline() {
    if (dirty) void save()
  }
  function onVisibility() {
    if (document.visibilityState === 'hidden' && dirty) void save()
  }
  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (errorKind.value === 'refused' || !unsaved()) return
    void save()
    e.preventDefault()
    // Older browsers only prompt with returnValue set.
    e.returnValue = ''
  }
  function listen() {
    if (listening || typeof window === 'undefined') return
    listening = true
    window.addEventListener('online', onOnline)
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('visibilitychange', onVisibility)
  }
  function unlistenIfSettled() {
    if (!listening || (unsaved() && errorKind.value !== 'refused')) return
    listening = false
    window.removeEventListener('online', onOnline)
    window.removeEventListener('beforeunload', onBeforeUnload)
    document.removeEventListener('visibilitychange', onVisibility)
  }

  onBeforeUnmount(() => {
    unmounted = true
    if (dirty) void save()
    else unlistenIfSettled()
  })

  return { state, errorKind, savedAt, changed, save, saveNowForced, reset, unsaved }
}

/**
 * Correcting a note already written (the pencil), saved as it is typed.
 * "Save" now means "done": it waits for the last save and closes the box.
 * "Cancel" puts back the text the note had when the pencil was pressed --
 * written back only if something had already been saved over it.
 */
export function useVisitNoteEditing(onSaved: (id: string, body: string) => void) {
  const editingId = ref<string | null>(null)
  const editDraft = ref('')
  let appointmentId = ''
  let original = ''
  const autosave = useVisitNoteAutosave({
    appointmentId: () => appointmentId,
    noteId: editingId,
    body: () => editDraft.value,
    onSaved: (row) => onSaved(row.id, row.body),
  })

  function close() {
    editingId.value = null
    editDraft.value = ''
    autosave.reset()
  }

  /** Done: wait for the save. False (and still open) when it failed. */
  async function finishEdit(): Promise<boolean> {
    if (!editingId.value) return true
    await autosave.save()
    if (autosave.state.value === 'error') return false
    close()
    return true
  }

  async function startEdit(note: { id: string; body: string }, noteAppointmentId: string) {
    if (!(await finishEdit())) return
    appointmentId = noteAppointmentId
    original = note.body
    editDraft.value = note.body
    editingId.value = note.id
    autosave.reset()
  }

  async function cancelEdit() {
    if (!editingId.value) return
    const overwritten = autosave.savedAt.value !== null || autosave.state.value === 'saving'
    editDraft.value = original
    if (overwritten) await autosave.saveNowForced()
    if (autosave.state.value !== 'error') close()
  }

  return { editingId, editDraft, startEdit, finishEdit, cancelEdit, onEditInput: () => autosave.changed(), editState: autosave.state, editErrorKind: autosave.errorKind }
}

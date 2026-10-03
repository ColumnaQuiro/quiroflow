// Today's note on the visit screen: one visit_notes row for this appointment,
// written as the practitioner types.
//
// The notes are the web's own (components/appointments/NotesPanel.vue and the
// Clinical tab): free text in visit_notes, any number per appointment, under
// the RLS of migration 0046 --
//   - reading and adding one need visit_notes_access;
//   - changing one needs visit_notes_edit, and with visit_notes_scope 'own'
//     only one the person wrote themselves.
// Saving as you type is an insert and then updates, so it needs both. Which
// note is "today's" follows from that: the newest one on this visit that this
// person may change, or a new one when there is none. Any other notes on the
// visit (someone else's, under 'own') are shown beside it, read-only.
//
// What it promises about the text, because a note lost mid-visit is not
// rewritten from memory:
//   - Saves 800 ms after the last keystroke, on blur, when the app is
//     backgrounded, and before leaving the screen.
//   - One save at a time, in order: the first creates the row, every later
//     one updates that same row -- never a second insert.
//   - A failed save (offline, a refused write) keeps the text on screen,
//     says so, and retries -- on a back-off and as soon as the phone is back
//     online.
//   - Until a save is confirmed the text is also kept on the device
//     (localStorage, per appointment), and restored the next time this visit
//     is opened -- so closing the app, or leaving the screen while offline,
//     loses nothing. It is removed as soon as the database has it.
//   - A refused update returns no rows rather than an error, so every write
//     is read back (.select) and "no row" counts as a failure.
export interface VisitNoteRow {
  id: string
  body: string
  created_at: string
  created_by: string | null
  team_members: { full_name: string } | null
}

export type NoteSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

interface LocalCopy {
  /** The note the text belongs to; null when it was never created. */
  noteId: string | null
  /** What the database held when typing started -- to tell an edit made elsewhere since. */
  base: string
  body: string
}

const DEBOUNCE_MS = 800
const MAX_RETRY_MS = 30_000

export function useVisitNoteDraft(opts: {
  appointmentId: string
  accountId: () => string | null | undefined
  teamMemberId: () => string | null | undefined
  /** visit_notes_access: may see this visit's notes at all. */
  canRead: () => boolean
  /** visit_notes_access and visit_notes_edit: may write today's note. */
  canWrite: () => boolean
  /** visit_notes_scope 'all' (or the owner): may change notes others wrote. */
  scopeAll: () => boolean
}) {
  const supabase = useSupabaseClient()
  const storageKey = `quiroflow-visit-note:${opts.appointmentId}`

  const notes = ref<VisitNoteRow[]>([])
  const noteId = ref<string | null>(null)
  const draft = ref('')
  const loading = ref(true)
  const loadError = ref(false)
  const state = ref<NoteSaveState>('idle')
  const savedAt = ref<Date | null>(null)
  const errorKind = ref<'offline' | 'refused' | 'failed' | null>(null)
  let savedBody = ''
  let base = ''

  /** Notes on this visit other than the one being written. */
  const otherNotes = computed(() => notes.value.filter((n) => n.id !== noteId.value))

  // -- The copy kept on the device -------------------------------------------
  function readLocal(): LocalCopy | null {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw ? (JSON.parse(raw) as LocalCopy) : null
    } catch {
      return null
    }
  }
  function writeLocal() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ noteId: noteId.value, base, body: draft.value } satisfies LocalCopy))
    } catch {
      // Storage full or blocked: the database save still runs.
    }
  }
  function clearLocal() {
    try {
      localStorage.removeItem(storageKey)
    } catch {
      // Nothing to do.
    }
  }

  // -- Loading -----------------------------------------------------------------
  async function load() {
    if (!opts.canRead()) {
      loading.value = false
      return
    }
    loading.value = true
    loadError.value = false
    const { data, error } = await supabase
      .from('visit_notes')
      .select('id, body, created_at, created_by, team_members(full_name)')
      .eq('appointment_id', opts.appointmentId)
      .order('created_at', { ascending: true })
    if (error) {
      // Nothing is put in the box: writing over a note that failed to load
      // would create a second one beside it.
      loadError.value = true
      loading.value = false
      return
    }
    notes.value = (data as unknown as VisitNoteRow[]) ?? []

    const me = opts.teamMemberId()
    const mine = opts.canWrite()
      ? [...notes.value].reverse().find((n) => opts.scopeAll() || (me && n.created_by === me)) ?? null
      : null
    noteId.value = mine?.id ?? null
    savedBody = mine?.body ?? ''
    base = savedBody
    draft.value = savedBody
    state.value = mine ? 'saved' : 'idle'

    // Text typed on this phone that never reached the database.
    const local = opts.canWrite() ? readLocal() : null
    if (local && local.body.trim()) {
      const target = (local.noteId && notes.value.find((n) => n.id === local.noteId)) || mine
      if (target && target.id !== noteId.value && (opts.scopeAll() || target.created_by === me)) {
        noteId.value = target.id
        savedBody = target.body
      }
      const server = target?.body ?? ''
      if (server.trim() === local.body.trim()) {
        clearLocal()
      } else {
        // Unchanged in the database since, or the database has only the start
        // of it (the insert landed but its reply was lost): the local text is
        // simply newer. Otherwise the note changed elsewhere too -- keep both
        // rather than choose.
        draft.value = server === local.base || local.body.startsWith(server) ? local.body : `${server}\n\n${local.body}`
        base = server
        state.value = 'dirty'
        scheduleSave(0)
      }
    }
    loading.value = false
  }

  // -- Saving --------------------------------------------------------------------
  let debounce: ReturnType<typeof setTimeout> | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let retryMs = 2000
  let chain: Promise<void> = Promise.resolve()
  let disposed = false

  function scheduleSave(ms = DEBOUNCE_MS) {
    clearTimeout(debounce)
    debounce = setTimeout(() => void save(), ms)
  }

  /** Called on every keystroke. */
  function onInput() {
    if (!opts.canWrite()) return
    state.value = draft.value.trim() === savedBody.trim() ? (noteId.value ? 'saved' : 'idle') : 'dirty'
    writeLocal()
    scheduleSave()
  }

  /** Queue a save of whatever the box holds now. Saves never overlap. */
  function save(): Promise<void> {
    clearTimeout(debounce)
    chain = chain.then(saveNow, saveNow)
    return chain
  }

  async function saveNow() {
    if (!opts.canWrite()) return
    const body = draft.value.trim()
    if (body === savedBody.trim()) {
      if (noteId.value) state.value = 'saved'
      clearLocal()
      return
    }
    // An empty box is not saved: a note can't be blank (the web refuses it
    // too), and deleting is a separate permission. What was there stays.
    if (!body) return
    const accountId = opts.accountId()
    if (!accountId) return

    clearTimeout(retry)
    state.value = 'saving'
    errorKind.value = null
    let ok = false
    try {
      if (noteId.value) {
        const { data, error } = await supabase.from('visit_notes').update({ body }).eq('id', noteId.value).select('id')
        if (error) throw error
        if (!data || data.length === 0) {
          // No row changed: the note was deleted elsewhere, or this person
          // may no longer change it. Deleted -> write it as a new note.
          const { data: still } = await supabase.from('visit_notes').select('id').eq('id', noteId.value).maybeSingle()
          if (!still) {
            const goneId = noteId.value
            notes.value = notes.value.filter((n) => n.id !== goneId)
            noteId.value = null
            savedBody = ''
            return await saveNow()
          }
          errorKind.value = 'refused'
        } else {
          ok = true
        }
      } else {
        const { data, error } = await supabase
          .from('visit_notes')
          .insert({ account_id: accountId, appointment_id: opts.appointmentId, body, created_by: opts.teamMemberId() ?? null })
          .select('id, body, created_at, created_by, team_members(full_name)')
          .single()
        if (error) throw error
        const row = data as unknown as VisitNoteRow
        noteId.value = row.id
        notes.value = [...notes.value, row]
        ok = true
      }
    } catch {
      errorKind.value = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'failed'
    }

    if (ok) {
      savedBody = body
      base = body
      savedAt.value = new Date()
      retryMs = 2000
      const row = notes.value.find((n) => n.id === noteId.value)
      if (row) row.body = body
      // Typed more while this was in flight: that text is still unsaved.
      if (draft.value.trim() === body) {
        state.value = 'saved'
        clearLocal()
      } else {
        state.value = 'dirty'
        writeLocal()
        scheduleSave()
      }
      return
    }

    state.value = 'error'
    writeLocal()
    // A refused write will be refused again; it is reported, not retried.
    if (errorKind.value !== 'refused' && !disposed) {
      retry = setTimeout(() => void save(), retryMs)
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS)
    }
  }

  /** Save now and wait for it (and anything queued) to finish. */
  async function flush() {
    if (state.value === 'dirty' || state.value === 'error') await save()
    else await chain
  }

  function onOnline() {
    if (state.value === 'error' || state.value === 'dirty') void save()
  }
  function onVisibility() {
    if (document.visibilityState === 'hidden') void flush()
  }
  onMounted(() => {
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisibility)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisibility)
    // One last attempt; whatever it does, the device copy is already written.
    if (state.value === 'dirty' || state.value === 'error') void save()
    disposed = true
    clearTimeout(retry)
  })

  return { notes, otherNotes, noteId, draft, loading, loadError, state, savedAt, errorKind, load, onInput, save, flush }
}

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
// A role with visit_notes_access but NOT visit_notes_edit may still add a
// note -- the web's NotesPanel offers "Add note" to anyone who can see them,
// and only the pencil needs edit. Saving as you type is not open to it (the
// second save would be an update, which RLS refuses), so that role gets
// 'add' mode: the text is typed and kept on the device exactly as above,
// and goes to the database once, as one insert, when "Save note" is tapped.
// After that the note is read-only like any other. It is offered while this
// person has no note of their own on the visit yet -- or while text they
// typed here never reached the database, so it can still be sent.
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

const DRAFT_PREFIX = 'quiroflow-visit-note:'

/**
 * Drops every unsent note kept on this device. Called on sign-out: the text
 * is clinical, and a shared clinic iPad must not hand it to whoever signs in
 * next (who could then save it under their own name).
 */
export function clearVisitNoteDrafts() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(DRAFT_PREFIX)) localStorage.removeItem(k)
  } catch {
    // Storage blocked: nothing kept to clear.
  }
}

export function useVisitNoteDraft(opts: {
  appointmentId: string
  accountId: () => string | null | undefined
  teamMemberId: () => string | null | undefined
  /** visit_notes_access: may see this visit's notes at all. */
  canRead: () => boolean
  /** visit_notes_access and visit_notes_edit: may write today's note. */
  canWrite: () => boolean
  /** visit_notes_access without visit_notes_edit: may add one note, not change it. */
  canAdd?: () => boolean
  /** visit_notes_scope 'all' (or the owner): may change notes others wrote. */
  scopeAll: () => boolean
}) {
  const supabase = useSupabaseClient()
  // Per person as well as per visit: a draft is only ever offered back to
  // the one who typed it.
  const storageKey = () => `${DRAFT_PREFIX}${opts.teamMemberId() ?? 'unknown'}:${opts.appointmentId}`

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

  /** 'add': one insert on an explicit save, never an update (see above). */
  const addOnly = () => !opts.canWrite() && !!opts.canAdd?.()
  /** Add mode: the box is offered (no note of this person's on the visit yet, or unsent text). */
  const addOpen = ref(false)
  /** Add mode: "Save note" was tapped, so saving (and retrying) is wanted. */
  let submitted = false

  /** Notes on this visit other than the one being written. */
  const otherNotes = computed(() => notes.value.filter((n) => n.id !== noteId.value))

  // -- The copy kept on the device -------------------------------------------
  function readLocal(): LocalCopy | null {
    try {
      const raw = localStorage.getItem(storageKey())
      return raw ? (JSON.parse(raw) as LocalCopy) : null
    } catch {
      return null
    }
  }
  function writeLocal() {
    try {
      localStorage.setItem(storageKey(), JSON.stringify({ noteId: noteId.value, base, body: draft.value } satisfies LocalCopy))
    } catch {
      // Storage full or blocked: the database save still runs.
    }
  }
  function clearLocal() {
    try {
      localStorage.removeItem(storageKey())
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

    if (addOnly()) {
      loadAddMode()
      loading.value = false
      return
    }

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

  // Add mode: nothing of anyone's is ever put in the box -- it can only become
  // a new note. Text left on this phone comes back, unsaved, until Save note
  // is tapped; it is dropped only once the database holds that same text.
  function loadAddMode() {
    const me = opts.teamMemberId()
    submitted = false
    noteId.value = null
    savedBody = ''
    base = ''
    draft.value = ''
    state.value = 'idle'
    const local = readLocal()
    const body = local?.body.trim() ?? ''
    if (body && notes.value.some((n) => n.created_by === me && n.body.trim() === body)) {
      clearLocal()
    } else if (body) {
      draft.value = local!.body
      state.value = 'dirty'
      addOpen.value = true
      return
    }
    addOpen.value = !notes.value.some((n) => me && n.created_by === me)
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
    if (addOnly()) {
      // Kept on the phone as it is typed, but only saved when asked.
      if (state.value === 'saving') return
      state.value = draft.value.trim() ? 'dirty' : 'idle'
      if (draft.value.trim()) writeLocal()
      else clearLocal()
      return
    }
    if (!opts.canWrite()) return
    state.value = draft.value.trim() === savedBody.trim() ? (noteId.value ? 'saved' : 'idle') : 'dirty'
    writeLocal()
    scheduleSave()
  }

  /** Add mode's "Save note": the one insert. */
  function submit(): Promise<void> {
    if (!addOnly() || !draft.value.trim()) return chain
    submitted = true
    return save()
  }

  /** Queue a save of whatever the box holds now. Saves never overlap. */
  function save(): Promise<void> {
    clearTimeout(debounce)
    chain = chain.then(saveNow, saveNow)
    return chain
  }

  async function saveNow() {
    if (addOnly()) return addNow()
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
    } catch (err) {
      errorKind.value = failureKind(err)
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

  // Add mode's save: a single insert of the box's text. Never an update -- the
  // role cannot change a note, including its own -- and never a second note
  // for the same text: a retry first looks for the row an earlier attempt may
  // have written before its reply was lost.
  let addAttempts = 0
  async function addNow() {
    if (!submitted || noteId.value) return
    const body = draft.value.trim()
    const accountId = opts.accountId()
    if (!body || !accountId) return
    const me = opts.teamMemberId() ?? null

    clearTimeout(retry)
    state.value = 'saving'
    errorKind.value = null
    let row: VisitNoteRow | null = null
    try {
      if (addAttempts > 0 && me) {
        const { data } = await supabase
          .from('visit_notes')
          .select('id, body, created_at, created_by, team_members(full_name)')
          .eq('appointment_id', opts.appointmentId)
          .eq('created_by', me)
          .eq('body', body)
          .limit(1)
        row = ((data as unknown as VisitNoteRow[]) ?? [])[0] ?? null
      }
      addAttempts++
      if (!row) {
        const { data, error } = await supabase
          .from('visit_notes')
          .insert({ account_id: accountId, appointment_id: opts.appointmentId, body, created_by: me })
          .select('id, body, created_at, created_by, team_members(full_name)')
          .single()
        if (error) throw error
        row = data as unknown as VisitNoteRow
      }
    } catch (err) {
      errorKind.value = failureKind(err)
    }

    if (row) {
      noteId.value = row.id
      if (!notes.value.some((n) => n.id === row!.id)) notes.value = [...notes.value, row]
      savedBody = body
      savedAt.value = new Date()
      retryMs = 2000
      addAttempts = 0
      submitted = false
      addOpen.value = false
      draft.value = ''
      state.value = 'saved'
      clearLocal()
      return
    }

    state.value = 'error'
    writeLocal()
    if (errorKind.value !== 'refused' && !disposed) {
      retry = setTimeout(() => void save(), retryMs)
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS)
    }
  }

  /** Offline, refused by RLS (42501: a write the role may not make), or anything else. */
  function failureKind(err: unknown): 'offline' | 'refused' | 'failed' {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
    if ((err as { code?: string } | null)?.code === '42501') return 'refused'
    return 'failed'
  }

  /** Whether a save is wanted: always in edit mode, only after Save note in add mode. */
  const wantsSave = () => !addOnly() || submitted

  /** Save now and wait for it (and anything queued) to finish. */
  async function flush() {
    if (wantsSave() && (state.value === 'dirty' || state.value === 'error')) await save()
    else await chain
  }

  function onOnline() {
    if (wantsSave() && (state.value === 'error' || state.value === 'dirty')) void save()
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
    if (wantsSave() && (state.value === 'dirty' || state.value === 'error')) void save()
    disposed = true
    clearTimeout(retry)
  })

  return { notes, otherNotes, noteId, draft, loading, loadError, state, savedAt, errorKind, addOpen, load, onInput, save, submit, flush }
}

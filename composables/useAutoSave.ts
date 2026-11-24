import type { WatchSource } from 'vue'

// Saves an editor's draft on its own: a while after the last change, at once
// when asked (blur, leaving, Cmd+S), one save at a time, and never silently
// wrong. Each state it can be in is shown to the person (UiAutoSaveStatus):
//
//   saved     nothing to write
//   pending   changed, waiting for the typing to stop
//   saving    a request is out
//   held      not written on purpose, and why (`message`): the editor said
//             this state must not be saved (`hold`), or the server refused it
//             for a reason the person has to settle
//   error     the save failed; retried on its own with a growing wait, when
//             the browser is back online, on the next change, or with Retry
//   conflict  saved somewhere else meanwhile; nothing more is written until
//             the person chooses (`resolve`), or every keystroke here would
//             overwrite the other copy
//
// It knows nothing about what is being saved: `save` does the writing and
// says how it went, `dirty` whether there is anything left to write.

export type AutoSaveState = 'saved' | 'pending' | 'saving' | 'held' | 'error' | 'conflict'

export type AutoSaveOutcome =
  | { ok: true }
  | { ok: false; state: 'held' | 'conflict'; message?: string }
  /** `retry`: worth trying again on its own (a dropped connection, a 5xx); not for a refusal. */
  | { ok: false; state: 'error'; message: string; retry?: boolean }

const RETRY_MS = [5_000, 15_000, 30_000, 60_000]

export function useAutoSave(opts: {
  /** What the person edits; any change to it schedules a save. Watched deeply. */
  source: WatchSource
  /** Something is loaded and may be saved at all. */
  ready: () => boolean
  /** There is something not yet written. */
  dirty: () => boolean
  /** A reason not to write the current state (shown as `held`), or null. Checked just before each save. */
  hold?: () => string | null
  save: () => Promise<AutoSaveOutcome>
  /** How long typing has to stop for, in ms. */
  delay: () => number
}) {
  const state = ref<AutoSaveState>('saved')
  const message = ref('')

  let timer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  // One save at a time: each waits for the one before it, so two never race
  // each other to the server (and the second never trips the first's version).
  let queue: Promise<unknown> = Promise.resolve()

  function clearTimers() {
    clearTimeout(timer)
    clearTimeout(retryTimer)
    timer = retryTimer = undefined
  }

  function apply(outcome: AutoSaveOutcome) {
    if (outcome.ok) {
      failures = 0
      message.value = ''
      // Edited while the request was out: those changes go with the next one.
      if (opts.dirty()) {
        state.value = 'pending'
        schedule()
      } else {
        state.value = 'saved'
      }
      return
    }
    state.value = outcome.state
    message.value = outcome.message ?? ''
    if (outcome.state === 'error' && outcome.retry) {
      const wait = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)]!
      failures += 1
      clearTimeout(retryTimer)
      retryTimer = setTimeout(() => flush(), wait)
    }
  }

  async function attempt() {
    clearTimers()
    if (state.value === 'conflict') return
    if (!opts.dirty()) {
      state.value = 'saved'
      message.value = ''
      return
    }
    if (!opts.ready()) return
    const reason = opts.hold?.() ?? null
    if (reason) {
      state.value = 'held'
      message.value = reason
      return
    }
    state.value = 'saving'
    let outcome: AutoSaveOutcome
    try {
      outcome = await opts.save()
    } catch (e) {
      // `save` is meant to say how it went rather than throw; if it throws
      // anyway, that is shown and retried, not swallowed.
      outcome = { ok: false, state: 'error', message: String((e as Error)?.message ?? e), retry: true }
    }
    apply(outcome)
  }

  /** Save now, after any save already under way. Resolves once it is done. */
  function flush(): Promise<void> {
    clearTimers()
    const next = queue.then(attempt, attempt)
    queue = next
    return next
  }

  /**
   * A save the editor makes on purpose (switching on, choosing what happens to
   * people on a removed step, "keep mine"), queued like any other so it never
   * runs beside an auto-save. Its outcome sets the state the same way.
   */
  function run(fn: () => Promise<AutoSaveOutcome>): Promise<AutoSaveOutcome> {
    clearTimers()
    const next = queue.then(async () => {
      state.value = 'saving'
      let outcome: AutoSaveOutcome
      try {
        outcome = await fn()
      } catch (e) {
        outcome = { ok: false, state: 'error', message: String((e as Error)?.message ?? e), retry: true }
      }
      apply(outcome)
      return outcome
    })
    queue = next.catch(() => {})
    return next
  }

  function schedule(ms = opts.delay()) {
    clearTimeout(timer)
    timer = setTimeout(() => flush(), ms)
  }

  /** After a conflict, once the person has chosen: auto-save picks up again. */
  function resolve() {
    state.value = opts.dirty() ? 'pending' : 'saved'
    message.value = ''
    if (opts.dirty()) schedule()
  }

  watch(
    opts.source,
    () => {
      if (!opts.ready() || state.value === 'conflict') return
      if (!opts.dirty()) {
        // Undone back to what is stored: nothing to write.
        if (state.value !== 'saving') {
          clearTimers()
          state.value = 'saved'
          message.value = ''
        }
        return
      }
      if (state.value === 'saved') state.value = 'pending'
      schedule()
    },
    { deep: true },
  )

  // Back online after a failed save: try straight away, not at the next back-off.
  const onOnline = () => {
    if (state.value === 'error') flush()
  }
  onMounted(() => window.addEventListener('online', onOnline))
  onBeforeUnmount(() => {
    clearTimers()
    window.removeEventListener('online', onOnline)
  })

  return { state: readonly(state), message: readonly(message), flush, run, resolve }
}

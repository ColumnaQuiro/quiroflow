// One request for several widgets asking the same question at once.
//
// The dashboard mounts its widgets side by side and each loads its own data,
// so "this week's appointments" went out three times on every visit (visits
// this week, the visit summary, the no-show rate), with the same filter and
// nearly the same columns. Asking under one key returns the same promise to
// everyone who asks while it is in flight, and for a moment after -- long
// enough for widgets that mount a tick later -- and never longer, so a
// reload, a filter change or coming back to the page asks again.
//
// Client-only by use: every caller runs in onMounted or later.
const entries = new Map<string, { promise: Promise<unknown>; settledAt: number | null }>()
const KEEP_MS = 2000

export function sharedFetch<T>(key: string, load: () => PromiseLike<T>): Promise<T> {
  const hit = entries.get(key)
  if (hit && (hit.settledAt === null || performance.now() - hit.settledAt < KEEP_MS)) return hit.promise as Promise<T>
  const entry: { promise: Promise<unknown>; settledAt: number | null } = { promise: Promise.resolve(), settledAt: null }
  entry.promise = Promise.resolve(load()).finally(() => {
    entry.settledAt = performance.now()
  })
  // A failure is not kept: the next caller tries again.
  entry.promise.catch(() => entries.delete(key))
  entries.set(key, entry)
  return entry.promise as Promise<T>
}

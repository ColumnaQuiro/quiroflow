// Refreshing an open Inbox thread by its tail rather than in full. Pure, with
// no `~` imports: the staff app auto-imports this directory too.
//
// The thread on screen is re-read only from a day before its newest message:
// that covers every message that has arrived since, and every tick (sent,
// delivered, read) that can still move -- statuses settle within hours. It
// used to re-read the newest 300 messages every minute and after every
// message that arrived.

/** How far back from the newest message a refresh re-reads. */
export const THREAD_TAIL_MS = 24 * 60 * 60 * 1000

export interface TailMessage {
  id: string
  created_at: string
}

/** The time a refresh re-reads from: a day before the newest message on screen. */
export function threadTailSince(current: TailMessage[]): number {
  return Math.max(...current.map((m) => Date.parse(m.created_at))) - THREAD_TAIL_MS
}

/**
 * The thread with its tail replaced by what the database returned for it.
 * Replaced, not added to: a message that has since left the conversation (its
 * number linked to a patient, say) leaves the screen too. Compared as times,
 * not text -- the database writes "+00:00" and microseconds, toISOString "Z"
 * and milliseconds.
 */
export function mergeThreadTail<M extends TailMessage>(current: M[], tail: M[], sinceMs: number): M[] {
  const byId = new Map(current.filter((m) => Date.parse(m.created_at) <= sinceMs).map((m) => [m.id, m]))
  for (const m of tail) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
}

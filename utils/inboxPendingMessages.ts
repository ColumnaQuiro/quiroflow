// A reply the Inbox has sent, shown twice for a moment and then jumping.
//
// Sending puts a bubble in the thread at once, with a clock, while the request
// is in flight. The send routes write the real row BEFORE they answer, so the
// row's realtime INSERT reloads the thread while that bubble is still there --
// and even without it, the bubble was only taken away once the sender's own
// reload had finished. For that moment the thread held both: the clock bubble
// and the real message with its tick. Removing the bubble then swapped one
// element for a differently-keyed one, which is the jump.
//
// So a bubble is not taken away; the real row takes its place. A pending
// bubble is matched to the row it became -- same conversation and channel,
// outbound, same text or same file, and newer than anything that thread
// already had when the bubble was made -- and from then on that row is drawn
// INSTEAD of the bubble, under the bubble's key. Vue sees one element whose
// clock turns into a tick.
//
// "Newer than the thread" is a server timestamp compared with a server
// timestamp, so the device's clock does not matter, and it is what stops a
// second "ok" from taking the row of the "ok" sent a minute earlier.

export interface ThreadMessage {
  id: string
  patient_id: string | null
  phone_number: string | null
  external_contact_id: string | null
  direction: string
  channel: string
  body_preview: string | null
  media_type: string | null
  media_filename: string | null
  created_at: string
  status: string
}

export interface PendingThreadMessage extends ThreadMessage {
  /**
   * created_at of the newest message the conversation held when this bubble
   * was made. Only a row newer than it can be this bubble's.
   */
  notBefore: string | null
}

export type Keyed<M> = M & { renderKey: string }

export function conversationKeyOf(m: Pick<ThreadMessage, 'patient_id' | 'phone_number' | 'external_contact_id'>): string {
  return m.patient_id ?? m.phone_number ?? m.external_contact_id ?? 'unknown'
}

/** The newest created_at among `messages` in the conversation `key`, or null. */
export function newestInConversation(messages: readonly ThreadMessage[], key: string): string | null {
  let newest: string | null = null
  for (const m of messages) {
    if (conversationKeyOf(m) === key && (!newest || m.created_at > newest)) newest = m.created_at
  }
  return newest
}

function sameContent(row: ThreadMessage, bubble: ThreadMessage): boolean {
  if (bubble.media_type) return row.media_type === bubble.media_type && row.media_filename === bubble.media_filename
  // The routes store the text cut to a length (2,000 for WhatsApp and
  // Instagram, 4,000 in-app), so a long reply is matched by that prefix.
  return !row.media_type && !!row.body_preview && !!bubble.body_preview && bubble.body_preview.startsWith(row.body_preview)
}

/**
 * Which server row each pending bubble became, as pending id -> row id. A
 * bubble that failed is never matched: a failed send writes no row.
 */
export function matchPendingToServer(server: readonly ThreadMessage[], pending: readonly PendingThreadMessage[]): Map<string, string> {
  const matched = new Map<string, string>()
  const taken = new Set<string>()
  const candidates = server.filter((m) => m.direction === 'outbound').slice().sort((a, b) => a.created_at.localeCompare(b.created_at))
  // Oldest bubble first takes the oldest row it fits, so two identical
  // replies sent in a row each get their own.
  for (const bubble of pending.slice().sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (bubble.status === 'failed') continue
    const key = conversationKeyOf(bubble)
    const row = candidates.find(
      (m) =>
        !taken.has(m.id) &&
        conversationKeyOf(m) === key &&
        m.channel === bubble.channel &&
        (bubble.notBefore === null || m.created_at > bubble.notBefore) &&
        sameContent(m, bubble),
    )
    if (row) {
      matched.set(bubble.id, row.id)
      taken.add(row.id)
    }
  }
  return matched
}

/**
 * The server rows, each keyed by the bubble it replaced (from `keptKeys`, or
 * matched now), followed by the bubbles nothing has replaced yet. Order is
 * left as given.
 *
 * `keptKeys` (row id -> bubble id) carries the bubble's key on after the
 * bubble itself is dropped, so the row never changes key and never remounts.
 */
export function mergePendingIntoThread<M extends ThreadMessage, P extends PendingThreadMessage>(
  server: readonly M[],
  pending: readonly P[],
  keptKeys: Readonly<Record<string, string>> = {},
): Keyed<M | P>[] {
  const matched = matchPendingToServer(server, pending)
  const bubbleOfRow = new Map<string, string>()
  for (const [bubbleId, rowId] of matched) bubbleOfRow.set(rowId, bubbleId)
  return [
    ...server.map((m) => ({ ...m, renderKey: keptKeys[m.id] ?? bubbleOfRow.get(m.id) ?? m.id })),
    ...pending.filter((p) => !matched.has(p.id)).map((p) => ({ ...p, renderKey: p.id })),
  ]
}

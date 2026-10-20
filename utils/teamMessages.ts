// The rules of team messages that do not need a database, so they are
// unit-tested: who a send pushes to, which thread a message belongs to for
// the person reading it, and how unread is counted.

export type TeamMessageKind = 'message' | 'alert'

export interface TeamMessageRow {
  id: string
  sender_id: string
  recipient_id: string | null
  kind: string
  body: string
  created_at: string
  room_id: string | null
  clinic_id: string | null
  acknowledged_by: string | null
  acknowledged_at: string | null
}

/** 'team' for the whole-team thread, else the colleague's team_members id. */
export type ThreadKey = 'team' | string

/**
 * Which thread a message sits in, seen from `me`: a whole-team message (an
 * alert included) is the team thread; a direct one is the thread with
 * whoever is on the other end.
 */
export function threadOf(m: Pick<TeamMessageRow, 'sender_id' | 'recipient_id'>, me: string): ThreadKey {
  if (!m.recipient_id) return 'team'
  return m.sender_id === me ? m.recipient_id : m.sender_id
}

/** Unread per thread: others' messages newer than where I read up to. */
export function unreadByThread(messages: TeamMessageRow[], me: string, reads: Record<string, string>): Record<ThreadKey, number> {
  const out: Record<string, number> = {}
  for (const m of messages) {
    if (m.sender_id === me) continue
    const key = threadOf(m, me)
    const readAt = reads[key]
    if (readAt && m.created_at <= readAt) continue
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}

/**
 * Who a send pushes to. A direct message: the recipient. A team message or
 * an alert: everyone but the sender. Alerts ignore push preferences and
 * quiet hours; messages honour them.
 */
export function teamPushPlan(input: {
  kind: TeamMessageKind
  senderId: string
  recipientId: string | null
  members: { id: string; user_id: string | null }[]
}): { userIds: string[]; respectPreferences: boolean } {
  const targets = input.kind === 'message' && input.recipientId ? input.members.filter((m) => m.id === input.recipientId) : input.members.filter((m) => m.id !== input.senderId)
  return {
    userIds: targets.map((m) => m.user_id).filter((u): u is string => !!u),
    respectPreferences: input.kind !== 'alert',
  }
}

/** An alert stays on screen until answered, and for at most this long. */
export const ALERT_VISIBLE_MS = 30 * 60 * 1000

export function openAlerts(messages: TeamMessageRow[], now = Date.now()): TeamMessageRow[] {
  return messages.filter((m) => m.kind === 'alert' && !m.acknowledged_at && now - new Date(m.created_at).getTime() < ALERT_VISIBLE_MS)
}

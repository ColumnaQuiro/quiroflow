// An appointment's audit trail, read back.
//
// fn_audit_log (0058_audit_logs.sql) writes one audit_logs row per change to
// an appointment's status, time, practitioner, room or type, with the team
// member who made it -- and writes the change itself as an English sentence,
// several joined by "; ":
//
//   Created
//   Status changed from booked to cancelled
//   Rescheduled to 25 Sep 16:00; Room changed
//   Deleted
//
// Printing that as-is would put English in a Spanish UI, and "Rescheduled
// to" carries a time formatted in the DATABASE's timezone (UTC), two hours
// off in Madrid. So the sentences are parsed back into facts here and the
// panel words them itself. Anything unrecognised is kept as raw text rather
// than dropped: a changed trigger should show up odd, not vanish.
//
// Pure, for the same reason as utils/visitPayment.ts.

export type ActivityChange =
  | { kind: 'created' }
  | { kind: 'deleted' }
  | { kind: 'status'; from: string; to: string }
  | { kind: 'time' }
  | { kind: 'practitioner' }
  | { kind: 'room' }
  | { kind: 'type' }
  | { kind: 'other'; text: string }

export function parseActivitySummary(summary: string): ActivityChange[] {
  const s = summary.trim()
  if (s === 'Created') return [{ kind: 'created' }]
  if (s === 'Deleted') return [{ kind: 'deleted' }]
  return s
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part): ActivityChange => {
      const status = /^Status changed from (\S+) to (\S+)$/.exec(part)
      if (status) return { kind: 'status', from: status[1], to: status[2] }
      if (part.startsWith('Rescheduled to')) return { kind: 'time' }
      if (part === 'Practitioner changed') return { kind: 'practitioner' }
      if (part === 'Room changed') return { kind: 'room' }
      if (part === 'Type changed') return { kind: 'type' }
      return { kind: 'other', text: part }
    })
}

/**
 * The reschedule row a "time changed" audit entry belongs to, if any.
 *
 * Moving a visit writes both: the appointment update (the trigger's
 * "Rescheduled to") and an appointment_reschedules row with the exact from
 * and to. The history already prints the reschedule row, so the audit entry
 * only contributes WHO -- matched by time, within a couple of minutes (the
 * two writes are sequential requests from the same click). A time change
 * with no reschedule row (an edit in the panel's "Cambiar") stands on its own.
 */
export function matchingMove<T extends { at: string }>(auditAt: string, moves: T[], windowMs = 120_000): T | null {
  const t = new Date(auditAt).getTime()
  let best: T | null = null
  let bestGap = Infinity
  for (const m of moves) {
    const gap = Math.abs(new Date(m.at).getTime() - t)
    if (gap <= windowMs && gap < bestGap) {
      best = m
      bestGap = gap
    }
  }
  return best
}

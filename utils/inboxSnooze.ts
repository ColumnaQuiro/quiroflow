// Snoozing a conversation (inbox_snoozes, per person): the times offered,
// and the rule for a lead thread, whose list is not inbox_conversations.
//
// Pure, with no `~` imports: the staff app auto-imports this directory too.
import { clinicDateOf, wallClock, wallClockToUtc } from './clinicClock'

export interface SnoozePreset {
  key: 'later' | 'tomorrow' | 'next_week'
  at: Date
}

function plusDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * "Later today" (three hours on, to the next quarter hour), "Tomorrow 9:00"
 * and "Next Monday 9:00" -- on the clinic's clock, so a 9:00 follow-up is the
 * clinic's 9:00 whatever zone the device is in.
 */
export function snoozePresets(now: Date, timeZone: string): SnoozePreset[] {
  const quarter = 15 * 60000
  const later = new Date(Math.ceil((now.getTime() + 3 * 3600000) / quarter) * quarter)
  const today = clinicDateOf(now, timeZone)
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay()
  const toMonday = ((8 - dow) % 7) || 7
  const out: SnoozePreset[] = []
  // Past the clinic's evening, "later today" is tomorrow anyway.
  if (clinicDateOf(later, timeZone) === today && wallClock(later, timeZone).hour < 21) out.push({ key: 'later', at: later })
  out.push({ key: 'tomorrow', at: new Date(wallClockToUtc(plusDays(today, 1), '09:00', timeZone)) })
  out.push({ key: 'next_week', at: new Date(wallClockToUtc(plusDays(today, toMonday), '09:00', timeZone)) })
  return out
}

export interface SnoozeRow {
  snoozed_until: string
  created_at: string
}

/**
 * The view's rule (inbox_conversations my_snoozed_until / my_follow_up),
 * for a lead thread: out of sight while the time has not come and nothing
 * has been written since it was snoozed; a follow-up once it has come and
 * the thread has not been opened since.
 */
export function snoozeStateOf(snooze: SnoozeRow | null | undefined, lastMessageAt: string | null, lastReadAt: string | null | undefined, now = new Date()): 'hidden' | 'follow_up' | null {
  if (!snooze) return null
  const until = Date.parse(snooze.snoozed_until)
  if (until > now.getTime()) return !lastMessageAt || Date.parse(lastMessageAt) <= Date.parse(snooze.created_at) ? 'hidden' : null
  return !lastReadAt || Date.parse(lastReadAt) < until ? 'follow_up' : null
}

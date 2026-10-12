// When the AI receptionist answers on its own, rather than leaving a draft.
//
// Two switches on Growth > Receptionist decide it against the clinic's
// opening hours: "answer outside clinic hours" (receptionist_config.
// after_hours, on by default) and "answer during clinic hours"
// (answer_during_hours, off by default -- in hours the front desk is there).
// When neither applies, the receptionist drafts as before.
//
// And even when they do, it stays quiet in a conversation a person from the
// clinic is in (they wrote within the last hour), and sends at most a few
// messages a day in any one conversation: past that it is a loop or a
// conversation that needs a person, and a draft waits instead.
//
// Pure, with no `~` imports: the app auto-imports this directory too, and in
// its build `~` resolves to mobile/.
import type { BusinessHours } from './businessHours'
import { DEFAULT_CLINIC_TIMEZONE, clinicDateOf, wallClock } from './clinicClock'

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/**
 * Whether the clinic is open at `now`, on its own clock. Null when it has no
 * opening hours set at all -- unknown, not closed.
 */
export function clinicOpenAt(now: Date, timeZone: string | null | undefined, hours: BusinessHours | null | undefined): boolean | null {
  if (!hours || !Object.values(hours).some((windows) => windows?.length)) return null
  const zone = timeZone || DEFAULT_CLINIC_TIMEZONE
  const day = DAY_KEYS[new Date(`${clinicDateOf(now, zone)}T12:00:00Z`).getUTCDay()]!
  const { hour, minute } = wallClock(now, zone)
  const mins = hour * 60 + minute
  return (hours[day] ?? []).some(([start, end]) => mins >= minutesOf(start) && mins < minutesOf(end))
}

/**
 * Whether the receptionist sends on its own now. Hours not set: read as
 * open -- the cautious reading, since in hours it only sends when the clinic
 * asked it to.
 */
export function autoReplyNow(config: { afterHours: boolean; answerDuringHours: boolean }, open: boolean | null): boolean {
  return open === false ? config.afterHours : config.answerDuringHours
}

/** A person from the clinic wrote in the conversation this recently: they are on it. */
export const PERSON_ACTIVE_MINUTES = 60
/** The most the receptionist sends in one conversation in 24 hours. */
export const MAX_AUTO_REPLIES_PER_DAY = 8

export interface ConversationMessage {
  direction: string
  sentByAi: boolean
  createdAt: string
}

/**
 * Why the receptionist must not send in this conversation now, or null.
 * 'person' -- someone from the clinic replied in the last hour;
 * 'limit' -- it already sent MAX_AUTO_REPLIES_PER_DAY in the last day.
 */
export function autoReplyHeldBack(messages: ConversationMessage[], now: Date): 'person' | 'limit' | null {
  const ms = now.getTime()
  const outbound = messages.filter((m) => m.direction === 'outbound')
  if (outbound.some((m) => !m.sentByAi && ms - new Date(m.createdAt).getTime() < PERSON_ACTIVE_MINUTES * 60_000)) return 'person'
  if (outbound.filter((m) => m.sentByAi && ms - new Date(m.createdAt).getTime() < 24 * 3600_000).length >= MAX_AUTO_REPLIES_PER_DAY) return 'limit'
  return null
}

/**
 * Whether a person has written in the conversation since `since` -- what
 * lifts a handover: the receptionist passed it on, and only once somebody
 * from the clinic has picked it up does it answer there again.
 */
export function personRepliedSince(messages: ConversationMessage[], since: string): boolean {
  const from = new Date(since).getTime()
  return messages.some((m) => m.direction === 'outbound' && !m.sentByAi && new Date(m.createdAt).getTime() > from)
}

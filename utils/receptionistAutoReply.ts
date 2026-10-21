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
import { isReactionBody } from './whatsappInbound'

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
  /**
   * Sent by the system, not by anyone: a WhatsApp template, or a message an
   * automation sent (a reminder, a drip). Not a person in the conversation.
   */
  automated?: boolean
  createdAt: string
}

/** Somebody from the clinic wrote it themselves: not the receptionist, not an automation. */
const byAPerson = (m: ConversationMessage) => m.direction === 'outbound' && !m.sentByAi && !m.automated

/**
 * Why the receptionist must not send in this conversation now, or null.
 * 'person' -- someone from the clinic replied in the last hour;
 * 'limit' -- it already sent MAX_AUTO_REPLIES_PER_DAY in the last day.
 */
export function autoReplyHeldBack(messages: ConversationMessage[], now: Date): 'person' | 'limit' | null {
  const ms = now.getTime()
  const outbound = messages.filter((m) => m.direction === 'outbound')
  // A reminder the clinic's automation sent at 14:45 is not somebody at the
  // desk answering: it held back the reply to "Cambiar cita" at 14:50.
  if (messages.some((m) => byAPerson(m) && ms - new Date(m.createdAt).getTime() < PERSON_ACTIVE_MINUTES * 60_000)) return 'person'
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
  return messages.some((m) => byAPerson(m) && new Date(m.createdAt).getTime() > from)
}

/**
 * How long the newest message has to sit before it is answered. People write
 * in bursts -- "Sí, claro.", then their name, then their email, then their
 * phone, seconds apart -- and a reply to the first would ask for what the
 * next three are about to say. The tick runs every minute, so a conversation
 * still being typed is simply picked up on the next one.
 */
export const TYPING_PAUSE_SECONDS = 40

/** Whether they may still be typing: their newest message is under TYPING_PAUSE_SECONDS old. */
export function stillTyping(newestInboundAt: string, now: Date, pauseSeconds = TYPING_PAUSE_SECONDS): boolean {
  return now.getTime() - new Date(newestInboundAt).getTime() < pauseSeconds * 1000
}

/**
 * What the model writes, alone, when the message needs no answer -- a thanks,
 * an "ok", a confirmation the reminder already recorded. Nothing is sent or
 * drafted for it.
 */
export const NO_REPLY = 'NO_REPLY'

/** Whether a reply is the model saying nothing needs to be said. */
export function isNoReply(text: string): boolean {
  return /^\W*NO_REPLY\W*$/.test(text.trim())
}

/** Lower case, no accents, no punctuation; emoji kept ("👍" is a message). */
function normalized(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}\p{Extended_Pictographic}]+/gu, ' ')
    .trim()
}

/**
 * Whether everything they have said since the clinic last wrote is one of the
 * clinic's no-reply phrases ("Confirmar", "Gracias", "👍") -- the whole
 * message, so "Gracias, ¿y el jueves?" is still a question.
 *
 * Never when the clinic's last message was a person or the receptionist
 * asking them something. "Vale" is on the list as a sign-off, but after
 * "¿Te confirmo el martes 3 a las 10:00?" it is the yes the booking waits
 * for: a lead from an ad picked a time, was asked to confirm, said "Vale"
 * and was left without the visit (20 Oct 2026). The model still sees the
 * whole conversation and can answer NO_REPLY itself when it really is a
 * sign-off. Only a typed question counts: an automatic message is left out,
 * because a reminder's "Confirmar" button is exactly what the list is for.
 */
export function isNoReplyMessage(
  messagesSinceLastReply: string[],
  phrases: string[],
  ourLastMessage?: { body: string; automated: boolean } | null,
): boolean {
  if (messagesSinceLastReply.length === 0) return false
  if (ourLastMessage && !ourLastMessage.automated && ourLastMessage.body.includes('?')) return false
  const known = new Set(phrases.map(normalized).filter(Boolean))
  // A reaction (a 👍 on the last reply) is never a question, whatever the
  // clinic's list says.
  return messagesSinceLastReply.every((text) => isReactionBody(text) || known.has(normalized(text)))
}

import { clinicDateOf, nextDate, wallClockToUtc } from './clinicClock'

// What the AI receptionist does to keep a visit instead of losing it.
//
// Measured at one clinic over 12 Oct - 19 Nov 2026, before any of this:
//   - a follow-up visit cancelled through it came back 9 times in 23 (staff:
//     11 in 39), and nearly every reply ended "escríbenos cuando quieras";
//   - "Cambiar cita" tapped on a reminder ended with a new time 49 times in
//     77, and cancelled with nothing booked 26 times;
//   - "ya te aviso" / "mañana te digo" was followed by a booking 9 times in
//     47 for patients and 0 in 5 for leads -- nobody wrote to them again;
//   - times offered late in the evening went unanswered and stayed that way.
//
// So: times offered go with buttons to tap, an offer nobody answers gets one
// nudge the next morning, "ya te aviso" gets a day on which the clinic writes
// first, and a second cancellation at short notice is said to be one.
//
// A plain module (no Nuxt auto-imports, no `~`): the unit tests pin it, and
// the app auto-imports this directory too, where `~` is mobile/.

// ---------------------------------------------------------------------------
// Times to tap
// ---------------------------------------------------------------------------

/** One time offered: the clinic's local day and clock. */
export interface OfferedSlot {
  /** YYYY-MM-DD */
  date: string
  /** HH:MM */
  time: string
}

/** The row id a tapped time comes back with. */
export const SLOT_ID_PREFIX = 'slot:'
/** The row that says none of them suits. */
export const SLOT_OTHER_ID = `${SLOT_ID_PREFIX}other`

export type SlotLanguage = 'es' | 'en' | 'fr'

const OTHER_DAY: Record<SlotLanguage, string> = { es: 'Otro día', en: 'Another day', fr: 'Un autre jour' }
const SLOT_BUTTON: Record<SlotLanguage, string> = { es: 'Elegir hora', en: 'Choose a time', fr: 'Choisir' }
const LOCALE: Record<SlotLanguage, string> = { es: 'es-ES', en: 'en-GB', fr: 'fr-FR' }

const SLOT_DATE = /^\d{4}-\d{2}-\d{2}$/
const SLOT_TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** At most this many times under one reply: with "another day" it is still a short list. */
export const MAX_SLOTS_TO_TAP = 6

/**
 * How a time reads on its button: "miércoles 24 · 11:00".
 *
 * The weekday in full and the day of the month, because that is what
 * offeredTimes (receptionistFollowThrough.ts) reads back when they tap it, so
 * the tap is taken as the one time it names. WhatsApp caps a reply button at
 * 20 characters, and the longest of these -- "miércoles 24 · 11:00" -- is 20.
 */
export function slotTitle(slot: OfferedSlot, language: SlotLanguage): string {
  const [y, m, d] = slot.date.split('-').map(Number)
  const weekday = new Date(Date.UTC(y!, m! - 1, d!, 12)).toLocaleDateString(LOCALE[language], { weekday: 'long', timeZone: 'UTC' })
  return `${weekday} ${d} · ${slot.time}`.slice(0, 20)
}

/** The times the model asked to offer, as they are: valid, in the order given, no repeats. */
export function cleanSlots(input: unknown, max = MAX_SLOTS_TO_TAP): OfferedSlot[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: OfferedSlot[] = []
  for (const raw of input) {
    const date = typeof (raw as { date?: unknown })?.date === 'string' ? (raw as { date: string }).date.trim() : ''
    const time = typeof (raw as { time?: unknown })?.time === 'string' ? (raw as { time: string }).time.trim().padStart(5, '0') : ''
    if (!SLOT_DATE.test(date) || !SLOT_TIME.test(time)) continue
    const key = `${date}T${time}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ date, time })
    if (out.length >= max) break
  }
  return out
}

/**
 * The choices sent under a reply that offers times: each time, then "another
 * day". Three or fewer go as buttons (one tap); more as a list.
 */
export function slotChoices(slots: OfferedSlot[], language: SlotLanguage): { button: string; rows: { id: string; title: string }[] } {
  return {
    button: SLOT_BUTTON[language],
    rows: [
      ...slots.map((slot) => ({ id: `${SLOT_ID_PREFIX}${slot.date}T${slot.time}`, title: slotTitle(slot, language) })),
      { id: SLOT_OTHER_ID, title: OTHER_DAY[language] },
    ],
  }
}

/** What a tapped row stands for: a time, 'other', or null when it is not one of these. */
export function slotFromRowId(id: string | null | undefined): OfferedSlot | 'other' | null {
  if (!id || !id.startsWith(SLOT_ID_PREFIX)) return null
  if (id === SLOT_OTHER_ID) return 'other'
  const [date, time] = id.slice(SLOT_ID_PREFIX.length).split('T')
  return date && time && SLOT_DATE.test(date) && SLOT_TIME.test(time) ? { date, time } : null
}

/** How long a time just offered is kept out of what other conversations are offered. */
export const SLOT_HOLD_MINUTES = 20

// ---------------------------------------------------------------------------
// Short notice
// ---------------------------------------------------------------------------

/** A visit cancelled or moved with less notice than this is at short notice. */
export const LATE_NOTICE_HOURS = 24
/** How far back an earlier one still counts. */
export const LATE_NOTICE_WINDOW_DAYS = 365

/** Whether a change made at `changedAt` to a visit starting at `startsAt` was at short notice. */
export function isLateNotice(changedAt: string | Date, startsAt: string | Date): boolean {
  const gap = new Date(startsAt).getTime() - new Date(changedAt).getTime()
  return gap > 0 && gap < LATE_NOTICE_HOURS * 3600_000
}

/** One change to a visit, as audit_logs holds it, with when the visit is now. */
export interface LateChangeRow {
  at: string
  changes: { starts_at?: { from?: string | null; to?: string | null }; status?: { from?: string | null; to?: string | null } } | null
  /** The visit's start as it is now: what a cancellation was of. */
  startsAt: string | null
}

/**
 * How many times they have already cancelled or moved a visit at short
 * notice, counted by day so "mejor el jueves... no, el viernes" is one.
 */
export function priorLateChanges(rows: LateChangeRow[], timeZone: string): number {
  const days = new Set<string>()
  for (const row of rows) {
    const moved = row.changes?.starts_at
    const was = moved?.from ?? (row.changes?.status?.to === 'cancelled' ? row.startsAt : null)
    if (!was) continue
    // A new time the same day at short notice is a nudge, not a lost visit.
    if (moved?.from && moved?.to && clinicDateOf(new Date(moved.from), timeZone) === clinicDateOf(new Date(moved.to), timeZone)) continue
    if (isLateNotice(row.at, was)) days.add(clinicDateOf(new Date(row.at), timeZone))
  }
  return days.size
}

/**
 * What the model is told after cancelling or moving a visit at short notice.
 *
 * The first time nothing is said: it happens to everyone. From the second,
 * the clinic's own rule for it is said, once and kindly -- what that rule is
 * (a session off the bono, a fee, nothing) is the clinic's, in its knowledge,
 * and whether it is applied is a person's.
 */
export function lateChangeNote(prior: number, what: 'cancelled' | 'moved'): string {
  if (prior < 1) {
    return `This was ${what} with less than ${LATE_NOTICE_HOURS} hours' notice, for the first time: say nothing about fees, sessions or notice.`
  }
  const times = prior === 1 ? 'once before' : `${prior} times before`
  return `This was ${what} with less than ${LATE_NOTICE_HOURS} hours' notice, and they have done that ${times}. Tell them so in one kind sentence, without reproach, and say what the clinic's rule is for a repeat as "What you know about this clinic" gives it (for example that the session may be taken off their bono) -- only if the clinic's knowledge has such a rule; if it has none, say only that it is not the first time at short notice and ask them to give more notice when they can. Never say anything has been charged or deducted: your colleague reviews it. Say it once.`
}

/** The same, for the team's note in the conversation. */
export function lateChangeStaffNote(prior: number): string {
  return prior < 1 ? '' : ` Aviso con menos de ${LATE_NOTICE_HOURS} h, y ya van ${prior + 1}: revisa si corresponde descontar la sesión. Se lo he dicho.`
}

// ---------------------------------------------------------------------------
// Writing first
// ---------------------------------------------------------------------------

export type FollowUpKind = 'nudge' | 'agreed'

/** When the clinic's morning starts for a message nobody is waiting on. */
export const FOLLOW_UP_HOUR = '09:30'
/**
 * When an agreed day is written on, by the part of the day they said they
 * would know: "hasta mañana por la tarde no sabré mis horarios" was written
 * to at 9:30, before they could know (20 Nov 2026).
 */
export const AGREED_HOURS = { morning: FOLLOW_UP_HOUR, afternoon: '17:00' } as const
export type AgreedPartOfDay = keyof typeof AGREED_HOURS
/** A follow-up this overdue is history: the moment has gone. */
export const FOLLOW_UP_MAX_LATE_HOURS = 36
/** Not twice in one conversation within this. */
export const NUDGE_EVERY_DAYS = 7

/**
 * When an offer nobody answered is asked about: the next morning, on the
 * clinic's clock. An offer made in the small hours is asked about that same
 * morning only if that leaves four hours; otherwise the morning after.
 */
export function nudgeDueAt(sentAt: Date, timeZone: string): Date {
  const today = clinicDateOf(sentAt, timeZone)
  const sameMorning = wallClockToUtc(today, FOLLOW_UP_HOUR, timeZone)
  if (sameMorning - sentAt.getTime() >= 4 * 3600_000) return new Date(sameMorning)
  return new Date(wallClockToUtc(nextDate(today), FOLLOW_UP_HOUR, timeZone))
}

/**
 * When the clinic writes on the day they agreed: that morning, or that
 * afternoon when they said they would only know by then. Null when the day is
 * not a date, is today or earlier, or is further than `maxDays` away.
 */
export function agreedDueAt(date: unknown, now: Date, timeZone: string, maxDays = 120, partOfDay: unknown = 'morning'): Date | null {
  if (typeof date !== 'string' || !SLOT_DATE.test(date.trim())) return null
  const day = date.trim()
  if (day <= clinicDateOf(now, timeZone)) return null
  const due = wallClockToUtc(day, partOfDay === 'afternoon' ? AGREED_HOURS.afternoon : AGREED_HOURS.morning, timeZone)
  if (!Number.isFinite(due) || due - now.getTime() > maxDays * 86_400_000) return null
  return new Date(due)
}

const greet = (name: string | null | undefined, language: SlotLanguage) => {
  const word = (name ?? '').replace(/[\r\n*_~`#<>]/g, ' ').trim().split(/\s+/)[0] ?? ''
  // A first name typed all in lower case into a lead form was greeted that way (20 Nov 2026): a name starts with a capital.
  const first = word ? word.charAt(0).toLocaleUpperCase('es') + word.slice(1) : ''
  const hello = language === 'en' ? 'Hello' : language === 'fr' ? 'Bonjour' : 'Hola'
  return first ? `${hello}, ${first}.` : `${hello}.`
}

/** The one message sent when times were offered and nobody answered. */
export function nudgeText(name: string | null | undefined, language: SlotLanguage): string {
  if (language === 'en') return `${greet(name, language)} Did you get a chance to look at the times I sent you? If another day suits you better, tell me which and I will find you one.`
  if (language === 'fr') return `${greet(name, language)} Avez-vous pu regarder les horaires que je vous ai proposés ? Si un autre jour vous convient mieux, dites-moi lequel et je vous trouve un créneau.`
  return `${greet(name, language)} ¿Pudiste mirar las horas que te propuse? Si te viene mejor otro día, dime cuál y te busco hueco.`
}

/** The message sent on the day they agreed the clinic would write. */
export function agreedText(name: string | null | undefined, language: SlotLanguage): string {
  // "Esta semana o la siguiente" was sent on a Friday, when this week was
  // that day alone (20 Nov 2026).
  if (language === 'en') return `${greet(name, language)} I said I would write to you today to find your appointment. Which days and what time of day suit you?`
  if (language === 'fr') return `${greet(name, language)} Je vous écris comme convenu pour trouver votre rendez-vous. Quels jours et à quel moment de la journée vous conviendraient ?`
  return `${greet(name, language)} Te escribo como quedamos, para buscar tu cita. ¿Qué días y a qué hora te vendría bien?`
}

const FOLLOW_UP_MARKS = [
  /pudiste mirar las horas que te propuse/i,
  /te escribo como quedamos, para buscar tu cita/i,
  /did you get a chance to look at the times i sent you/i,
  /i said i would write to you today to find your appointment/i,
  /avez-vous pu regarder les horaires que je vous ai propos/i,
  /je vous écris comme convenu pour trouver votre rendez-vous/i,
]

/**
 * Whether a message of the receptionist's is one of these follow-ups: they
 * ask after an offer, they are not an answer to it. So an offer for a visit
 * being moved still goes to a person when the visit is near
 * (receptionistPendingCancel.ts), nudge or no nudge.
 */
export function isFollowUpMessage(text: string | null | undefined): boolean {
  return FOLLOW_UP_MARKS.some((mark) => mark.test(text ?? ''))
}

/** Why a person is asked to write instead, when the follow-up cannot be sent by the receptionist. */
export function followUpTaskReason(kind: FollowUpKind): string {
  return kind === 'agreed'
    ? 'Quedé en escribirle hoy para buscarle cita y no puedo: han pasado más de 24 h desde su último mensaje (o ahora no respondo sola). Escríbele tú, con una plantilla si WhatsApp la pide.'
    : 'Le ofrecí horas y no ha contestado. Escríbele tú.'
}

/** What the decision on one due follow-up is. */
export type FollowUpDecision = 'send' | 'task' | 'drop'

/**
 * What to do with a follow-up that is due.
 *
 * Dropped when it no longer makes sense: they wrote since (a nudge is for
 * silence), a person at the clinic wrote since, a visit was booked or moved
 * since, a person has the conversation, or it is long overdue. Sent when the
 * channel lets the receptionist write and it answers on its own right now.
 * Otherwise, for a day they agreed, a person is asked to write; a nudge is
 * simply let go.
 */
export function followUpDecision(f: {
  kind: FollowUpKind
  dueAt: string
  now: Date
  theyWroteSince: boolean
  personWroteSince: boolean
  visitChangedSince: boolean
  withPerson: boolean
  doNotContact: boolean
  /** WhatsApp: their last message is under 24 hours old. The app has no such limit. */
  windowOpen: boolean
  answersNow: boolean
}): FollowUpDecision {
  if (f.personWroteSince || f.visitChangedSince || f.withPerson || f.doNotContact) return 'drop'
  if (f.kind === 'nudge' && f.theyWroteSince) return 'drop'
  if (f.now.getTime() - new Date(f.dueAt).getTime() > FOLLOW_UP_MAX_LATE_HOURS * 3600_000) return 'drop'
  if (f.windowOpen && f.answersNow) return 'send'
  return f.kind === 'agreed' ? 'task' : 'drop'
}

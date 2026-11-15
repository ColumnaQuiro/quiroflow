import { wallClockToUtc } from './clinicClock'
import type { ReceptionistAvailability } from './receptionistSlots'

// The rules for offering an earlier time to someone whose first visit is
// days away (earlier_visit_offers, 20261110194512). Pure, so the sweep that
// makes the offer (server/utils/earlierVisitOffers.ts), the webhook that reads
// the answer and the tests all hold the same numbers.

/** A first visit at least this far ahead when booked is enrolled. Mirrors `interval '2 days'` in earlier_visit_qualifies. */
export const EARLIER_VISIT_ENROL_DAYS = 2
/** An offered time is at least this much earlier than the visit they have: nobody is written to about moving an hour. */
export const EARLIER_VISIT_MIN_ADVANCE_HOURS = 12
/** And starts at least this far from now: someone new needs time to arrange it and get there. */
export const EARLIER_VISIT_MIN_NOTICE_HOURS = 3
/** How long they have to answer before the time is free to offer to somebody else. */
export const EARLIER_VISIT_REPLY_MINUTES = 45
/** Never open past this close to the time itself (as the waitlist's own offers). */
export const EARLIER_VISIT_CUTOFF_MINUTES = 20
/** The most times one visit is offered an earlier time, at one a day. */
export const EARLIER_VISIT_MAX_OFFERS = 3
/**
 * No offer within this long of the visit being booked or moved
 * (earlier_visit_offers.visit_changed_at). Whoever has just chosen a day has
 * said what suits them: on 12 Nov 2026 offers went out an hour, twenty
 * minutes and five minutes after one, one of them for that same afternoon to
 * a patient who had just put that afternoon off.
 */
export const EARLIER_VISIT_SETTLE_HOURS = 24
/** How long after an offer lapses the receptionist still reads a message as an answer to it. */
export const EARLIER_VISIT_ANSWER_HOURS = 48

/** Whether the visit has kept its day long enough to be offered another. */
export function visitSettled(visitChangedAt: string | Date | null | undefined, now: Date): boolean {
  if (!visitChangedAt) return true
  return now.getTime() - new Date(visitChangedAt).getTime() >= EARLIER_VISIT_SETTLE_HOURS * 60 * 60 * 1000
}

/**
 * Whether a patient may be offered an earlier time for this visit, given
 * their other enrolled first visits (`siblings`, this one left out). One
 * person is one conversation: with two first visits booked -- a duplicate
 * from booking twice -- they got two offers at once and a third the next
 * morning, after being told "no te escribiremos más" (12 Nov 2026).
 * 'declined' when they already said no on another: close this one too.
 */
export function patientOfferTurn(
  siblings: { status: string; lastOfferedDay: string | null }[],
  today: string,
): 'offer' | 'wait' | 'declined' {
  if (siblings.some((s) => s.status === 'declined')) return 'declined'
  if (siblings.some((s) => s.status === 'offered' || s.lastOfferedDay === today)) return 'wait'
  return 'offer'
}

/**
 * The WhatsApp template, approved by Meta in es, fr and en under this one
 * name. Body: {{1}} first name, {{2}} the time on offer, {{3}} their visit.
 * Two quick-reply buttons, accept first (EARLIER_VISIT_BUTTONS).
 */
export const EARLIER_VISIT_TEMPLATE = 'adelantar_primera_visita'

export type EarlierVisitLanguage = 'es' | 'fr' | 'en'

/** The template's buttons as each language's variant has them -- a tap comes back as its title. */
export const EARLIER_VISIT_BUTTONS: Record<EarlierVisitLanguage, { accept: string; decline: string }> = {
  es: { accept: 'Sí, adelantar', decline: 'No, me quedo con la mía' },
  fr: { accept: 'Oui, avancer', decline: 'Non, je garde le mien' },
  en: { accept: 'Yes, move it earlier', decline: 'No, keep mine' },
}

/** The language a patient is written to in: theirs when it is one the template has, else Spanish. */
export function earlierVisitLanguage(preferred: string | null | undefined): EarlierVisitLanguage {
  const base = (preferred ?? '').split(/[_-]/)[0]!.toLowerCase()
  return base === 'fr' || base === 'en' ? base : 'es'
}

const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

/**
 * Where to look for an earlier time for a visit starting at `visitStart`:
 * from the minimum notice to the minimum advance before their visit. Null
 * when that leaves nothing -- their visit is already close.
 */
export function earlierSearchWindow(now: Date, visitStart: Date): { from: Date; to: Date } | null {
  const from = new Date(now.getTime() + EARLIER_VISIT_MIN_NOTICE_HOURS * HOUR_MS)
  const to = new Date(visitStart.getTime() - EARLIER_VISIT_MIN_ADVANCE_HOURS * HOUR_MS)
  return to > from ? { from, to } : null
}

/**
 * When an offer made at `now` for a time starting at `slotStart` lapses:
 * min(now + reply window, slotStart - cutoff). Null when that is already past.
 */
export function earlierOfferExpiresAt(now: Date, slotStart: Date): Date | null {
  const at = Math.min(now.getTime() + EARLIER_VISIT_REPLY_MINUTES * MINUTE_MS, slotStart.getTime() - EARLIER_VISIT_CUTOFF_MINUTES * MINUTE_MS)
  return at > now.getTime() ? new Date(at) : null
}

/**
 * Whether a visit may be offered a time today: fewer than the most offers,
 * and none already on the clinic's calendar day it is now. `today` and the
 * last offer's day are both YYYY-MM-DD on the clinic's clock.
 */
export function mayOfferToday(row: { offers_made: number; lastOfferedDay: string | null }, today: string): boolean {
  return row.offers_made < EARLIER_VISIT_MAX_OFFERS && row.lastOfferedDay !== today
}

/**
 * The first candidate start inside `window` that does not overlap a time
 * already on offer to somebody else. `candidates` need not be sorted.
 */
export function firstFreeCandidate(
  candidates: { startsAt: Date; endsAt: Date }[],
  window: { from: Date; to: Date },
  onOffer: { startsAt: Date; endsAt: Date }[],
): { startsAt: Date; endsAt: Date } | null {
  return (
    [...candidates]
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .find((c) => c.startsAt >= window.from && c.startsAt <= window.to && !onOffer.some((o) => o.startsAt < c.endsAt && o.endsAt > c.startsAt)) ?? null
  )
}

/**
 * The free starts the receptionist's diary lists for one type at one clinic,
 * as instants with the visit's length. Asked for a single type, every list is
 * that type's -- a list names its types by name and length, never by id, so
 * it is chosen by clinic alone.
 */
export function earlierCandidates(
  availability: ReceptionistAvailability | null,
  clinicId: string,
  timeZone: string,
  durationMinutes: number,
): { startsAt: Date; endsAt: Date }[] {
  const out: { startsAt: Date; endsAt: Date }[] = []
  for (const group of availability?.groups ?? []) {
    if (group.clinicId !== clinicId) continue
    for (const day of group.days) {
      for (const time of day.times) {
        const startsAt = new Date(wallClockToUtc(day.date, time, timeZone))
        out.push({ startsAt, endsAt: new Date(startsAt.getTime() + durationMinutes * 60000) })
      }
    }
  }
  return out
}

function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * What a tap on the template's buttons means, in any of its languages. Only
 * the buttons: words typed in reply ("vale", "¿y a las 18?") are the
 * receptionist's to read, with the offer in front of it.
 */
export function earlierOfferReply(text: string): 'accept' | 'decline' | null {
  const said = plain(text)
  if (!said) return null
  for (const buttons of Object.values(EARLIER_VISIT_BUTTONS)) {
    if (said === plain(buttons.accept)) return 'accept'
    if (said === plain(buttons.decline)) return 'decline'
  }
  return null
}

const LOCALE: Record<EarlierVisitLanguage, string> = { es: 'es-ES', fr: 'fr-FR', en: 'en-GB' }

/**
 * "miércoles 12 de noviembre a las 17:00" / "mercredi 12 novembre à 17:00" /
 * "Wednesday 12 November at 17:00". Spanish without the commas the locale
 * puts after the weekday: the house style writes "el jueves 19 de noviembre".
 */
export function earlierVisitWhen(iso: string | Date, timeZone: string, language: EarlierVisitLanguage): string {
  const at = new Date(iso)
  const day = at.toLocaleDateString(LOCALE[language], { weekday: 'long', day: 'numeric', month: 'long', timeZone }).replace(/^(\p{L}+),\s*/u, '$1 ')
  const time = at.toLocaleTimeString(LOCALE[language], { hour: '2-digit', minute: '2-digit', hour12: false, timeZone })
  return language === 'es' ? `${day} a las ${time}` : language === 'fr' ? `${day} à ${time}` : `${day} at ${time}`
}

/** What they are told after tapping, in their language. */
export function earlierVisitReplyText(
  outcome: 'moved' | 'taken' | 'declined' | 'gone',
  language: EarlierVisitLanguage,
  when: { moved?: string; kept: string },
): string {
  const text: Record<EarlierVisitLanguage, Record<typeof outcome, string>> = {
    es: {
      moved: `Hecho: tu primera visita queda adelantada al ${when.moved}. Te esperamos.`,
      taken: `Vaya, ese hueco se acaba de ocupar. Mantienes tu primera visita del ${when.kept}.`,
      declined: `De acuerdo, mantienes tu primera visita del ${when.kept}. No te escribiremos más para adelantarla.`,
      gone: `Ese hueco ya no está disponible. Mantienes tu primera visita del ${when.kept}.`,
    },
    fr: {
      moved: `C'est fait ! Votre première visite est avancée au ${when.moved}. À bientôt.`,
      taken: `Désolés, ce créneau vient d'être pris. Vous gardez votre première visite du ${when.kept}.`,
      declined: `Entendu, vous gardez votre première visite du ${when.kept}. Nous ne vous écrirons plus pour l'avancer.`,
      gone: `Ce créneau n'est plus disponible. Vous gardez votre première visite du ${when.kept}.`,
    },
    en: {
      moved: `Done! Your first visit is now on ${when.moved}. See you then.`,
      taken: `Sorry, that time has just been taken. You keep your first visit on ${when.kept}.`,
      declined: `All right, you keep your first visit on ${when.kept}. We won't write again about moving it.`,
      gone: `That time is no longer available. You keep your first visit on ${when.kept}.`,
    },
  }
  return text[language][outcome]
}

/** "2026-11-12 17:00" on the clinic's clock: how book_appointment names a visit to move. */
function clockStamp(iso: string, timeZone: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}` }
}

/**
 * What the receptionist is told about an earlier time for their first visit
 * (loadEarlierVisitFacts). The offer goes out as a template whose text the
 * conversation history does not show, so without this a "vale" or "¿y a las
 * 18?" in answer to it would read as out of nowhere.
 */
export function earlierVisitPromptSection(
  facts: { status: 'waiting' | 'offered'; visitAt: string; offeredAt: string | null; expiresAt: string | null; lastOfferedAt?: string | null } | null | undefined,
  timeZone: string,
  opts: { canBook?: boolean; canStop?: boolean; now?: Date },
): string {
  if (!facts) return ''
  const now = opts.now ?? new Date()
  const visit = clockStamp(facts.visitAt, timeZone)
  const visitWords = earlierVisitWhen(facts.visitAt, timeZone, 'en')
  const stop = opts.canStop ? ' If they say they would rather keep theirs, or do not want these messages, call stop_earlier_time_offers.' : ''
  if (facts.status === 'offered' && facts.offeredAt) {
    const offered = clockStamp(facts.offeredAt, timeZone)
    const until = facts.expiresAt ? clockStamp(facts.expiresAt, timeZone).time : null
    return [
      '# An earlier time offered for their first visit',
      `Their first visit is on ${visitWords}. The clinic has just sent them a WhatsApp template (the "${EARLIER_VISIT_TEMPLATE}" message) offering to move it earlier, to ${earlierVisitWhen(facts.offeredAt, timeZone, 'en')}${until ? `, open until ${until}` : ''}. A short "sí", "vale" or "perfecto" after it is a yes to that time.`,
      opts.canBook
        ? `If they want it, move their visit with book_appointment: move_visit_on "${visit.date} ${visit.time}", date ${offered.date}, time ${offered.time}. If they ask for another earlier time instead, look for one with find_free_times if you have it, and move their visit only to a time they choose.`
        : 'If they want it, say your colleague will move it now.',
      stop.trim(),
    ].filter(Boolean).join('\n')
  }
  // An offer that lapsed unanswered is still what a late "me quedo con la
  // mía" or "el 19 está bien" answers. Read as a bare confirmation, one was
  // left with no reply at all (12 Nov 2026).
  const lapsed = facts.lastOfferedAt && now.getTime() - new Date(facts.lastOfferedAt).getTime() < EARLIER_VISIT_ANSWER_HOURS * 60 * 60 * 1000
  const answer = lapsed
    ? `\nOn ${earlierVisitWhen(facts.lastOfferedAt!, timeZone, 'en')} the clinic offered them an earlier time by WhatsApp (the "${EARLIER_VISIT_TEMPLATE}" message); that offer has lapsed. A message that answers it -- they keep theirs, or they name their own day ("el ${earlierVisitWhen(facts.visitAt, timeZone, 'es').split(' a las ')[0]} está bien") -- always gets a reply: one sentence saying they keep their first visit on that day and time${opts.canStop ? ', and call stop_earlier_time_offers' : ''}. Never leave it unanswered.`
    : ''
  return `# Earlier times for their first visit\nTheir first visit is on ${visitWords}. If an earlier time frees up, the clinic will offer it to them by WhatsApp.${stop}${answer}`
}

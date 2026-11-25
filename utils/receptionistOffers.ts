import { slotTitle, type OfferedSlot, type SlotLanguage } from './receptionistConversion'
import { chosenOfferedTime } from './receptionistFollowThrough'

// The times the receptionist offered, kept as data -- and what is done with
// them in code rather than by asking the model again.
//
// Until 23 Nov 2026 an offer lived only as the text of a WhatsApp message.
// The code knew the exact times when it sent them; then it threw them away,
// read its own message back with regular expressions when the person tapped
// one, wrote the model a note asking it to book, and the model chose the
// date, the time, the type and the chiropractor a second time before writing
// the confirmation in yet another round. Every step was a place to lose
// something, and in two days on Haiku each of them did:
//   - the turn after offer_times came back with no words, twice, and a move
//     already solved went to a person;
//   - a time offered "with another chiropractor" was booked with their own;
//   - a time a colleague had offered was handed over instead of booked.
// Each had been patched with another line in the prompt.
//
// So the offer is a row (receptionist_offers), a time accepted from it is
// booked by the code that offered it, and the words for an offer or a
// confirmation can always be written from the data when the model's are
// missing or wrong.
//
// A plain module (no Nuxt auto-imports, no `~`): the unit tests pin it, and
// the app auto-imports this directory too, where `~` is mobile/.

/** One time of an offer, with who it is free with when the offer was verified against the diary. */
export interface StoredOfferSlot extends OfferedSlot {
  practitionerId?: string | null
  practitionerName?: string | null
}

/** An offer as receptionist_offers keeps it. */
export interface StoredOffer {
  id: string
  createdAt: string
  slots: StoredOfferSlot[]
  /** The type a new visit would be; null for a move, which keeps the visit's own. */
  typeName: string | null
  /** The visit being moved, as "YYYY-MM-DD HH:MM" on the clinic's clock; null for a new visit. */
  moveVisitOn: string | null
  /** Whether the times are pinned to the chiropractor each was offered with. */
  pinned: boolean
  /** With whoever of the team is free (find_free_times' any_chiropractor). */
  anyChiropractor: boolean
  /**
   * Whether the code may book a time accepted from it on its own: an offer
   * to the person writing, of a type or a move it could resolve, with every
   * time checked free. Anything else is still the model's to book.
   */
  auto: boolean
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

const LANGUAGES: SlotLanguage[] = ['es', 'en', 'fr']

/** A time's clock as a reply writes it and clockTimes reads it: "9:45", not "09:45". */
export function slotClock(slot: OfferedSlot): string {
  return `${Number(slot.time.slice(0, 2))}:${slot.time.slice(3)}`
}

/**
 * The one time of `slots` their messages since the offer accept, or null.
 *
 * A tapped button arrives as its own title ("miércoles 2 · 16:30"), which is
 * that time and nothing else. Words are read as chosenOfferedTime reads
 * them, against the times as data rather than against the sentence the model
 * happened to write: "el miércoles 2 me viene genial" is one of two times
 * only when it can be no other.
 *
 * Every message since the offer has to say the same thing: a tap followed by
 * "ah no, mejor el jueves", or a time with a question beside it, is for the
 * model to read.
 */
export function matchAcceptedSlot<S extends OfferedSlot>(slots: S[], inbound: string[]): S | null {
  const messages = inbound.map((m) => m.trim()).filter(Boolean)
  if (!slots.length || !messages.length || messages.length > 2) return null
  let found: S | null = null
  for (const message of messages) {
    const slot = tappedSlot(slots, message) ?? saidSlot(slots, message)
    if (!slot) return null
    if (found && (found.date !== slot.date || found.time !== slot.time)) return null
    found = slot
  }
  return found
}

function tappedSlot<S extends OfferedSlot>(slots: S[], message: string): S | null {
  const text = fold(message)
  return slots.find((slot) => LANGUAGES.some((language) => fold(slotTitle(slot, language)) === text)) ?? null
}

function saidSlot<S extends OfferedSlot>(slots: S[], message: string): S | null {
  if (slots.length < 2) return null
  // The same reader as for an offer in words, given the times as a sentence.
  const sentence = `${slots.map((slot) => `el ${weekdayAndDay(slot)} a las ${slotClock(slot)}`).join(' o ')}?`
  const chosen = chosenOfferedTime(sentence, message)
  if (!chosen) return null
  const fits = slots.filter((slot) => slotClock(slot) === chosen.time && (chosen.dayOfMonth === null || Number(slot.date.slice(8)) === chosen.dayOfMonth))
  return fits.length === 1 ? fits[0]! : null
}

const LOCALE: Record<SlotLanguage, string> = { es: 'es-ES', en: 'en-GB', fr: 'fr-FR' }

function weekdayAndDay(slot: OfferedSlot): string {
  const [y, m, d] = slot.date.split('-').map(Number)
  const weekday = new Date(Date.UTC(y!, m! - 1, d!, 12)).toLocaleDateString('es-ES', { weekday: 'long', timeZone: 'UTC' })
  return `${weekday} ${d}`
}

/** "miércoles 2 de diciembre a las 16:30", "Wednesday 2 December at 16:30", "mercredi 2 décembre à 16h30". */
export function slotInWords(slot: OfferedSlot, language: SlotLanguage): string {
  const [y, m, d] = slot.date.split('-').map(Number)
  const at = new Date(Date.UTC(y!, m! - 1, d!, 12))
  const weekday = at.toLocaleDateString(LOCALE[language], { weekday: 'long', timeZone: 'UTC' })
  const month = at.toLocaleDateString(LOCALE[language], { month: 'long', timeZone: 'UTC' })
  const clock = slotClock(slot)
  if (language === 'en') return `${weekday} ${d} ${month} at ${clock}`
  if (language === 'fr') return `${weekday} ${d} ${month} à ${clock.replace(':', 'h')}`
  return `${weekday} ${d} de ${month} a las ${clock}`
}

/** A practitioner as a reply names them: by first name. */
function firstName(fullName: string | null | undefined): string {
  return (fullName ?? '').trim().split(/\s+/)[0] ?? ''
}

/**
 * An offer in words, from its times: what goes out when the model called
 * offer_times and then wrote nothing, or wrote times other than the ones
 * under its reply.
 */
export function offerInWords(slots: StoredOfferSlot[], language: SlotLanguage): string {
  if (!slots.length) return ''
  const names = [...new Set(slots.map((slot) => firstName(slot.practitionerName)))]
  const withWhom = names.length === 1 ? names[0]! : ''
  const or = { es: ' o ', en: ' or ', fr: ' ou ' }[language]
  const article = language === 'es' ? 'el ' : language === 'fr' ? 'le ' : ''
  const times = slots.map((slot) => `${article}${slotInWords(slot, language)}`)
  const list = times.length <= 2 ? times.join(or) : `${times.slice(0, -1).join(', ')}${or}${times[times.length - 1]}`
  if (language === 'en') return `I have ${list}${withWhom ? `, with ${withWhom}` : ''}. ${slots.length === 1 ? 'Does that suit you?' : 'Which suits you best?'}`
  if (language === 'fr') return `J'ai ${list}${withWhom ? `, avec ${withWhom}` : ''}. ${slots.length === 1 ? 'Cela vous convient ?' : 'Lequel vous convient le mieux ?'}`
  return `Tengo ${list}${withWhom ? `, con ${withWhom}` : ''}. ${slots.length === 1 ? '¿Te viene bien?' : '¿Cuál te viene mejor?'}`
}

/**
 * Whether the model's words offer the times under them: every one of them
 * is named, and no more times than the clinic allows in one reply. Their own
 * visits' times (`standing`, as "H:MM") may be named beside them -- "para
 * cambiar tu cita de las 19:45…" -- and are not counted.
 */
export function wordsMatchOffer(named: Set<string>, slots: OfferedSlot[], opts: { standing?: Set<string>; max?: number } = {}): boolean {
  const offered = new Set(slots.map(slotClock))
  for (const time of offered) if (!named.has(time)) return false
  const extra = [...named].filter((time) => !offered.has(time) && !opts.standing?.has(time)).length
  return offered.size + extra <= Math.max(opts.max ?? Infinity, offered.size)
}

/** What a booking or a move made in code came to, for its confirmation. */
export interface BookedDetails {
  moved: boolean
  typeName: string
  /** The clinic's local day and clock of the visit now. */
  slot: OfferedSlot
  practitionerName: string | null
  /** They asked for no automatic messages: no confirmation is promised. */
  quiet: boolean
  /** A first visit: where the clinic is. */
  address: string | null
  /** Their other visits within two days of it. */
  near: OfferedSlot[]
  /** The clinic will write if an earlier time frees up (earlierVisitOffers.ts). */
  earlierOffer: boolean
  /** Moved at short notice, and not for the first time: the clinic's rule for it is the model's to say. */
  repeatLateChange: boolean
  /** For somebody other than the person writing: the model's to word. */
  forSomeoneElse: boolean
}

/** Whether a confirmation can be written from the details alone. */
export function confirmationIsPlain(details: BookedDetails): boolean {
  return !details.repeatLateChange && !details.forSomeoneElse
}

/** The confirmation of a visit booked or moved, in words. */
export function confirmationInWords(details: BookedDetails, language: SlotLanguage): string {
  const when = slotInWords(details.slot, language)
  const who = firstName(details.practitionerName)
  const near = details.near.map((slot) => slotInWords(slot, language))
  if (language === 'en') {
    return [
      details.moved ? `Done: your visit is now on ${when}${who ? `, with ${who}` : ''}.` : `Booked: ${details.typeName} on ${when}${who ? `, with ${who}` : ''}.`,
      details.address ? `We are at ${details.address}.` : '',
      !details.moved && !details.quiet ? 'You will get our confirmation too.' : '',
      details.earlierOffer ? 'If an earlier time frees up, I will write to you.' : '',
      near.length ? `You also have a visit on ${near.join(' and on ')}. Do you want to keep ${near.length === 1 ? 'it' : 'them'}?` : '',
    ].filter(Boolean).join(' ')
  }
  if (language === 'fr') {
    return [
      details.moved ? `C'est fait : votre rendez-vous est déplacé au ${when}${who ? `, avec ${who}` : ''}.` : `C'est réservé : ${details.typeName} le ${when}${who ? `, avec ${who}` : ''}.`,
      details.address ? `Nous sommes au ${details.address}.` : '',
      !details.moved && !details.quiet ? 'Vous recevrez aussi notre confirmation.' : '',
      details.earlierOffer ? 'Si un créneau se libère plus tôt, je vous écris.' : '',
      near.length ? `Vous avez aussi rendez-vous le ${near.join(' et le ')}. Souhaitez-vous ${near.length === 1 ? 'le' : 'les'} garder ?` : '',
    ].filter(Boolean).join(' ')
  }
  return [
    details.moved ? `Hecho: tu cita queda cambiada al ${when}${who ? `, con ${who}` : ''}.` : `Reservado: ${details.typeName} el ${when}${who ? `, con ${who}` : ''}.`,
    details.address ? `Estamos en ${details.address}.` : '',
    !details.moved && !details.quiet ? 'Te llegará también la confirmación.' : '',
    details.earlierOffer ? 'Si se libera algo antes, te escribo.' : '',
    near.length ? `También tienes cita el ${near.join(' y el ')}. ¿${near.length === 1 ? 'La mantienes' : 'Las mantienes'}?` : '',
  ].filter(Boolean).join(' ')
}

/** How long after it was sent an offer may still be accepted in code. */
export const OFFER_OPEN_DAYS = 7

/** How long a time accepted with no visit to show for it may wait before a person is told. */
export const ACCEPTED_UNBOOKED_MINUTES = 10

/**
 * How long a time they chose stays held while the receptionist asks for what
 * it still needs to book it (heldTimeNote). Busy for every other conversation
 * meanwhile, so not a whole day: long enough to answer after work.
 */
export const ACCEPTED_HOLD_HOURS = 12

/**
 * How long after the receptionist asked for those details, with no answer, a
 * person is told (handOverAcceptedUnbooked).
 */
export const ACCEPTED_DETAILS_WAIT_MINUTES = 120

/**
 * What the model is told when they chose one of its times and the code could
 * not book it yet: for someone else (a child, a partner, someone new they
 * bring) or for someone new whose details are not on record.
 *
 * On 13 Nov 2026 a mother chose the 26th at 16:00 for her daughter, the
 * receptionist asked for the daughter's name instead of booking, nobody
 * answered, and the time was gone. "Book the chosen time before asking for a
 * companion's details" was a line in a card; now the time is held in code
 * (receptionist_slot_holds) and offering others is refused (runReceptionistModel).
 */
export function heldTimeNote(slot: OfferedSlot, heldUntil: string): string {
  return [
    '# Their answer picks one of your times',
    `They chose ${slot.date} at ${slotClock(slot)} from the times you offered. The clinic's system is holding that time for them until ${heldUntil}; nobody else can take it meanwhile.`,
    'Book it now with book_appointment if you have everything the booking needs (for someone in their family on record, or a child, with their name; for themselves, as usual), and confirm it.',
    'If something is missing -- the name and mobile of the person it is for, or their own details if they are new -- ask only for that, in one short message, and say the time is kept for them. Book it as soon as they answer.',
    'Do not offer other times and do not ask them to choose again.',
  ].join('\n')
}

/** What a person is told when a time was chosen and held, details were asked for, and nothing came back. */
export function acceptedHeldReason(slot: OfferedSlot): string {
  return `Eligió la hora que le ofrecí, el ${slotInWords(slot, 'es')}; le pedí los datos para reservarla y no ha contestado. La hora está retenida unas horas: resérvasela o escríbele.`
}

/** What a person is told when a time was accepted and the diary does not have it. */
export function acceptedUnbookedReason(slot: OfferedSlot): string {
  return `Aceptó la hora que le ofrecí, el ${slotInWords(slot, 'es')}, y esa cita no está en la agenda. Resérvasela o contéstale.`
}

// What the receptionist does without asking the model: the cases where a
// rule kept being written into the prompt and kept not being followed, so the
// code now decides it.
//
// A plain module (no Nuxt auto-imports) so the unit tests can pin it.

/**
 * A voice note: it cannot be heard, so it is always a person's. The rule was
 * in every prompt, and on 2 Nov 2026 a voice note sent with two photos was
 * answered, and a visit moved, from what the receptionist could not hear.
 */
export function isVoiceNote(mediaType: string | null | undefined): boolean {
  return mediaType === 'audio'
}

/** The fixed answer to a voice note (BASE_ESCALATIONS says the same words). */
export const VOICE_NOTE_REPLY = 'No puedo escuchar notas de voz; mi compañera la escuchará y te contestará.'

/** Why a voice note went to a person, for the handover note. */
export const VOICE_NOTE_REASON = 'Ha enviado una nota de voz: escúchala y contéstale.'

/**
 * Why a reply the receptionist wrote did not go out, for the handover note.
 * Refused by WhatsApp ("do not contact", the 24-hour window, a bad number), it
 * used to stay as a draft nobody was told about: a patient asking for times
 * at 9:53 was answered by a person at 18:53 (6 Nov 2026).
 */
export function sendFailedReason(err: unknown): string {
  const raw = (err as { message?: unknown } | null)?.message ?? err
  const message = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 140) : ''
  return `No he podido enviar mi respuesta${message ? ` (${message})` : ''}. Te la he dejado como borrador: revísala y envíasela tú.`
}

/**
 * What is sent when the receptionist could not answer and the conversation
 * went to a person. It used to send nothing: a lead who proposed a time at
 * 19:49 was handed over in silence and heard from the clinic at 9:27 the next
 * morning (11 Nov 2026).
 */
export const HANDED_OVER_REPLY = 'Se lo paso a mi compañera y te contesta en cuanto pueda.'

/** Why a reply that could not be written went to a person, for the handover note. */
export const REFUSED_REASON = 'La recepcionista no ha podido responder a su último mensaje. Le he dicho que mi compañera le contestará.'

// "mi compañera ... confirmará / revisará / añadirá / te escribe", "se lo paso
// a mi compañera", and the same in English and French.
const COLLEAGUE = String.raw`(?:mi|mis|nuestra|nuestras)\s+compa[nñ]er[oa]s?|el\s+equipo|recepci[oó]n|my\s+colleagues?|the\s+team|ma\s+coll[eè]gue|mon\s+coll[eè]gue|l['’][eé]quipe`
const ACTS = String.raw`(?:te\s+|le\s+|lo\s+|la\s+|los\s+|las\s+|se\s+)*(?:confirmar[aá]n?|revisar[aá]n?|a[nñ]adir[aá]n?|escribir[aá]n?|contestar[aá]n?|responder[aá]n?|llamar[aá]n?|gestionar[aá]n?|mirar[aá]n?|comprobar[aá]n?|dir[aá]n?|ver[aá]n?|encargar[aá]n?|ocupar[aá]n?|pondr[aá]n?|subir[aá]n?|guardar[aá]n?|reservar[aá]n?|escuchar[aá]n?|confirma|revisa|a[nñ]ade|escribe|contesta|responde|llama|gestiona|mira|comprueba|encarga|ocupa|pone|va\s+a\s+\p{L}+r|will|is\s+going\s+to|vous\s+\p{L}+ra)(?![\p{L}\p{N}])`
const PROMISE = new RegExp(String.raw`(?<![\p{L}])(?:${COLLEAGUE})(?![\p{L}])[^.!?\n]{0,40}?(?<![\p{L}])(?:${ACTS})|(?<![\p{L}])(?:se\s+lo|te\s+lo|lo|la|se\s+la)\s+paso\s+a\s+(?:${COLLEAGUE})|(?<![\p{L}])pass(?:ing)?\s+(?:it|this)\s+(?:on\s+)?to\s+(?:${COLLEAGUE})|(?<![\p{L}])je\s+(?:le\s+|la\s+)?transmets`, 'iu')

/**
 * The sentence of a reply that promises a colleague will do something -- or
 * null. A promise like that is only kept if a person is told: the reply goes
 * with a handover whether or not the model called hand_over_to_colleague.
 *
 * "Mi compañera te confirmará" was written three times to a patient with no
 * handover and nobody wrote back all day (10 Nov 2026); "mi compañera la
 * añadirá a tu ficha", of an X-ray sent in, the next day.
 */
export function colleaguePromise(text: string): string | null {
  for (const sentence of text.split(/(?<=[.!?;])\s+|\n+/)) {
    const s = sentence.trim()
    if (s && PROMISE.test(s)) return s
  }
  return null
}

/** The handover note for a promise the reply made (colleaguePromise). */
export function colleaguePromiseReason(sentence: string): string {
  return `Le he dicho: «${sentence.slice(0, 200)}». Encárgate tú.`
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const WEEKDAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']
const WEEKDAY = WEEKDAYS.join('|')
/** "a las 9:00 a 13:00", "entre las 9:00 y las 13:00": opening hours, not times offered. */
const RANGE = /\bentre\s+las\s+\d{1,2}[:.h]\d{2}\s+y\s+las\s+\d{1,2}[:.h]\d{2}\b|\b\d{1,2}[:.h]\d{2}\s*(?:-|–|a|hasta)\s*(?:las\s+)?\d{1,2}[:.h]\d{2}\b/g

/** One time offered in a message: the day it was said for, and the clock time. */
export interface OfferedTime {
  weekday: string | null
  dayOfMonth: number | null
  /** 'hoy' or 'manana' when the day was said that way. */
  relative: 'hoy' | 'manana' | null
  time: string
}

/**
 * The times a message offers, each with the day said before it: "el martes
 * 10 de noviembre a las 9:00 o el jueves 12 a las 15:30" is two, "hoy a las
 * 18:15 o a las 19:45" two on the same day.
 */
export function offeredTimes(text: string): OfferedTime[] {
  const t = fold(text).replace(RANGE, ' ')
  const token = new RegExp(`\\b(${WEEKDAY})(?:\\s+(\\d{1,2}))?\\b|\\b(hoy)\\b|(?<!la\\s)\\b(manana)\\b|\\b(?:el\\s+)?(\\d{1,2})\\s+de\\s+[a-z]+\\b|\\b([01]?\\d|2[0-3])[:.h]([0-5]\\d)\\b`, 'g')
  const out: OfferedTime[] = []
  let day: Omit<OfferedTime, 'time'> = { weekday: null, dayOfMonth: null, relative: null }
  for (const m of t.matchAll(token)) {
    if (m[1]) day = { weekday: m[1], dayOfMonth: m[2] ? Number(m[2]) : null, relative: null }
    else if (m[3]) day = { weekday: null, dayOfMonth: null, relative: 'hoy' }
    else if (m[4]) day = { weekday: null, dayOfMonth: null, relative: 'manana' }
    else if (m[5]) day = { ...day, dayOfMonth: Number(m[5]) }
    else if (m[6]) out.push({ ...day, time: `${Number(m[6])}:${m[7]}` })
  }
  const seen = new Set<string>()
  return out.filter((o) => {
    const key = `${o.weekday}|${o.dayOfMonth}|${o.relative}|${o.time}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * The one time, of those the receptionist just offered, that their answer
 * can only mean -- or null when it could be more than one, or none.
 *
 * CONFIRM_BEFORE_BOOKING says this in the prompt, and still: offered "martes
 * 10 a las 9:00 o jueves 12 a las 15:30", "Perdón sí, el 12" was asked
 * "¿Te confirmo entonces el jueves 12…?", nobody answered, and the patient was
 * left without the visit she had chosen (5 Nov 2026). Worked out here, the
 * prompt is told which time it is.
 *
 * Only a short answer with no question and no "no" in it: "¿y el 12 por la
 * tarde?" or "el 12 no puedo" chooses nothing.
 */
export function chosenOfferedTime(offer: string, answer: string): OfferedTime | null {
  if (!offer.includes('?')) return null
  const offers = offeredTimes(offer)
  if (offers.length < 2) return null
  const reply = fold(answer).trim()
  if (!reply || reply.length > 80 || reply.includes('?') || /\bno\b/.test(reply)) return null

  const time = [...reply.matchAll(/\b([01]?\d|2[0-3])[:.h]([0-5]\d)\b/g)].map((m) => `${Number(m[1])}:${m[2]}`)
  const bare = reply.replace(/\b\d{1,2}[:.h]\d{2}\b/g, ' ')
  const hour = [...bare.matchAll(/\blas\s+(\d{1,2})\b/g)].map((m) => Number(m[1]))
  const withoutHours = bare.replace(/\blas\s+\d{1,2}\b/g, ' ')
  const days = [...withoutHours.matchAll(/\b(\d{1,2})\b/g)].map((m) => Number(m[1])).filter((n) => n >= 1 && n <= 31)
  const weekdays = WEEKDAYS.filter((w) => new RegExp(`\\b${w}\\b`).test(reply))
  const relative = /\bhoy\b/.test(reply) ? 'hoy' : /(?<!la\s)\bmanana\b/.test(reply) ? 'manana' : null
  const ordinal = /\b(la\s+)?primera\b/.test(reply) ? 0 : /\b(la\s+)?(segunda|ultima)\b/.test(reply) ? offers.length - 1 : null
  if (!time.length && !hour.length && !days.length && !weekdays.length && !relative && ordinal === null) return null
  if (ordinal !== null && (time.length || hour.length || days.length || weekdays.length || relative)) return null
  if (ordinal !== null) return offers.length === 2 ? offers[ordinal]! : null

  const fits = offers.filter((o) =>
    time.every((t) => o.time === t) &&
    hour.every((h) => Number(o.time.split(':')[0]) === h) &&
    days.every((d) => o.dayOfMonth === d) &&
    weekdays.every((w) => o.weekday === w) &&
    (!relative || o.relative === relative),
  )
  return fits.length === 1 ? fits[0]! : null
}

/** How a chosen time reads in the prompt: "martes 10 at 9:00". */
export function offeredTimeLabel(o: OfferedTime): string {
  const day = o.relative === 'hoy' ? 'today' : o.relative === 'manana' ? 'tomorrow' : [o.weekday, o.dayOfMonth].filter((x) => x !== null).join(' ')
  return `${day || 'the day you offered'} at ${o.time}`
}

/** The line the prompt gets when their answer picks one offered time. */
export function chosenTimeNote(o: OfferedTime, canBook: boolean): string {
  return `# Their answer picks one time\nTheir latest message can only mean one of the times you offered in your last message: ${offeredTimeLabel(o)}. ${canBook ? 'Book it now with book_appointment (with move_visit_on if it moves a visit they already have) and do not ask them to confirm it again.' : 'Take it as their choice and do not ask them to confirm it again.'}`
}

/**
 * Whether the receptionist's message asks if it should cancel a visit:
 * "¿Te quito la cita del jueves 5 a las 16:00?", "¿la cancelamos?".
 */
export function asksWhetherToCancel(text: string): boolean {
  const t = fold(text)
  if (!t.includes('?')) return false
  return /\b(te\s+quito\s+(mientras\s+tanto\s+)?(la|tu)\s+(cita|del?)|te\s+la\s+quito|te\s+la\s+cancelo|la\s+cancelo|la\s+cancelamos|te\s+la\s+anulo|la\s+anulamos|quieres\s+que\s+(te\s+)?(la\s+)?(cancele|anule|quite))\b/.test(t)
}

/**
 * Whether a message of theirs asks to change a visit or says they cannot
 * come to it: the reminder's "Cambiar cita" button, "¿podemos mover la del
 * martes?", "la semana que viene no puedo".
 */
export function asksToChangeVisit(text: string): boolean {
  const t = fold(text)
  return /\b(cambiar|cambio|cambiarla|mover|moverla|anular|cancelar|no\s+(puedo|podre|podria|voy\s+a\s+poder))\b/.test(t)
}

/**
 * Whether the receptionist's message offers times and waits for an answer:
 * "El miércoles 18 tengo las 16:30 o las 17:45, ¿te viene bien alguna?".
 */
export function offersTimes(text: string): boolean {
  return text.includes('?') && offeredTimes(text).length > 0
}

/** How long they are given to answer before it goes to a person. */
export const CANCEL_QUESTION_GRACE_MS = 60 * 60_000
/** Handed over once the visit is this close. */
export const CANCEL_QUESTION_LEAD_MS = 24 * 3600_000

/**
 * Whether a cancel question nobody answered goes to a person now: the visit
 * is still ahead, within a day, and they have had an hour to answer.
 *
 * Asked "¿te quito la cita?" and silent, a lead's first visit stayed booked
 * for a day she had said she would not come (4 Nov 2026). A person can still
 * call her before the time is lost.
 */
export function cancelQuestionDue(opts: { askedAt: string; visitStartsAt: string; now: Date }): boolean {
  const now = opts.now.getTime()
  const visit = new Date(opts.visitStartsAt).getTime()
  const asked = new Date(opts.askedAt).getTime()
  return visit > now && visit - now <= CANCEL_QUESTION_LEAD_MS && now - asked >= CANCEL_QUESTION_GRACE_MS && visit > asked
}

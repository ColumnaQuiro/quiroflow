import { teamCallNames } from './receptionistClinic'

// The house style of a receptionist reply, checked in code after the model
// has written it.
//
// Every one of these is already a line in the prompt, and every one of them
// was broken anyway on some day of the first three weeks: an emoji, a
// "¡Perfecto!", "un compañero", "20/10", the ad named, a practitioner called
// by her full name. Another line in the prompt was the fix each time, and
// each time it held until it did not. A check that reads the finished text
// does not drift: what can be fixed by hand is fixed here, and what needs
// rewording goes back to the model once (runReceptionistModel).
//
// A plain module (no Nuxt auto-imports) so the unit tests can pin it.

export type StyleProblem = 'emoji' | 'opener' | 'colleague' | 'numeric_date' | 'ad' | 'surname' | 'price_reason' | 'affection'

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]\u{FE0F}?/gu

/** "¡Perfecto!", "Genial,", "¡Claro que sí!" at the very start. */
const OPENER = /^\s*¡?\s*(?:perfecto|perfecta|genial|estupendo|estupenda|fenomenal|excelente|claro que s[ií]|claro|por supuesto|great|perfect|awesome|sure)\s*[!¡.,:]*\s*/iu

/** A greeting that shouts: "¡Hola, María!", "¡Buenas tardes!". */
const EXCLAIMED_GREETING = /^\s*¡\s*((?:hola|buenas|buenos)[^!]*)!\s*/iu

/** Somebody in the clinic spoken of as a stranger in a queue. */
const STRANGER = /(?<!\p{L})(?:un compañero|una compañera|un miembro del equipo|alguien del equipo|a colleague|a team member)(?!\p{L})/iu

/** 20/10, 20-10-2026, 2026-10-20: dates go in words. */
const NUMERIC_DATE = /(?<![\d:.,])(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|20\d\d-\d\d-\d\d)(?![\d:])/u

/** The ad named to the person: the offer is the clinic's, never "because you came from our ad". */
const AD = /(?<!\p{L})(?:anuncio|anuncios|publicidad|our ad|the ad)(?!\p{L})/iu

/**
 * A price explained instead of given: "a precio estándar", "como no es
 * paciente nuestro". The price is the price. On 13 Nov 2026 a new patient
 * recommended by someone from another clinic was told "como [quien te recomendó] no es
 * paciente de nuestro centro, te reservo la primera visita a precio estándar
 * (70 €)" -- which says who is and is not a patient here, and makes 70 €
 * sound like the price for those who do not qualify.
 */
const PRICE_REASON = /(?<!\p{L})(?:precio|tarifa)s? (?:est[aá]ndar|normal|habitual|completo|completa|general|base)(?!\p{L})|(?<!\p{L})(?:standard|regular|normal|full) (?:price|rate|fee)s?(?!\p{L})|(?<!\p{L})no (?:es|era|sea) (?:un |una )?paciente(?!\p{L})|(?<!\p{L})(?:is not|isn['’]t|was not|wasn['’]t) (?:a )?patient(?!\p{L})/iu

/**
 * A sign-off a friend would write: "¡Un beso!", "Un abrazo fuerte", "Besos",
 * "te quiero".
 * A patient who ends with "un beso" got "¡Un beso!" back, twice, the second
 * time under a message telling him his visit was not today (19 Nov 2026).
 */
const AFFECTION_WORDS = '(?:(?:un|muchos|mil)\\s+)?(?:fuerte\\s+)?(?:besos?|besitos?|besazos?|abrazos?|abracitos?|abrazotes?)(?:\\s+(?:muy\\s+)?(?:fuertes?|grandes?|enormes?))?|(?:big\\s+)?(?:hugs?|kiss(?:es)?)(?:\\s+and\\s+(?:hugs?|kiss(?:es)?))?|te\\s+quiero(?:\\s+mucho)?|os\\s+quiero(?:\\s+mucho)?'
const AFFECTION = new RegExp(`(?<!\\p{L})(?:${AFFECTION_WORDS})(?!\\p{L})`, 'iu')
/** One of those as a sentence of its own, with the space before it. */
const AFFECTION_SENTENCE = new RegExp(`(^|[.!?…\\n])[ \\t]*[¡(]?[ \\t]*(?:y[ \\t]+)?(?:${AFFECTION_WORDS})[ \\t]*(?:[.!)]+|(?=\\n|$))`, 'giu')
/** ...or hung on the end of one: "Hasta el jueves, un beso." */
const AFFECTION_TAIL = new RegExp(`[ \\t]*,[ \\t]*(?:y[ \\t]+)?(?:${AFFECTION_WORDS})[ \\t]*(?=[.!]|\\n|$)`, 'giu')
/**
 * A pet name, where it is one: called to them after a comma or to open the
 * reply ("Gracias, guapa.", "Cariño, tu cita..."). "El corazón" or "con
 * cariño" in a sentence is not.
 */
const PET_NAMES = '(?:mi\\s+)?(?:cari(?:ñ[oa])?|guap[oa]|guap[ií]sim[oa]|cielo|coraz[oó]n|bonit[oa]|precios[oa]|rein[ao]|rey|tesoro|amor|maj[oa]|nen[ae]|chiquill[oa]|bombón|love|honey|darling|sweetie|dear)'
const PET_NAME_CALLED = new RegExp(`[ \\t]*,[ \\t]*(?:${PET_NAMES})(?=[ \\t]*(?:[.!?,:;]|\\n|$))`, 'giu')
const PET_NAME_OPENING = new RegExp(`^\\s*¡?\\s*(?:(?:hola|buenas|buenos d[ií]as|buenas tardes|gracias)[ \\t]*,?[ \\t]+)?(?:${PET_NAMES})[ \\t]*[,:!.][ \\t]*`, 'iu')

/**
 * What is wrong with a reply, in the order the rewrite note lists it.
 * `teamNames`: the practitioners' full names (loadTeamNames).
 */
export function styleProblems(text: string, teamNames: string[] = []): StyleProblem[] {
  const found: StyleProblem[] = []
  if (new RegExp(EMOJI.source, 'u').test(text)) found.push('emoji')
  if (OPENER.test(text) || EXCLAIMED_GREETING.test(text)) found.push('opener')
  if (STRANGER.test(text)) found.push('colleague')
  if (NUMERIC_DATE.test(text)) found.push('numeric_date')
  if (AD.test(text)) found.push('ad')
  if (surnamesUsed(text, teamNames).length) found.push('surname')
  if (PRICE_REASON.test(text)) found.push('price_reason')
  if (AFFECTION.test(text) || new RegExp(PET_NAME_CALLED.source, 'iu').test(text) || PET_NAME_OPENING.test(text)) found.push('affection')
  return found
}

/** The ones fixStyle mends by itself, without asking the model again. */
export const FIXED_IN_CODE: StyleProblem[] = ['emoji', 'opener', 'surname', 'affection']

/** The note the model gets back when a reply has to be reworded. */
export function styleNote(problems: StyleProblem[]): string {
  const lines: Record<StyleProblem, string> = {
    emoji: 'It uses an emoji: write it without any.',
    opener: 'It opens with an exclamation or filler ("¡Perfecto!", "¡Claro!", "¡Hola, María!"): start with the substance.',
    colleague: 'It speaks of "un compañero", "una compañera" or "un miembro del equipo": say "mi compañera" or "mi compañero" (or "my colleague"), as someone you work with.',
    numeric_date: 'It writes a date in figures ("20/10", "2026-10-20"): write it in words, with the weekday ("el martes 20 de octubre").',
    ad: 'It mentions the ad or advertising: never speak of an ad to them. The offer is simply an offer the clinic has right now.',
    surname: 'It calls a practitioner by their full name: use their first name only.',
    affection: 'It sends a kiss or a hug ("un beso", "un abrazo") or calls them by a pet name ("guapa", "cariño"): take that out, even though they wrote that way. End on the substance, or with a plain "Un saludo".',
    price_reason: 'It explains a price ("precio estándar", "precio normal", "como no es paciente") or says whether someone is a patient of the clinic: give the price alone ("La primera visita son 70 €"), with no label and no reason, and never say whether anyone is or is not a patient.',
  }
  return `Rewrite your reply. ${problems.map((p) => lines[p]).join(' ')} Keep everything else exactly as it was, and do not call any tool again.`
}

/**
 * Mends what needs no rewording: emojis out, an opening "¡Perfecto!" or
 * "¡Hola, María!" taken off (the next word capitalised), and a
 * practitioner's full name cut to the name the receptionist calls them by.
 */
export function fixStyle(text: string, teamNames: string[] = []): string {
  let out = text.replace(EMOJI, '').replace(/[ \t]+([.,;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ')
  // A kiss or a hug as a sentence of its own, or hung on the end of one,
  // goes; never the whole reply.
  const plain = out.replace(PET_NAME_CALLED, '').replace(AFFECTION_TAIL, '').replace(AFFECTION_SENTENCE, '$1')
  if (plain.trim()) out = plain
  const petName = out.match(PET_NAME_OPENING)
  if (petName && out.slice(petName[0].length).trim()) out = capitalise(out.slice(petName[0].length))
  const greeting = out.match(EXCLAIMED_GREETING)
  if (greeting) out = `${greeting[1]!.trim()}. ${out.slice(greeting[0].length)}`
  const opener = out.match(OPENER)
  if (opener && out.slice(opener[0].length).trim()) out = capitalise(out.slice(opener[0].length))
  for (const [full, called] of teamCallNames(teamNames)) {
    if (full !== called) out = out.replace(new RegExp(`(?<!\\p{L})${escape(full)}(?!\\p{L})`, 'gu'), called)
  }
  return out.split('\n').map((line) => line.trimEnd()).join('\n').trim()
}

function surnamesUsed(text: string, teamNames: string[]): string[] {
  return [...teamCallNames(teamNames)].filter(([full, called]) => full !== called && new RegExp(`(?<!\\p{L})${escape(full)}(?!\\p{L})`, 'u').test(text)).map(([full]) => full)
}

function capitalise(text: string): string {
  return text.charAt(0).toLocaleUpperCase('es') + text.slice(1)
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

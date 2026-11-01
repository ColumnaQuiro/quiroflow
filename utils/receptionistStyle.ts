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

export type StyleProblem = 'emoji' | 'opener' | 'colleague' | 'numeric_date' | 'ad' | 'surname'

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
  return found
}

/** The ones fixStyle mends by itself, without asking the model again. */
export const FIXED_IN_CODE: StyleProblem[] = ['emoji', 'opener', 'surname']

/** The note the model gets back when a reply has to be reworded. */
export function styleNote(problems: StyleProblem[]): string {
  const lines: Record<StyleProblem, string> = {
    emoji: 'It uses an emoji: write it without any.',
    opener: 'It opens with an exclamation or filler ("¡Perfecto!", "¡Claro!", "¡Hola, María!"): start with the substance.',
    colleague: 'It speaks of "un compañero", "una compañera" or "un miembro del equipo": say "mi compañera" or "mi compañero" (or "my colleague"), as someone you work with.',
    numeric_date: 'It writes a date in figures ("20/10", "2026-10-20"): write it in words, with the weekday ("el martes 20 de octubre").',
    ad: 'It mentions the ad or advertising: never speak of an ad to them. The offer is simply an offer the clinic has right now.',
    surname: 'It calls a practitioner by their full name: use their first name only.',
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

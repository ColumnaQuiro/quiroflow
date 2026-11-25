// The language of a receptionist reply, checked in code after the model has
// written it.
//
// The prompt already says "reply in the language of their latest message"
// (replyLanguageLine), and it was broken anyway:
// - on 12 Nov 2026 a Spanish message got an English reply, and on the 13th a
//   lead writing in English got Spanish, in the same week;
// - on 22 Nov 2026, the first full day on Haiku, a Spanish reply asked
//   "¿Also cancelo la del lunes 30…?" -- one English word in Spanish, one of
//   Haiku's known weak spots from the 14 Oct trial.
// Another line in the prompt is what each of those already had. A check that
// reads the finished text does not drift: a reply in the wrong language, or a
// Spanish one with English words in it, goes back to the model once
// (runReceptionistModel).
//
// Only Spanish and English are told apart. They are the two the clinics'
// conversations are in, and the two a word list can tell apart without
// guessing; a French or Catalan message is left to the prompt.
//
// A plain module (no Nuxt auto-imports) so the unit tests can pin it.

export type CheckedLanguage = 'es' | 'en'

/**
 * Words that are English and never Spanish. Short words that are also
 * Spanish ("me", "he", "has", "come", "son", "no", "a", "sin", "red") are left
 * out on purpose, and so is "ok"/"okay", which Spanish writes too.
 */
const ENGLISH_ONLY = new Set([
  'also', 'the', 'and', 'please', 'thanks', 'thank', 'you', 'your', 'yours', 'with', 'without', 'will', 'would', 'should', 'could',
  "can't", "don't", "won't", "i'm", "i'll", "it's", "that's", "there's", "let's", "you're", "we're", "we'll",
  'then', 'just', 'but', 'that', 'this', 'these', 'those', 'what', 'which', 'when', 'where', 'there', 'their', 'they', 'them', 'here',
  'have', 'from', 'about', 'after', 'before', 'maybe', 'because', 'however', 'anyway', 'already', 'still', 'available',
  'appointment', 'appointments', 'booking', 'booked', 'sorry', 'great', 'sure', 'perfect', 'tomorrow', 'today', 'morning',
  'afternoon', 'evening', 'week', 'next', 'soon', 'hello', 'bye', 'cancel', 'cancelled', 'reschedule', 'slot', 'slots',
])

/**
 * Words that say "Spanish" when they make up a message. No weekdays: a
 * tapped button ("miércoles 2 · 16:30") is in the clinic's language, not
 * theirs, and says nothing about which they write in.
 */
const SPANISH_MARKERS = new Set([
  'de', 'la', 'que', 'el', 'en', 'los', 'las', 'por', 'para', 'con', 'una', 'del', 'tu', 'te', 'se', 'es', 'está', 'esta', 'cita',
  'gracias', 'hola', 'sí', 'muy', 'pero', 'hay', 'puedo', 'tengo', 'quiero', 'día', 'mañana', 'tarde', 'vale', 'también', 'semana',
  'cuando', 'como', 'qué', 'mi', 'me', 'lo', 'al', 'nos',
  'bien', 'hora', 'horas', 'buenos', 'buenas', 'puede', 'podemos', 'tienes', 'tenemos', 'perfecto', 'claro', 'saludo',
])

/** Words that say "English" when they make up a message. */
const ENGLISH_MARKERS = new Set([
  ...ENGLISH_ONLY,
  'is', 'are', 'to', 'for', 'my', 'i', 'it', 'we', 'our', 'do', 'can', 'hi', 'of', 'on', 'at', 'be', 'am', 'was', 'not', 'any', 'time',
])

const WORD = /[\p{L}']+/gu
const SPANISH_LETTERS = /[áéíóúñ¿¡]/iu

function words(text: string): string[] {
  return (text.toLocaleLowerCase('es').replace(/[’]/g, "'").match(WORD) ?? []).map((w) => w.replace(/^'+|'+$/g, '')).filter(Boolean)
}

/** What is quoted ("…", «…», “…”) is someone else's words, not the reply's. */
function unquoted(text: string): string {
  return text.replace(/«[^»]*»|"[^"]*"|“[^”]*”/g, ' ')
}

/**
 * The language a text is written in, when it is clearly Spanish or clearly
 * English; null for a button ("Confirmar"), "Ok", a name, a time, or a mix too
 * even to call.
 */
export function textLanguage(text: string): CheckedLanguage | null {
  const list = words(unquoted(text))
  let es = list.filter((w) => SPANISH_MARKERS.has(w)).length
  const en = list.filter((w) => ENGLISH_MARKERS.has(w)).length
  if (SPANISH_LETTERS.test(text)) es += 1
  if (es >= 2 && es >= en * 2) return 'es'
  if (en >= 2 && en >= es * 2) return 'en'
  return null
}

/**
 * The language the person is writing in: that of their latest message that
 * says clearly, read back from the newest. A button or "Ok" says nothing, so
 * the message before it decides. Lines the history marks for the model
 * ("[Voice note, transcribed automatically]", "[Sent on …]") are not theirs.
 */
export function theirLanguage(inbound: string[]): CheckedLanguage | null {
  for (let i = inbound.length - 1; i >= 0; i--) {
    const own = (inbound[i] ?? '').split('\n').filter((line) => !/^\s*\[[^\]]*\]\s*$/.test(line)).join('\n')
    const language = textLanguage(own)
    if (language) return language
  }
  return null
}

/**
 * English words in a reply that is otherwise Spanish ("¿Also cancelo…?"),
 * in the order they appear. A capitalised word in the middle of a sentence is
 * a name ("Will", "Apple Pay"), not English, and is left alone, as is anything
 * quoted.
 */
export function englishWordsInSpanish(text: string): string[] {
  const plain = unquoted(text)
  if (textLanguage(plain) === 'en') return []
  const found: string[] = []
  for (const match of plain.matchAll(/[\p{L}'’]+/gu)) {
    const raw = match[0]
    const word = raw.toLocaleLowerCase('es').replace(/[’]/g, "'").replace(/^'+|'+$/g, '')
    if (!ENGLISH_ONLY.has(word)) continue
    const before = plain.slice(0, match.index).replace(/[\s¿¡("'«“]+$/u, '')
    const startsSentence = before === '' || /[.!?…:\n]$/u.test(before)
    if (!startsSentence && raw[0] !== raw[0]!.toLocaleLowerCase('es')) continue
    if (!found.includes(raw)) found.push(raw)
  }
  return found
}

/** What is wrong with the reply's language, if anything. */
export type LanguageProblem =
  | { kind: 'wrong_language'; theirs: CheckedLanguage; reply: CheckedLanguage }
  | { kind: 'english_words'; words: string[] }

/**
 * `theirs`: the language they write in (theirLanguage), null when it cannot
 * be told -- then only English words in a Spanish reply count.
 */
export function languageProblem(reply: string, theirs: CheckedLanguage | null): LanguageProblem | null {
  const language = textLanguage(reply)
  if (theirs && language && language !== theirs) return { kind: 'wrong_language', theirs, reply: language }
  if (theirs === 'en' || language === 'en') return null
  const english = englishWordsInSpanish(reply)
  return english.length ? { kind: 'english_words', words: english } : null
}

const NAMES: Record<CheckedLanguage, string> = { es: 'Spanish', en: 'English' }

/** The note the model gets back when a reply has to be rewritten for its language. */
export function languageNote(problem: LanguageProblem): string {
  if (problem.kind === 'wrong_language') {
    return `Rewrite your reply in ${NAMES[problem.theirs]}: they write in ${NAMES[problem.theirs]}, and your reply is in ${NAMES[problem.reply]}. Keep to their language for the whole conversation; never switch language in the middle of it. Keep everything else exactly as it was, and do not call any tool again.`
  }
  const list = problem.words.map((w) => `"${w}"`).join(', ')
  return `Rewrite your reply entirely in Spanish: it has English in it (${list}). Use the Spanish word ("también", not "also"). Keep everything else exactly as it was, and do not call any tool again.`
}

// Whether a conversation is about to lose WhatsApp's (or Instagram's) 24-hour
// window with the patient's last message unanswered -- after which only a
// template can reach them. Pure, with no `~` imports: the staff app
// auto-imports this directory too.
//
// The hard part is which last messages want an answer at all. Most do not:
// in production the commonest last word from a patient by far is
// "Confirmar", the reminder's own button, which the webhook already acts on
// (the appointment is confirmed), and after that come thank-yous and
// goodbyes. "Cancelar"/"Anular" is acted on too -- the appointment is
// cancelled -- but keeps its pill: it is the moment to offer another time. Flagging those would put a pill on most of the
// list and teach everyone to ignore it. So a message is passed over only when
// it is plainly a closing -- every word one a closing is made of, and at least
// one that actually closes ("gracias", "vale", "perfecto"…) -- and anything
// in doubt keeps its pill: a question mark, a photo or voice note, a sentence
// with any other word in it. A pill too many costs a glance; one too few
// costs the patient.

export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000
/** How long before the window shuts the pill appears. */
export const REPLY_WINDOW_WARN_MS = 6 * 60 * 60 * 1000
/** The last stretch, drawn as urgent. */
export const REPLY_WINDOW_URGENT_MS = 60 * 60 * 1000

/** Channels that only allow a free reply within 24h of the patient's last message. */
const WINDOWED_CHANNELS = new Set(['whatsapp', 'instagram'])

// Words that close a conversation on their own.
const CLOSING_WORDS = new Set([
  'gracias', 'agradezco', 'thanks', 'thank', 'thx',
  'ok', 'okay', 'okey', 'oki', 'vale', 'perfecto', 'perfecta', 'perfect', 'genial', 'estupendo', 'estupenda', 'great',
  'entendido', 'entendida', 'acuerdo', 'igualmente', 'saludos', 'saludo', 'hasta', 'luego', 'vemos', 'apuntado', 'apuntada',
  'recibido', 'recibida', 'listo', 'hecho', 'dale', 'fenomenal', 'guay',
  // The reminder's Confirmar: the webhook has already confirmed the visit.
  // Not its Cancelar -- a cancellation wants a reply offering another time.
  'confirmar', 'confirmo', 'confirmado', 'confirmada',
])
// Words that go with those without asking anything ("muchas gracias", "vale,
// allí estaré", "de momento no, gracias", "hasta mañana").
const FILLER_WORDS = new Set([
  'muchas', 'muchisimas', 'mil', 'muy', 'bien', 'super', 'pues', 'ay', 'que', 'si', 'no', 'de', 'momento', 'a', 'ti',
  'vosotros', 'vosotras', 'usted', 'tambien', 'un', 'una', 'manana', 'pronto', 'nos', 'buenas', 'buenos', 'buen',
  'noches', 'tardes', 'dias', 'dia', 'se', 'lo', 'la', 'le', 'os', 'te', 'alli', 'ahi', 'alla', 'estare', 'estaremos',
  'abrazo', 'besos', 'beso', 'por', 'todo', 'you', 'very', 'much', 'so', 'all', 'right', 'and', 'y', 'claro',
])
const MAX_CLOSING_WORDS = 10

/** True when the text is plainly a closing ("gracias", "vale, muchas gracias 😊", "👍") rather than something to answer. */
export function isClosingMessage(text: string | null | undefined): boolean {
  if (!text) return false
  if (text.includes('?') || text.includes('¿')) return false
  const words = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // "graciasss", "vaaale"
    .replace(/(\p{L})\1{2,}/gu, '$1')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  // Nothing but emoji and punctuation: a thumbs-up, a heart.
  if (words.length === 0) return /\p{Extended_Pictographic}/u.test(text)
  if (words.length > MAX_CLOSING_WORDS) return false
  if (!words.every((w) => CLOSING_WORDS.has(w) || FILLER_WORDS.has(w))) return false
  return words.some((w) => CLOSING_WORDS.has(w))
}

export interface ReplyWindowMessage {
  direction: string
  channel: string
  /** When it was written (ISO). */
  at: string
  body: string | null
  mediaType?: string | null
}

/**
 * How long is left to answer freely, when the patient wrote last on a channel
 * with a window, it is still open and their message wants an answer; null
 * otherwise.
 */
export function replyWindowLeft(last: ReplyWindowMessage | null | undefined, now: number): number | null {
  if (!last || last.direction !== 'inbound' || !WINDOWED_CHANNELS.has(last.channel)) return null
  const left = Date.parse(last.at) + REPLY_WINDOW_MS - now
  if (!(left > 0)) return null
  // A file or voice note can be anything; only words can be read as a closing.
  if (!last.mediaType && isClosingMessage(last.body)) return null
  return left
}

/** The pill for a conversation, or null when it needs none. */
export function replyWindowPill(last: ReplyWindowMessage | null | undefined, now: number): { left: string; urgent: boolean } | null {
  const left = replyWindowLeft(last, now)
  if (left === null || left > REPLY_WINDOW_WARN_MS) return null
  const minutes = Math.max(1, Math.ceil(left / 60000))
  // "5 h" and "40 min" read the same in English and Spanish.
  return { left: minutes <= 60 ? `${minutes} min` : `${Math.ceil(minutes / 60)} h`, urgent: left <= REPLY_WINDOW_URGENT_MS }
}

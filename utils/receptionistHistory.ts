// How the conversation reads to the AI receptionist, and the checks on what
// it writes back.
//
// A plain module (no Nuxt auto-imports) so the unit tests can pin it.

/** Starts a message the clinic's automations sent: a reminder, a welcome. */
export const AUTOMATED_MARK = '[Automatic message from the clinic system]'
/** Starts a message a person at the clinic wrote, as opposed to the receptionist. */
export const COLLEAGUE_MARK = '[Written by a colleague at the clinic]'

export interface HistoryMessage {
  direction: string
  body: string | null
  /** A template or an automation's send rather than a person or the receptionist. */
  automated?: boolean
  /** Written by the receptionist; an outbound message that is neither this nor automated is a person's. */
  sentByAi?: boolean
  /** The WhatsApp template it was sent from, if any. */
  templateName?: string | null
  mediaType?: string | null
  mediaFilename?: string | null
}

/**
 * One message as the model reads it; empty when there is nothing to read.
 *
 * Two things the bare text hid. A reminder in the history read as one of the
 * receptionist's own replies, and it answered a patient with the reminder's
 * text, asterisks and emoji included. And a voice note, a photo or a document
 * has no text at all, so it was dropped -- the receptionist answered as if
 * they had sent nothing, or did not answer.
 */
export function historyLine(m: HistoryMessage): string {
  const body = (m.body ?? '').trim()
  if (m.direction !== 'inbound') {
    // A template send keeps no text (body_preview is null for every
    // appointment_reminder), so it used to vanish from the history. The
    // "Confirmar" a patient tapped on it then read as an answer to whatever
    // came before -- and a conversation a person had already settled got a
    // fresh draft.
    if (!body && m.automated) return `${AUTOMATED_MARK}\n[Template${m.templateName ? ` "${m.templateName.replace(/["\r\n]+/g, ' ').slice(0, 80)}"` : ''}; its text is not shown here]`
    if (!body) return ''
    if (m.automated) return `${AUTOMATED_MARK}\n${body}`
    // A colleague's offer read as the receptionist's own, so it "corrected"
    // a time a person had already agreed with them.
    return m.sentByAi === false ? `${COLLEAGUE_MARK}\n${body}` : body
  }
  const mark = mediaMark(m.mediaType, m.mediaFilename)
  if (!mark) return body
  return body ? `${mark}\n${body}` : mark
}

function mediaMark(type: string | null | undefined, filename: string | null | undefined): string | null {
  switch (type) {
    case 'audio':
      return '[Voice note -- you cannot listen to it]'
    case 'image':
      return '[Image]'
    case 'video':
      return '[Video -- you cannot watch it]'
    case 'sticker':
      return '[Sticker]'
    case 'document':
      return `[Document${filename ? `: ${filename.replace(/[\r\n\]]+/g, ' ').slice(0, 80)}` : ''} -- you cannot open it]`
    default:
      return null
  }
}

/** What the markers above mean, for the system prompt; `handOver` when hand_over_to_colleague is on the request. */
export function historyMarkersSection(handOver: boolean): string {
  return [
  '# Marks in the conversation',
  `- A message that starts with ${AUTOMATED_MARK} was sent by the clinic's automations (a reminder, a welcome message). You did not write it. Never copy its wording, layout, asterisks or emojis, and never send it again as your reply.`,
  `- A message that starts with ${COLLEAGUE_MARK} was written by a person at the clinic. Never contradict what they offered or agreed: if the patient accepts a time or an arrangement a colleague offered, ${handOver ? 'call hand_over_to_colleague and ' : ''}say your colleague will confirm it, instead of offering something else.`,
  '- Never say an automatic message is wrong or out of date. If they misread one, explain what it means using the clinic knowledge.',
  '- [Voice note], [Video], [Document] and [Sticker] stand for what they sent, which you cannot see or hear. [Image] is a picture; when it is attached to their message you can see it, so use what it shows.',
  '- Never start your own reply with any of these marks.',
  ].join('\n')
}

/** What a reply opened with that reads as a bot; taken off even though the prompt forbids it. */
const FILLER_OPENER = /^\s*¡?\s*(?:perfecto|genial|estupendo|fenomenal|claro(?:\s+que\s+s[ií])?|por\s+supuesto|great|perfect|of\s+course|sure)(?!\p{L})\s*[!.,]*\s*/iu

/**
 * The reply as it is sent: a mark copied from the conversation taken off, and
 * an opener the prompt forbids ("¡Perfecto, Sonia!") removed -- told not to,
 * it still opened that way on its second day.
 */
export function cleanReply(text: string): string {
  let out = text.trim()
  for (const mark of [AUTOMATED_MARK, COLLEAGUE_MARK]) if (out.startsWith(mark)) out = out.slice(mark.length).trim()
  const opener = out.match(FILLER_OPENER)
  if (opener && opener[0].length < out.length) {
    out = out.slice(opener[0].length)
    // "Perfecto, Sonia: te la muevo..." would read "Sonia: te la muevo...":
    // after "Perfecto," a single word followed by a comma or colon is the
    // name it was addressed to, and goes with it.
    if (opener[0].trimEnd().endsWith(',')) out = out.replace(/^[A-ZÁÉÍÓÚÑ][\p{L}]+\s*[,:]\s*/u, '')
    out = out.charAt(0).toUpperCase() + out.slice(1)
  }
  return out
}

/**
 * Ranges ("de 9:00 a 13:00", "9:00-14:00", "entre las 9:00 y las 13:00") are
 * opening hours, not times offered. "y" alone is a list ("11:00 y 17:30"), so
 * it is a range only after "entre".
 */
const RANGE = /\bentre\s+las\s+\d{1,2}[:.h]\d{2}\s+y\s+las\s+\d{1,2}[:.h]\d{2}\b|\b\d{1,2}[:.h]\d{2}\s*(?:-|–|a|hasta)\s*(?:las\s+)?\d{1,2}[:.h]\d{2}\b/gi
const TIME = /\b([01]?\d|2[0-3])[:.h]([0-5]\d)\b/g

/**
 * How many different clock times a reply offers. Counted rather than trusted
 * to the instruction: told "at most 2 per reply", it offered one person five.
 */
export function offeredTimeCount(text: string): number {
  const times = new Set<string>()
  for (const m of text.replace(RANGE, ' ').matchAll(TIME)) times.add(`${Number(m[1])}:${m[2]}`)
  return times.size
}

/** What is said to the model when its reply offered too many times. */
export function tooManyTimesNote(count: number, max: number): string {
  return `[Note from the clinic system, not from the patient] Your reply offers ${count} different times; the clinic allows at most ${max} per reply. Write the reply again with no more than ${max}, choosing the ones that best fit what they said. Write only the message.`
}

/**
 * Tú, always. Two patients were told "su cita... ¡Le esperamos!" and the
 * rest "tu cita" -- the reminder template says "usted", and the model drifted
 * into it.
 */
export const INFORMAL_ADDRESS_LINE = 'In Spanish, always address them as tú: "tu cita", "te esperamos" -- never "usted", "su cita" or "le esperamos", even where an automatic message in the conversation does.'

/** When none of the free times suit them (add_to_waitlist). */
export const WAITLIST_SECTION = [
  '# The waiting list',
  'If none of the free times suit them -- they can only come on days or at hours that are not free, or when the clinic is closed -- offer to put them on the waiting list. If they agree, call add_to_waitlist with when they can come, then tell them the clinic will let them know if a time that suits them frees up. Never promise one.',
].join('\n')

/**
 * Asked to change a visit for a long trip, it said "te apunto en la lista de
 * espera" -- something the clinic did not have -- and explained to a lead that
 * an adjustment "relieves the pressure on the affected nerve".
 */
export const NO_INVENTION_LINE = 'Only offer what the clinic knowledge and these instructions give you: never invent a process, service or option the clinic has not described (a call back, a discount, a list to join). Never explain what an adjustment does inside their body or to their condition ("alivia la presión sobre el nervio"): that is for the chiropractor at the visit.'

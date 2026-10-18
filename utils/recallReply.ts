// What a patient's WhatsApp reply means for the recalls that reach them.
//
// The recall templates carry no opt-out sentence -- they go out as part of
// the person's care, not as marketing -- so refusing has to work through the
// ordinary reply. Their quick-reply buttons say "No, gracias" and "Más
// adelante" in so many words, and BAJA / STOP are what people type when they
// mean it. The WhatsApp webhook reads every inbound message through here
// before the automations see it: a decline marks the patient "do not
// contact" and ends their running sequences; a snooze parks them in Recalls
// for two months.
//
// Pure, so the matching is tested without a webhook. Only whole messages
// count: "no gracias, el jueves mejor" is a sentence for the desk, not an
// opt-out, and "stop" inside a longer text is not one either.

export type RecallReplyIntent = 'decline' | 'snooze'

/** How long "Más adelante" keeps a patient out of every recall. */
export const RECALL_SNOOZE_DAYS = 60

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const DECLINE = new Set(['no gracias', 'no thanks', 'no thank you', 'baja', 'stop'])
const SNOOZE = new Set(['mas adelante', 'later on', 'later'])

/**
 * A decline, a snooze, or nothing. Accents, case, punctuation and the
 * trailing emoji a button title sometimes carries are ignored; anything
 * longer than the phrase itself is not a match.
 */
export function recallReplyIntent(text: string | null | undefined): RecallReplyIntent | null {
  const key = fold(text ?? '')
  if (!key) return null
  if (DECLINE.has(key)) return 'decline'
  if (SNOOZE.has(key)) return 'snooze'
  return null
}

/** The calendar day `days` from `today` (a YYYY-MM-DD in the clinic's zone). */
export function snoozedUntil(today: string, days = RECALL_SNOOZE_DAYS): string {
  const [y, m, d] = today.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10)
}

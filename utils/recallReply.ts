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

// BAJA and STOP mean "stop writing to me" whatever they answer. "No,
// gracias" means it only as the answer to a recall -- its button. Said to
// anything else it answers that: a patient asked by the receptionist whether
// they would rather move a visit than cancel it said "No, gracias" and was
// marked do-not-contact, so the confirmation of the cancellation could not be
// sent and they dropped out of the recalls they had said they would come
// back through (23 Oct 2026).
const OPT_OUT = new Set(['baja', 'stop'])
const DECLINE_TO_RECALL = new Set(['no gracias', 'no thanks', 'no thank you'])
const SNOOZE = new Set(['mas adelante', 'later on', 'later'])

/**
 * A decline, a snooze, or nothing. Accents, case, punctuation and the
 * trailing emoji a button title sometimes carries are ignored; anything
 * longer than the phrase itself is not a match. `answersRecall` is whether
 * the message replies to a recall (the webhook reads it from the message it
 * answers); "No, gracias" is a decline only then.
 */
export function recallReplyIntent(text: string | null | undefined, answersRecall: boolean): RecallReplyIntent | null {
  const key = fold(text ?? '')
  if (!key) return null
  if (OPT_OUT.has(key)) return 'decline'
  if (DECLINE_TO_RECALL.has(key)) return answersRecall ? 'decline' : null
  if (SNOOZE.has(key)) return 'snooze'
  return null
}

/** Whether what `text` means depends on it replying to a recall. */
export function declinesOnlyARecall(text: string | null | undefined): boolean {
  return DECLINE_TO_RECALL.has(fold(text ?? ''))
}

/** The calendar day `days` from `today` (a YYYY-MM-DD in the clinic's zone). */
export function snoozedUntil(today: string, days = RECALL_SNOOZE_DAYS): string {
  const [y, m, d] = today.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10)
}

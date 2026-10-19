// The shape of "what the receptionist did", shared by the server
// (server/utils/receptionistActivity.ts) and the screens that show it.
//
// Pure, with no `~` imports: the app auto-imports this directory too, and in
// its build `~` resolves to mobile/.

export interface ReceptionistEvent {
  id: string
  at: string
  /** The Inbox's key: a patient's id, or lead:<id>. */
  conversationKey: string
  /** Who the conversation is with, when they could be named. */
  name: string | null
  /** The note it left in the thread, as the team reads it there. */
  body: string
  kind: 'booked' | 'moved' | 'cancelled' | 'waitlisted' | 'handover' | 'note'
}

export interface ReceptionistActivity {
  /** This calendar month, on the clinic's clock. */
  month: { sent: number; drafted: number; conversations: number }
  /** Drafts waiting on a person right now, leads and patients together. */
  draftsWaiting: number
  /** Conversations it handed to a person that nobody has ticked off yet. */
  handoversOpen: number
  booked: number
  moved: number
  cancelled: number
  waitlisted: number
  handedOver: number
  recent: ReceptionistEvent[]
}

/**
 * What a note of the receptionist's records, from its opening words. The
 * notes are written in Spanish by receptionistBooking.ts and
 * receptionistSend.ts whatever the clinic's language, so the openings are
 * fixed strings rather than translations.
 */
export function receptionistEventKind(body: string): ReceptionistEvent['kind'] {
  const text = body.trim().toLowerCase()
  if (text.startsWith('he reservado')) return 'booked'
  if (text.startsWith('he movido')) return 'moved'
  if (text.startsWith('he cancelado')) return 'cancelled'
  if (text.startsWith('he apuntado')) return 'waitlisted'
  if (text.startsWith('he pasado esta conversación')) return 'handover'
  return 'note'
}

/** The reason a handover note gives, without the fixed opening. */
export function handoverReason(body: string): string {
  const match = /motivo:\s*(.+)$/is.exec(body)
  return (match?.[1] ?? body).trim()
}

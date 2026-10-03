/**
 * Which of several patients sharing one phone an inbound WhatsApp is filed
 * under.
 *
 * A family on one mobile -- a parent and their children, a couple -- puts the
 * same number on several records, and an inbound message can only carry one
 * patient_id. The webhook used to take whichever record the database happened
 * to return first, which for a family was usually the oldest -- often a
 * child's. The message then sat in the child's thread, the reply composer
 * there refused to send (minors cannot be messaged), and the parent who wrote
 * it was answered by nobody.
 *
 * The rule, in order, deterministic for the same data:
 *
 *  1. Never a minor while an adult shares the number. A child does not write
 *     from the family phone; whoever does is an adult, and a minor's thread is
 *     one no reply can be sent from. Minors are considered only when every
 *     record on the number is a minor.
 *  2. The patient whose conversation on THIS number was most recently active
 *     (their last message in or out). A reply is almost always to the last
 *     thing said, and that is where staff are looking.
 *  3. A tutor of one of the minors on the number -- the person the clinic
 *     deals with for that family.
 *  4. The oldest record, then the lowest id, so the answer never changes from
 *     one delivery to the next.
 *
 * Pure, so it can be tested without a database; whatsappOwner.ts gathers the
 * facts it needs.
 */
export interface InboundOwnerCandidate {
  id: string
  isMinor: boolean
  createdAt: string
  /** The patient's last message on this number, either direction. */
  lastActivityAt: string | null
  /** Set on a minor: the patient record of their tutor. */
  tutorPatientId: string | null
}

export function chooseInboundOwner(candidates: InboundOwnerCandidate[]): string | null {
  if (candidates.length === 0) return null
  const adults = candidates.filter((c) => !c.isMinor)
  const pool = adults.length > 0 ? adults : candidates
  const tutorIds = new Set(candidates.map((c) => c.tutorPatientId).filter((id): id is string => !!id))

  const time = (at: string | null) => (at ? Date.parse(at) : Number.NEGATIVE_INFINITY)
  const sorted = [...pool].sort((a, b) => {
    const activity = time(b.lastActivityAt) - time(a.lastActivityAt)
    if (activity !== 0 && !Number.isNaN(activity)) return activity
    const tutor = Number(tutorIds.has(b.id)) - Number(tutorIds.has(a.id))
    if (tutor !== 0) return tutor
    const age = time(a.createdAt) - time(b.createdAt)
    if (age !== 0 && !Number.isNaN(age)) return age
    return a.id.localeCompare(b.id)
  })
  return sorted[0]!.id
}

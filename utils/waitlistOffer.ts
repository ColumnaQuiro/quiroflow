// The rules for offering a freed slot to the waitlist, shared by the server
// that makes the offer (server/utils/waitlistOffer.ts) and the cancel step
// that shows staff who will get it and until when -- so the screen cannot
// promise one person or one deadline while the server picks another.

// How long a waitlisted patient has to claim an offered slot before it's
// released back to the pool (expire-cron.post.ts) and re-offered to the
// next match. Short enough that a freed slot doesn't sit unusable for long,
// long enough that someone can see a WhatsApp message and respond.
export const WAITLIST_OFFER_TTL_HOURS = 2

// ...but never past this close to the visit. A slot starting in 50 minutes
// offered with a two-hour window could be claimed after it had begun; 20
// minutes is the least that still lets someone get to the clinic.
export const WAITLIST_OFFER_CUTOFF_MINUTES = 20

/**
 * When an offer made at `now` for a slot starting at `startsAt` lapses:
 * min(now + TTL, startsAt - cutoff). null when that is already past -- the
 * slot starts too soon for anyone to take it, so no offer should go out.
 */
export function offerExpiresAt(now: Date, startsAt: Date): Date | null {
  const ttl = now.getTime() + WAITLIST_OFFER_TTL_HOURS * 60 * 60 * 1000
  const cutoff = startsAt.getTime() - WAITLIST_OFFER_CUTOFF_MINUTES * 60 * 1000
  const at = Math.min(ttl, cutoff)
  return at > now.getTime() ? new Date(at) : null
}

/**
 * Whether a waiting entry fits a freed slot: its preferences are either
 * "any" (null) or exactly this slot's type and practitioner. Candidates are
 * taken oldest first -- first come, first served.
 */
export function waitlistEntryMatches(
  entry: { appointment_type_id: string | null; practitioner_id: string | null },
  slot: { appointmentTypeId: string | null; practitionerId: string | null },
): boolean {
  return (!entry.appointment_type_id || entry.appointment_type_id === slot.appointmentTypeId) && (!entry.practitioner_id || entry.practitioner_id === slot.practitionerId)
}

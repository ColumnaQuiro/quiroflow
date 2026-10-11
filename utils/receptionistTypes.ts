import { orderTypes } from './appointmentTypes'

// Which appointment types the AI receptionist may offer.
//
// receptionist_config.bookable_appointment_type_ids was stored from the day
// the table was created and read by nothing: the prompt never named a type,
// so every receptionist offered "a time" for whatever the patient asked about.
// No screen or endpoint could write the column either, so on every production
// account it is the column default, an empty array.
//
// That is why an EMPTY list means "any active type" and not "none", although
// the migration that created the column said otherwise. Reading it as "none"
// the day it started being enforced would have told every live receptionist
// to stop offering appointments, without anybody having chosen that. Empty is
// what the clinic has never touched, and what it has had so far is "any".
// Restricting is the deliberate act, and the editor on /growth/receptionist
// is where it is done; it never saves an empty "only these" list, because
// that would silently widen to everything.
//
// An archived type is never offered, whichever way the list reads. The list
// is filtered here, at the moment it is used, rather than cleaned when a type
// is archived: an id saved before the archive is still in the array, and a
// type reactivated later comes back without anyone re-ticking it.

export interface OfferableType {
  id: string
  name: string
  duration_minutes: number
  archived_at: string | null
  sort_order?: number | null
}

/** The types the receptionist may offer, in the clinic's order. */
export function offeredAppointmentTypes<T extends OfferableType>(types: T[], allowedIds: string[]): T[] {
  const active = types.filter((type) => !type.archived_at)
  if (allowedIds.length === 0) return orderTypes(active)
  const allowed = new Set(allowedIds)
  return orderTypes(active.filter((type) => allowed.has(type.id)))
}

/**
 * Whether one type is offered. For the places that ask about a single type
 * (its own settings page) rather than building the whole list.
 */
export function receptionistOffersType(type: Pick<OfferableType, 'id' | 'archived_at'>, allowedIds: string[]): boolean {
  if (type.archived_at) return false
  return allowedIds.length === 0 || allowedIds.includes(type.id)
}

/** What the prompt says about a type. */
export interface PromptType {
  name: string
  durationMinutes: number
  /** appointment_types.stage: 'first_visit', 'first_visit_offer', 'adjustment'... */
  stage?: string | null
  /** appointment_types.online_bookable_by: 'all', 'new_patients' or 'existing_patients'. */
  bookableBy?: string | null
}

/**
 * Who the receptionist is talking to, as far as booking goes. A first visit
 * is the only thing a new person can book, and the ad's offer price is for
 * people who answered the ad -- so the same "quiero una cita" means a
 * different appointment for each of these.
 */
export type ReceptionistAudience = 'new_from_ad' | 'new' | 'existing'

const isFirstVisit = (type: PromptType) => type.stage === 'first_visit' || type.stage === 'first_visit_offer'

/**
 * Which of the receptionist's types this person may be offered.
 *
 * Read from each type's stage (set on the type's settings page) and who it is
 * bookable by online, so no new setting is needed:
 * - from an ad: the first-visit offer (stage first_visit_offer), else the
 *   plain first visit;
 * - new, not known to be from an ad: the plain first visit, and the offer
 *   only if they say they came from the ad (`adOnly`) -- the record not
 *   knowing is not the same as them not having seen it;
 * - a patient who has been before: anything but a first visit.
 *
 * A clinic that has set no stages gets what it had before: every offered
 * type, for everyone.
 */
export function typesForAudience<T extends PromptType>(offered: T[], audience: ReceptionistAudience): { types: T[]; adOnly: T[] } {
  if (audience === 'existing') {
    return { types: offered.filter((type) => !isFirstVisit(type) && type.bookableBy !== 'new_patients'), adOnly: [] }
  }
  const forNew = offered.filter((type) => type.bookableBy !== 'existing_patients')
  const offers = forNew.filter((type) => type.stage === 'first_visit_offer')
  const firsts = forNew.filter((type) => type.stage === 'first_visit' || (type.bookableBy === 'new_patients' && type.stage !== 'first_visit_offer'))
  if (audience === 'new_from_ad') {
    if (offers.length) return { types: offers, adOnly: [] }
    return { types: firsts.length ? firsts : forNew, adOnly: [] }
  }
  if (firsts.length) return { types: firsts, adOnly: offers }
  const others = forNew.filter((type) => type.stage !== 'first_visit_offer')
  return others.length ? { types: others, adOnly: offers } : { types: offers, adOnly: [] }
}

/** What the prompt says about who this is, for booking. */
export function audienceSection(audience: ReceptionistAudience): string {
  if (audience === 'new_from_ad') {
    return `# Who you are talking to\nSomeone who has not been to the clinic yet and came through one of its ads. Their first appointment is the one listed under "What you can offer".`
  }
  if (audience === 'new') {
    return `# Who you are talking to\nSomeone who has not been to the clinic yet. Their first appointment is a first visit, as listed under "What you can offer".`
  }
  return `# Who you are talking to\nA patient who has been to the clinic before. Never offer them a first visit.`
}

/** The prompt section that says what may be offered. */
export function offeredTypesSection(offeredTypes: PromptType[], adOnly: PromptType[] = []) {
  if (offeredTypes.length === 0) {
    return `# What you can offer\nNo type of appointment can be booked through you. Do not offer times. If the patient wants an appointment, say your colleague will arrange it with them.`
  }
  const line = (type: PromptType) => `- ${type.name} (${type.durationMinutes} min)`
  return [
    `# What you can offer\nOnly these types of appointment can be booked through you:\n${offeredTypes.map(line).join('\n')}`,
    adOnly.length
      ? `Only if the patient says they came from one of the clinic's ads or offers, offer this instead, with its offer price from the clinic knowledge:\n${adOnly.map(line).join('\n')}\nNever offer it to anyone else. Ask whether they came from an ad only if they ask about the price, and then once.`
      : '',
    `Offer only these, by these names. If the patient wants something that is not on this list, do not offer a time for it: say your colleague will arrange it.`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Reads the list the settings screen sends, against the account's own types.
 *
 * Refused rather than filtered: an id that is not this clinic's, or a type
 * that is archived, is a request the clinic did not mean to make, and quietly
 * dropping it would save a different list from the one on screen -- in the
 * worst case an empty one, which reads as "any type".
 */
export function checkBookableIds(value: unknown, types: Pick<OfferableType, 'id' | 'name' | 'archived_at'>[]): { ids: string[] } | { error: string } {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) {
    return { error: 'bookableAppointmentTypeIds must be a list of appointment type ids' }
  }
  const ids = [...new Set(value as string[])]
  const byId = new Map(types.map((type) => [type.id, type]))
  for (const id of ids) {
    const type = byId.get(id)
    if (!type) return { error: 'One of those appointment types does not exist in this clinic' }
    if (type.archived_at) return { error: `«${type.name}» is archived, so the receptionist cannot offer it` }
  }
  return { ids }
}

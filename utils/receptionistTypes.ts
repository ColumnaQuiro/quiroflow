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
}

/** The prompt section that says what may be offered. */
export function offeredTypesSection(offeredTypes: PromptType[]) {
  if (offeredTypes.length === 0) {
    return `# What you can offer\nNo type of appointment can be booked through you. Do not offer times. If the patient wants an appointment, say a colleague will arrange it with them.`
  }
  const list = offeredTypes.map((type) => `- ${type.name} (${type.durationMinutes} min)`).join('\n')
  return [
    `# What you can offer\nOnly these types of appointment can be booked through you:\n${list}`,
    `Offer only these, by these names. If the patient wants something that is not on this list, do not offer a time for it: say a colleague will arrange it.`,
  ].join('\n\n')
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

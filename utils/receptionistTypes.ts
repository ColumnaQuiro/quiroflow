import { orderTypes } from './appointmentTypes'
import { FAMILY_RELATIONS } from './familyRelations'

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
  /** appointment_types.for_minors: only for a child, booked through their tutor. */
  forMinors?: boolean
  /** appointment_types.for_referrals: only for someone a patient referred, who names that patient. */
  forReferrals?: boolean
  /** appointment_types.default_price_cents; null or 0 when the type has none set. */
  priceCents?: number | null
  /** Some practitioner charges a different price for it (appointment_type_overrides). */
  priceVaries?: boolean
}

/**
 * A type's price as the prompt says it: "50 €", "52,50 €". Empty when the
 * type has none -- 0 is how a type with no price set reads, and saying
 * "free" for it would be a promise the clinic never made.
 */
export function typePrice(type: PromptType): string {
  if (!type.priceCents || type.priceCents < 0) return ''
  const euros = type.priceCents / 100
  const amount = Number.isInteger(euros) ? String(euros) : euros.toFixed(2).replace('.', ',')
  return `${amount} €${type.priceVaries ? ', may differ by practitioner' : ''}`
}

/** A bono as Settings > Bonos sells it (packages). */
export interface PromptPackage {
  name: string
  sessions: number
  priceCents: number
}

/** The visits after the first: what a session costs, for someone asking what comes after their first visit. */
export function typesAfterFirstVisit<T extends PromptType>(offered: T[]): T[] {
  return offered.filter((type) => !isFirstVisit(type) && !type.forMinors && !type.forReferrals && typePrice(type))
}

/**
 * The prices of the visits after the first, and of the clinic's bonos --
 * read from the types and from Settings > Bonos, where the clinic changes
 * them, rather than from a knowledge card that has to be kept in step by
 * hand (and that another clinic would have to write before its receptionist
 * could quote anything). Which of these applies is the rest of the prompt's:
 * someone new is quoted their first visit first, a patient with an open bono
 * no price at all.
 */
export function laterPricesSection(opts: { sessions: PromptType[]; packages: PromptPackage[] }): string {
  const euros = (cents: number) => typePrice({ name: '', durationMinutes: 0, priceCents: cents })
  const sessions = opts.sessions.map((type) => `- ${type.name}: ${typePrice(type)}`)
  const packages = opts.packages
    .filter((p) => p.sessions > 0 && p.priceCents > 0)
    .map((p) => `- ${p.name}: ${p.sessions} sessions for ${euros(p.priceCents)} (${euros(Math.round(p.priceCents / p.sessions))} a session)`)
  if (!sessions.length && !packages.length) return ''
  return [
    `# Prices of the visits after the first, and bonos`,
    sessions.length ? `Visits:\n${sessions.join('\n')}` : '',
    packages.length ? `Bonos (packages of sessions, paid up front):\n${packages.join('\n')}` : '',
    `Give these only when they ask, and only what applies to them as said above. They win over any price for these in the clinic knowledge.`,
  ].filter(Boolean).join('\n')
}

/** "Primera visita" (70 €), "Ajuste" -- types named in a prompt list, each with its price when it has one. */
export function quotedTypes(types: PromptType[]): string {
  return types.map((type) => `"${type.name}"${typePrice(type) ? ` (${typePrice(type)})` : ''}`).join(', ')
}

/** Under this age a patient is a minor, booked through their tutor. */
export const MINOR_AGE = 18

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
export function typesForAudience<T extends PromptType>(all: T[], audience: ReceptionistAudience): { types: T[]; adOnly: T[] } {
  // A type for children is never offered to the adult writing: it is offered
  // for their child, by typesForMinor. Nor one for referrals, which takes the
  // name of whoever referred them first (typesForReferral).
  const offered = all.filter((type) => !type.forMinors && !type.forReferrals)
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

/**
 * What may be booked for a child -- someone under MINOR_AGE whose tutor (the
 * person writing) asks for them. Columnaquiro sells a child's first visit as
 * its own type, "Primera visita niño", and an adult must never be offered it,
 * nor a child the adult first visit when there is one for children:
 * - a child who has not been: the first visit for children (for_minors, at a
 *   first-visit stage); a clinic without one, its plain first visit;
 * - a child who has: anything but a first visit, as for any returning patient.
 */
export function typesForMinor<T extends PromptType>(all: T[], hasBeenBefore: boolean): T[] {
  const offered = all.filter((type) => !type.forReferrals)
  if (hasBeenBefore) return offered.filter((type) => !isFirstVisit(type) && type.bookableBy !== 'new_patients')
  const forNew = offered.filter((type) => type.bookableBy !== 'existing_patients')
  const forChildren = forNew.filter((type) => type.forMinors && isFirstVisit(type))
  if (forChildren.length) return forChildren
  return forNew.filter((type) => !type.forMinors && type.stage === 'first_visit')
}

/**
 * The first visit for someone a patient referred (for_referrals, at a
 * first-visit stage): Columnaquiro's "Primera Visita Referido". Never offered
 * on its own -- only once they have said which patient referred them, or to
 * someone the person writing brings, who is referred by them.
 */
export function typesForReferral<T extends PromptType>(offered: T[]): T[] {
  return offered.filter((type) => type.forReferrals && !type.forMinors && isFirstVisit(type) && type.bookableBy !== 'existing_patients')
}

/**
 * What may be booked for a new adult the person writing brings -- their
 * partner, a relative, a friend -- who is not on file: the referral first
 * visit, since the person writing referred them, and the plain first visit
 * for new patients when the clinic has none. The referral visit only when
 * the writer has been to the clinic (`referred`): one whose own first visit
 * was never had still has the referral recorded, at the regular price.
 */
export function typesForSomeoneTheyBring<T extends PromptType>(offered: T[], referred: boolean): T[] {
  const referral = referred ? typesForReferral(offered) : []
  return referral.length ? referral : typesForAudience(offered, 'new').types
}

/** What the person they bring is to them, as patient_relations records it; 'friend' is not family, and is not linked. */
export const BROUGHT_RELATIONS = [...FAMILY_RELATIONS, 'friend'] as const

/**
 * The prompt section on booking for someone new the person writing brings.
 * Somebody wrote that the first visit he had booked was really for his
 * partner: the receptionist offered her a second time "justo antes de la
 * tuya" and then handed him over, and the visit stayed in his name until a
 * person moved it by hand (25 Oct 2026).
 */
export function someoneTheyBringSection(opts: { types: PromptType[]; referred: boolean; canBook: boolean; canGive: boolean; sendsItself: boolean }): string {
  const list = opts.types.length ? quotedTypes(opts.types) : 'none -- your colleague arranges it'
  return [
    `# Someone new they bring\nThey may want a first visit for someone who has not been to the clinic -- their partner, a relative, a friend -- instead of or as well as for themselves. That person is then a new patient, referred by the person writing: the visit is in that person's own name, and they get the confirmation on their own phone.${opts.referred ? '' : ' The person writing has not been to the clinic themselves, so the referral visit and its price are not for that person: offer only what is listed here.'}`,
    `- Ask that person's first name and surname(s) and their mobile number, together, once. Offer them: ${list}.`,
    opts.canBook
      ? `- To book it, call book_appointment with other_person_name, other_person_phone and, if they said it, other_person_relation (what that person is to them). If it says that person may already be on file, do as it says.`
      : `- When they pick a time, say your colleague will confirm it.`,
    opts.canGive
      ? `- If a first visit they already booked is really for that other person ("la cita es para mi pareja"), do NOT offer another time and do not book a second visit: ask that person's name, surname(s) and mobile, and call give_visit_to with the visit's current day and time. The visit keeps its day and time; only whose it is changes.`
      : `- If a visit they already booked is really for someone else, ${opts.sendsItself ? 'call hand_over_to_colleague saying whose it is, with that person\'s name and mobile' : 'say your colleague will change it'}; do not offer another time.`,
    `- Never say whether someone is a patient of the clinic, and never tell them that person has to write to the clinic themselves.`,
  ].filter(Boolean).join('\n')
}

/**
 * The prompt section on someone new who was referred by a patient, for a
 * clinic with a referral first visit. Offered only once they say a patient
 * recommended them, and booked only with that patient's name: the clinic
 * links the two records (patients.referred_by_patient_id), as it does by hand.
 */
export function referralSection(opts: { types: PromptType[]; canBook: boolean; sendsItself: boolean }): string {
  if (!opts.types.length) return ''
  const list = quotedTypes(opts.types)
  return [
    `# Referred by a patient\n${list} is the clinic's first visit for someone a patient of the clinic referred: someone who has been to the clinic, not just booked. Offer it only when they say themselves that a patient of the clinic recommended it -- a friend, a relative who comes here -- never otherwise, and never ask how they found the clinic to find out. Someone recommended by a person who is not a patient here has the regular first visit.`,
    `- When they say so, ask the first name and surname of the patient who referred them, once.`,
    opts.canBook
      ? `- Book it with book_appointment, with referred_by set to that name exactly as they gave it. It checks the name against the clinic's patients: if it cannot match it, do as it says. Never tell them whether that person is a patient.`
      : `- When they pick a time, say your colleague will confirm it.`,
  ].join('\n')
}

/** A child of the person writing, already on file with them as tutor. */
export interface PromptChild {
  firstName: string
  lastName: string | null
  hasBeenBefore: boolean
  /** False: the records only suggest the child is theirs (loadTutorChildren). Absent counts as linked. */
  linked?: boolean
  age?: number | null
}

/**
 * The prompt section on booking for a child. Before it, the receptionist
 * assumed the person writing was the patient: a patient asking "cita para mi
 * hija" was treated as wanting one for herself, and since she had been
 * before, no first visit existed for her daughter -- it asked what kind of
 * visit it would be and handed her to the desk.
 */
export function minorsSection(opts: { forNewChild: PromptType[]; forReturningChild: PromptType[]; children: PromptChild[]; canBook: boolean; sendsItself: boolean; bringsSomeone?: boolean }): string {
  const list = (types: PromptType[]) => (types.length ? quotedTypes(types) : 'none -- your colleague arranges it')
  const line = (c: PromptChild) => `- ${[c.firstName, c.lastName].filter(Boolean).join(' ')}${typeof c.age === 'number' ? `, ${c.age}` : ''}${c.hasBeenBefore ? ' (has been to the clinic)' : ' (has not been yet)'}`
  const children = opts.children.filter((c) => c.linked !== false).map(line)
  const probable = opts.children.filter((c) => c.linked === false).map(line)
  return [
    `# Appointments for their children\nThe person writing may want an appointment for their son or daughter rather than for themselves. The child is then the patient, and the person writing is the child's tutor (legal guardian), who gets the confirmation and the reminders. Everything above about prices, types and first visits is about the person writing; for their child, use this section.`,
    `- If it is not clear who the appointment is for, ask. If it is for a child and you do not have them yet, ask the child's first name and surname and their age.`,
    `- Under ${MINOR_AGE}, for a child who has not been to the clinic yet, offer only: ${list(opts.forNewChild)}. For a child who has been: ${list(opts.forReturningChild)}. A child who has been is seen by their own practitioner, not necessarily the one the person writing sees: look up their free times with find_free_times and for_name set to the child's name, and offer those. When they want several children seen, offer times next to each other, and book each child in turn.`,
    `- ${MINOR_AGE} or over: an adult, not a child -- see "Appointments for an adult in their family" if it is there; otherwise ${opts.bringsSomeone ? 'see "Someone new they bring"' : `ask that person's first name and surname, offer times, and ${opts.sendsItself ? 'call hand_over_to_colleague with the name and the time they accepted' : 'say your colleague will confirm it'}`}. Never tell them that person has to write to the clinic themselves.`,
    opts.canBook ? `- To book it, call book_appointment with child_name and child_age as well: the visit is then in the child's name, with the person writing as their tutor. Moving or cancelling a child's visit is your colleague's: hand those over.` : '',
    children.length ? `Their children already on file with them as tutor:\n${children.join('\n')}` : '',
    probable.length
      ? `Probably also their children -- in their family on the clinic's records, not yet confirmed as theirs:\n${probable.join('\n')}\nWhen they ask for their children without naming them, ask the children's names and ages; never say these names first. A name they give that matches one of these is that child, already a patient here: never make another record for them. Booking them with child_name confirms them as the children of the person writing.`
      : '',
  ].filter(Boolean).join('\n')
}

/** An adult in the family of the person writing, linked on their record. */
export interface PromptRelative {
  firstName: string
  lastName: string | null
  /** patient_relations.relation: what they are to the person writing. */
  relation: string
  hasBeenBefore: boolean
}

const RELATION_WORDS: Record<string, string> = { partner: 'partner', parent: 'parent', child: 'grown-up son or daughter', sibling: 'brother or sister', other: 'relative' }

/**
 * The prompt section on booking for an adult in the family of the person
 * writing. A patient asked for a visit for her and her husband, and was told
 * twice that he "tiene que escribirnos él directamente" -- although he was a
 * patient too, and a colleague was arranging both visits in his own thread.
 *
 * Only people linked to them as family on the clinic's records are booked
 * for (loadFamilyAdults); anyone else named is handed over, and nothing is
 * said about whether that person is a patient at all.
 */
export function familySection(opts: { forNew: PromptType[]; forReturning: PromptType[]; members: PromptRelative[]; canBook: boolean; sendsItself: boolean; bringsSomeone?: boolean }): string {
  const list = (types: PromptType[]) => (types.length ? quotedTypes(types) : 'none -- your colleague arranges it')
  const members = opts.members.map((m) => `- ${[m.firstName, m.lastName].filter(Boolean).join(' ')}, their ${RELATION_WORDS[m.relation] ?? 'relative'}${m.hasBeenBefore ? ' (has been to the clinic)' : ' (has not been yet)'}`)
  const handOver = opts.sendsItself ? 'call hand_over_to_colleague with that person\'s full name and the day and time they accepted, and tell them your colleague will confirm it' : 'say your colleague will confirm it'
  return [
    `# Appointments for an adult in their family\nThey may want an appointment for their partner or another adult in their family, as well as or instead of one for themselves. That person is then the patient: the visit is in their name and they get the confirmation themselves.`,
    members.length
      ? `Their family on the clinic's records:\n${members.join('\n')}\n\nFor one of these, offer times as for any patient: someone who has been, the same type as they usually have (${list(opts.forReturning)}); someone who has not, ${list(opts.forNew)}. When they want both visits together, offer times next to each other.${opts.canBook ? ' To book it, call book_appointment with family_member_name as well. It checks the time with that person\'s own practitioner; if it is not free, offer one of the times it gives instead. Moving or cancelling their visits is your colleague\'s: hand those over.' : ''}`
      : '',
    opts.bringsSomeone
      ? `For anyone else -- someone not listed above -- see "Someone new they bring".`
      : `For anyone else -- someone not listed above -- ask their first name and surname, offer times, and ${handOver}. Never tell them that person has to write to the clinic themselves.`,
    `Never tell them anything about that person's visits, history, package or payments, and never say whether someone not listed above is a patient of the clinic.`,
  ].filter(Boolean).join('\n')
}

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

/**
 * The child on file this name means: the first name has to match, and a
 * surname given has to match too when the record has one. null: none of
 * theirs, so a new record is made. 'ambiguous': more than one -- two
 * siblings with one first name and no surname given -- which is neither
 * booked over the wrong one nor made a third record for.
 */
export function matchChild<T extends { firstName: string; lastName: string | null }>(children: T[], name: string): T | 'ambiguous' | null {
  const [first, ...rest] = fold(name).split(/\s+/)
  const surname = rest.join(' ')
  const hits = children.filter((c) => fold(c.firstName).split(/\s+/)[0] === first && (!surname || !c.lastName || fold(c.lastName).startsWith(surname.split(' ')[0]!)))
  if (hits.length > 1) return 'ambiguous'
  return hits[0] ?? null
}

/**
 * The patient a referral names: their first name and every surname given
 * have to match (accents and case aside), and the name has to have a surname
 * at all -- "Ana" alone is half the clinic. Exactly one, or none: two
 * patients with that name is 'ambiguous', and the booking is a person's.
 */
export function matchReferrer<T extends { firstName: string; lastName: string | null }>(people: T[], name: string): T | 'ambiguous' | 'need_surname' | null {
  const [first, ...surnames] = fold(name).split(/\s+/).filter(Boolean)
  if (!first || !surnames.length) return 'need_surname'
  const hits = people.filter((p) => {
    if (fold(p.firstName).split(/\s+/)[0] !== first) return false
    const theirs = fold(p.lastName ?? '').split(/\s+/).filter(Boolean)
    return surnames.every((s) => theirs.includes(s))
  })
  if (hits.length > 1) return 'ambiguous'
  return hits[0] ?? null
}

/**
 * A pattern for PostgREST's ilike that finds a first name whatever its
 * accents: every vowel, and n, is "any one letter" (í, ñ). It only narrows
 * the rows read; matchReferrer decides.
 */
export function accentBlindPrefix(word: string): string {
  return `${fold(word).replace(/[^a-z]/g, '_').replace(/[aeioun]/g, '_')}%`
}

/** What the prompt says about who this is, for booking. */
export function audienceSection(audience: ReceptionistAudience): string {
  if (audience === 'new_from_ad') {
    return `# Who you are talking to\nSomeone who has not been to the clinic yet and came through one of its ads. Their first appointment is the one listed under "What you can offer": to them it is simply the clinic's first-visit offer, so never mention the ad.`
  }
  if (audience === 'new') {
    return `# Who you are talking to\nSomeone who has not been to the clinic yet. Their first appointment is a first visit, as listed under "What you can offer".`
  }
  return `# Who you are talking to\nA patient who has been to the clinic before. Never offer them a first visit.`
}

/** The prompt section that says what may be offered. */
export function offeredTypesSection(offeredTypes: PromptType[], adOnly: PromptType[] = [], opts: { referralVisit?: boolean } = {}) {
  if (offeredTypes.length === 0) {
    return `# What you can offer\nNo type of appointment can be booked through you. Do not offer times for a new appointment. If the patient wants one, say your colleague will arrange it with them.`
  }
  const line = (type: PromptType) => `- ${type.name} (${type.durationMinutes} min${typePrice(type) ? `, ${typePrice(type)}` : ''})`
  // The price on the type is the clinic's own, kept where it is changed --
  // a knowledge card naming a price is a second copy that goes stale.
  const priced = [...offeredTypes, ...adOnly].some((type) => typePrice(type))
  return [
    `# What you can offer\nOnly these types of appointment can be booked through you:\n${offeredTypes.map(line).join('\n')}${priced ? '\nThe price next to a type is its price now. Give that one, even if the clinic knowledge names another for it.' : ''}`,
    adOnly.length
      ? `The clinic also has a first-visit offer, which is NOT for everyone:\n${adOnly.map(line).join('\n')}\nDo not mention it, and do not ask how they found the clinic: give them the regular first-visit price. Only if they say themselves that they came from one of the clinic's ads${opts.referralVisit ? '' : ' or were recommended'} -- or whatever else the clinic knowledge says qualifies -- offer it, as an offer the clinic has right now ("ahora mismo tenemos una oferta de primera visita por Y €"), never as "because you came from our ad".`
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

/**
 * When the receptionist may book or move a visit on its own: once there is no
 * doubt which exact day and time the person wants. Offered "martes 20 a las
 * 10:00 o miércoles 21 a las 16:00", "Miércoles 21" can only mean the 16:00
 * -- asking again would be one message too many. What needs the question is
 * a choice that could be more than one time: a day offered at two times, a
 * "vale" to several, a day or time that was not offered.
 */
export const CONFIRM_BEFORE_BOOKING =
  'Book or move only when there is no doubt which exact day and time they want: they named both themselves ("el miércoles 21 a las 16:00") and it is free, or their answer can only be one of the times you just offered -- offered "martes 20 a las 10:00 o miércoles 21 a las 16:00", "miércoles 21" means 16:00 and you book it without asking again. If it could be more than one time (you offered two times that day, they said "vale" to several options, or a day or time you did not offer), ask "¿Te lo confirmo el miércoles 21 de octubre a las 16:00 con Jordana?" first and do not book yet.'

/** A visit the person already has booked, as the reschedule section names it. */
export interface BookedVisit {
  startsAt: string
  typeName: string | null
}

/**
 * Moving a visit they already have. The receptionist offers new times for
 * the SAME type -- a patient moving their adjustment is not offered a first
 * visit, and a lead moving their first-visit offer keeps the offer -- from
 * the Booking list or find_free_times, which include those types even when
 * the receptionist does not offer them for new bookings.
 *
 * Cancelling one visit is its own too, when it answers on its own
 * (cancel_appointment). It was a person's, and the visit stayed booked
 * meanwhile -- or for good, when "voy el jueves y la otra ya la coordinamos"
 * was taken as settled: a slot lost and a reminder nobody wanted. Fees,
 * refunds, packages and stopping treatment stay with a person; a draft still
 * says a colleague will take care of it.
 *
 * Either way it asks first whether they would rather move it to another day:
 * that is the clinic's rule (20 Oct), and most "no puedo ir" are a visit to
 * move, not one to lose.
 *
 * `listVisits` is off where the prompt already lists them (patient facts).
 */
export function rescheduleSection(visits: BookedVisit[], timeZone: string, opts: { listVisits: boolean; canBook?: boolean }): string {
  if (visits.length === 0) return ''
  const list = visits
    .map((visit) => {
      const when = new Date(visit.startsAt).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone })
      return `- ${when}${visit.typeName ? ` (${visit.typeName})` : ''}`
    })
    .join('\n')
  return [
    `# Moving a visit they already have`,
    opts.listVisits ? `They have booked:\n${list}` : '',
    // Unsure whether a visit was on the 22nd or the 29th, a patient was
    // handed to a person and nobody answered, while the diary already said
    // (23 Oct 2026).
    opts.listVisits ? `If they are unsure when one of these is, tell them its day and time from this list first, before anything else.` : '',
    // Two slips of 28 Oct 2026. A revisión was offered 10:15, a time only a
    // shorter visit fitted, and had to be taken back once chosen. And a
    // patient stuck on the motorway at 19:17 was offered other days while her
    // 19:30 stayed booked -- the 27th's migraine at 9:30 ended as a no-show
    // the same way, two hours after she warned the clinic.
    `If they want to change the day or time of one of these, offer new times for that same type of appointment -- from the Booking list, or find_free_times -- and never a different type: only times listed under that type's own name, since a time free for a shorter type may not fit theirs. Look at their other booked visits first: a time the day before, the same day or the day after another of them is offered only by saying so ("ya tienes cita el miércoles 21 a las 17:30"). This holds even when that type is not under "What you can offer", which is about new appointments. ${opts.canBook ? `${CONFIRM_BEFORE_BOOKING} Then move it with book_appointment (move_visit_on = its current day and time), and only once that confirms tell them it is moved.` : 'When they pick one, say you are passing the change on and that they will get a confirmation: it is not moved until then, and their current time stands meanwhile.'} ${opts.canBook ? 'If they say they will not come to one of these, or want to cancel it, first ask whether they would like to move it to another day instead. Only if they say no -- they want it cancelled -- or have already said they do not want another time, call cancel_appointment with its current day and time (visit_on) -- once there is no doubt which visit, which with several means asking which one -- and only once it confirms tell them it is cancelled. Never ask "¿te la quito?" -- the question is whether they want another day -- and never leave a visit booked that they have said they will not come to: "voy el jueves y la otra ya la coordinamos" means cancel the other one now. If they cannot come but want another time, move it instead. A visit TODAY that they say they cannot make (ill, stuck on the road, running late past it) will not be used whatever they answer: cancel it now with cancel_appointment -- this is the one case you do not first ask whether they want another day -- and in the same reply say so and offer other times -- never on the same day to someone who is ill. Never leave the visit today booked while they choose another: it ends as a no-show for someone who warned the clinic. If, when you offer another day, they point to a visit they already have instead ("tengo cita el día 5", "ya voy el jueves"), that is their answer: they want no other time. Cancel the one they cannot come to with cancel_appointment, tell them the one they keep stands, and never offer times for it again. Stopping or pausing their treatment, or cancelling a package, is for a colleague.' : 'If they say they cannot come to it, or want to cancel it, first ask whether they would like to move it to another day instead. Only if they say no, say your colleague will cancel it: never say you will remove it. If, when you offer another day, they point to a visit they already have instead ("tengo cita el día 5"), that is a no: say your colleague will cancel the one they cannot come to and that the other stands, and never offer times for it again.'}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Whether the name on a lead is the one the person gave. A form -- the ad's,
 * the website's -- asks for it; a WhatsApp or Instagram lead carries only the
 * profile name ("Mari", "Javi 🏄"), which is not what goes on a patient record.
 */
export function leadNameIsTheirs(channel: string | null | undefined): boolean {
  return Boolean(channel) && channel !== 'whatsapp' && channel !== 'instagram'
}

/**
 * What to ask someone not yet a patient before booking them, given what the
 * lead already holds. A lead from the ad form has both and was asked for them
 * again ("solo necesito tu email"), which is the form a second time.
 */
export function newPatientDetailsSection(known: { name: boolean; email: boolean }): string {
  const pass = 'pass them to book_appointment as full_name and email exactly as they wrote them'
  if (known.name && known.email) {
    return `This person's name and email are already on record, from the form they filled in: never ask for either. Book them without (leave full_name and email out of book_appointment) unless they give you different ones.`
  }
  if (known.email) {
    return `Their email is already on record, so never ask for it. To book them you need their first name and surname(s) -- ask for that, once, if they have not given it, and pass it to book_appointment as full_name exactly as they wrote it.`
  }
  if (known.name) {
    return `Their name is already on record, from the form they filled in, so never ask for it. To book them you need their email -- ask for it, once, if they have not given it, and pass it to book_appointment as email exactly as they wrote it.`
  }
  return `To book someone who is not yet a patient, you need their first name and surname(s) and their email -- ask for both together, once, if they have not given them, and ${pass}.`
}

/**
 * The name and email a new patient wrote in the conversation, checked. A
 * lead from WhatsApp carries only their profile name (a nickname, say), so the
 * record the receptionist made from one had that nickname, no surname, no
 * email -- while the conversation had both. The phone it already has: they are writing
 * from it.
 */
export function newPatientDetails(fullName: unknown, email: unknown): { fullName: string | null; email: string | null } {
  const name = typeof fullName === 'string' ? fullName.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/g, ' ').trim().replace(/[.,;]+$/, '').slice(0, 120) : ''
  const mail = typeof email === 'string' ? email.trim().toLowerCase() : ''
  return {
    fullName: name.length >= 2 ? name : null,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail) && mail.length <= 254 ? mail : null,
  }
}

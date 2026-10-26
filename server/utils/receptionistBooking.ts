import type Anthropic from '@anthropic-ai/sdk'
import type { H3Event } from 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { randomUUID } from 'node:crypto'
import { loadReceptionistCalendar, type BookedAppointment, type FamilyAdult, type OfferedType, type ReceptionistConfig, type TutorChild } from '~/server/utils/receptionist'
import { claimConvertedLead, createPatientFromLead, findLikelyExistingPatients } from '~/server/utils/leadConversion'
import { resolveWindow, saveAppointmentIfFree } from '~/server/utils/publicApiAppointments'
import { automationEvent } from '~/server/utils/automationEngine'
import { afterUnattendedCancellation } from '~/server/utils/unattendedCancellation'
import { pushAppointmentEvent } from '~/server/utils/staffPush'
import { claimAutomaticConfirmation, sendAppointmentConfirmation } from '~/server/utils/appointmentNotifications'
import { receptionistServiceClient } from '~/server/utils/receptionistAudit'
import { applyPatientLeft } from '~/server/utils/recallReplies'
import { clinicDateOf, startOfLocalDate, wallClockToUtc } from '~/utils/clinicClock'
import { leadPhoneAsContactNumber, phoneMatches, toE164Loose, whatsappDigits } from '~/utils/phone'
import { inverseRelation, type FamilyRelation } from '~/utils/familyRelations'
import { BROUGHT_RELATIONS, MINOR_AGE, accentBlindPrefix, matchChild, matchReferrer, newPatientDetails, typePrice } from '~/utils/receptionistTypes'

// The AI receptionist booking a visit, or moving one, on its own -- only when
// it is answering on its own (utils/receptionistAutoReply.ts): a draft a
// person reads must not have written to the calendar before they read it.
//
// It books what it could have offered and nothing else:
// - a type it may offer this person (typesForAudience), or for a move, the
//   visit's own type;
// - a start that is free right now in the same slot computation the prompt's
//   list and find_free_times use, narrowed the same way (a returning
//   patient's own practitioner);
// - written through save_appointment_if_free, the check and the write in one
//   transaction under the practitioner's lock -- the booking page's and the
//   API's path, so a time taken a second ago is refused, not double-booked;
// - followed by what an API booking gets (the patient's confirmation) and a
//   push to the practitioner saying the receptionist booked it.
// A lead is made a patient first, exactly as the Convert button does it
// (leadConversion.ts) -- unless they may already be one, which is a person's
// call, never a guess.
//
// Everything it writes goes through receptionistServiceClient, so the audit
// trail records each change -- the visit, its time, the patient record -- as
// "Recepcionista IA" with what changed; and each booking or move leaves a
// note in the conversation saying what it did (`onBooked`). If it gets one
// wrong, both say exactly what to put right.
//
// One booking or move per reply. A second call in the same reply is refused:
// a model that books twice for one "yes" is a model to stop.
//
// Cancelling a visit (cancel_appointment) is its own on the same terms. It
// used to be a person's, by escalation rule: the patient was told "mi
// compañera se encarga" and the visit stayed booked until somebody at the
// desk got to it -- or, when the receptionist merely took note of "voy el
// jueves y la otra ya la coordinamos", stayed booked for good: a slot lost
// and a reminder they had not asked for. It cancels the way the reminder's
// own "Cancelar" button does (server/api/whatsapp/webhook.post.ts): the row
// kept as cancelled, no fee -- a fee is a person's call, made from
// components/calendar/CancelStep.vue.

type Supa = SupabaseClient<Database>

export const BOOK_APPOINTMENT: Anthropic.Tool = {
  name: 'book_appointment',
  description:
    'Books a visit in the clinic calendar, or moves one they already have, at a time you offered from the Booking list or find_free_times. Call it only when there is no doubt which exact day and time they want: they named both, or their answer can only be one of the times you just offered (offered one time on Wednesday, "miércoles" is that time). If it could be more than one time, ask them to confirm first. Only after it confirms may you tell them it is booked; it tells you who it is with.',
  input_schema: {
    type: 'object',
    properties: {
      appointment_type: { type: 'string', description: 'The type, by its exact name from "What you can offer". Leave out to move a visit: it keeps its type.' },
      date: { type: 'string', description: 'The day, as YYYY-MM-DD.' },
      time: { type: 'string', description: "The start time on the clinic's clock, as HH:MM, exactly as listed." },
      move_visit_on: { type: 'string', description: 'To move a visit they already have instead of booking a new one: that visit\'s current day and time, as "YYYY-MM-DD HH:MM".' },
      full_name: { type: 'string', description: 'For someone not yet a patient: their first name and surname(s) exactly as they wrote them in the conversation. Leave out if they have not given it.' },
      email: { type: 'string', description: 'For someone not yet a patient: the email address they wrote in the conversation. Leave out if they have not given one.' },
      child_name: { type: 'string', description: 'When the visit is for their child, not for them: the child\'s first name and surname(s) exactly as given. The visit is then booked in the child\'s name, with the person writing as tutor.' },
      child_age: { type: 'number', description: 'With child_name: the child\'s age in years, as they said it.' },
      family_member_name: { type: 'string', description: 'When the visit is for an adult in their family listed under "Appointments for an adult in their family", not for them: that person\'s first name (and surname, if given). The visit is then booked in that person\'s name.' },
      other_person_name: { type: 'string', description: 'When the visit is for someone new they bring (see "Someone new they bring"), not for them: that person\'s first name and surname(s) exactly as given. The visit is then booked in that person\'s own name, referred by the person writing.' },
      other_person_phone: { type: 'string', description: 'With other_person_name: that person\'s own mobile number, as given.' },
      other_person_relation: { type: 'string', enum: [...BROUGHT_RELATIONS], description: 'With other_person_name, if they said it: what that person is to them.' },
      referred_by: { type: 'string', description: 'When booking someone new as referred by a patient (see "Referred by a patient"): the first name and surname of the patient who referred them, exactly as they gave it.' },
    },
    required: ['date', 'time'],
    additionalProperties: false,
  },
}

export const GIVE_VISIT_TO: Anthropic.Tool = {
  name: 'give_visit_to',
  description:
    'Puts a first visit they booked for themselves in the name of someone new they bring, when they say it was really for that person ("la cita es para mi pareja"). Same day, time and practitioner: that person becomes a new patient referred by them, and gets the confirmation on their own phone. Only after it confirms may you tell them it is changed.',
  input_schema: {
    type: 'object',
    properties: {
      visit_on: { type: 'string', description: 'That visit\'s current day and time, as "YYYY-MM-DD HH:MM".' },
      person_name: { type: 'string', description: 'The other person\'s first name and surname(s), exactly as given.' },
      person_phone: { type: 'string', description: 'The other person\'s own mobile number, as given.' },
      person_relation: { type: 'string', enum: [...BROUGHT_RELATIONS], description: 'If they said it: what that person is to them.' },
    },
    required: ['visit_on', 'person_name', 'person_phone'],
    additionalProperties: false,
  },
}

export const ADD_TO_WAITLIST: Anthropic.Tool = {
  name: 'add_to_waitlist',
  description:
    "Puts them on the clinic's waiting list, so a colleague can offer them a time that frees up. Call it only when no free time suits them and they have said when they could come, and they agree to be on the list. Afterwards tell them the clinic will let them know if a time that suits them frees up -- never promise one.",
  input_schema: {
    type: 'object',
    properties: {
      appointment_type: { type: 'string', description: 'The type they want, by its exact name from "What you can offer". Leave out if there is only one.' },
      preference: { type: 'string', description: 'When they can come, in a few words in the clinic\'s language, for your colleagues: "solo viernes por la tarde", "lunes o martes a partir de las 18:00".' },
      full_name: { type: 'string', description: 'For someone not yet a patient: their first name and surname(s) exactly as they wrote them. Leave out if they have not given it.' },
      email: { type: 'string', description: 'For someone not yet a patient: the email address they wrote. Leave out if they have not given one.' },
    },
    required: ['preference'],
    additionalProperties: false,
  },
}

export const CANCEL_APPOINTMENT: Anthropic.Tool = {
  name: 'cancel_appointment',
  description:
    'Cancels a visit they already have, from the list under "Moving a visit they already have". Call it only when there is no doubt which visit, and that they want it cancelled rather than moved: they asked to cancel it, or said they will not come to it and do not want another time now. If they have several visits and did not say which, ask first. Only after it confirms may you tell them it is cancelled. Stopping or pausing their treatment, or cancelling a package, is not this: hand those over to a colleague.',
  input_schema: {
    type: 'object',
    properties: {
      visit_on: { type: 'string', description: 'That visit\'s current day and time, as "YYYY-MM-DD HH:MM".' },
    },
    required: ['visit_on'],
    additionalProperties: false,
  },
}

export const STOP_FOLLOW_UPS: Anthropic.Tool = {
  name: 'stop_follow_ups',
  description:
    'Takes this patient off the clinic\'s follow-up and recall messages, for good. Call it only when they say they have moved away, or that they will not be coming back to the clinic at all. Never for "más adelante", a holiday, a trip, a busy few weeks or "not now": those are a later, not a goodbye. After it confirms, say goodbye in one short sentence, without offering times. It does not cancel any visit they still have.',
  input_schema: {
    type: 'object',
    properties: {
      what_they_said: { type: 'string', description: 'Their words that say they are leaving, quoted briefly.' },
    },
    required: ['what_they_said'],
    additionalProperties: false,
  },
}

/** stop_follow_ups for one patient in one reply (applyPatientLeft). */
export function stopFollowUpsTool(ctx: { event: H3Event; accountId: string; patientId: string }): (input: unknown) => Promise<ToolResult> {
  let used = false
  return async (input) => {
    if (used) return { content: 'Already done in this reply.', isError: false }
    const said = String((input as { what_they_said?: unknown })?.what_they_said ?? '').trim()
    used = true
    const done = await applyPatientLeft(receptionistServiceClient(ctx.event), ctx.accountId, ctx.patientId, said)
    if (!done) {
      used = false
      return { content: 'It could not be done. Call hand_over_to_colleague saying they have left, so a colleague takes them off the follow-ups.', isError: true }
    }
    return { content: 'Done: they will get no more follow-up or recall messages. Now say goodbye in one short sentence, without offering times.', isError: false }
  }
}

export interface BookingContext {
  event: H3Event
  /** Reads (the calendar, the lead, the patient). Writes use receptionistServiceClient. */
  service: Supa
  accountId: string
  config: ReceptionistConfig
  timeZone: string
  /** What this person may be offered for a new booking. */
  types: OfferedType[]
  /** Their booked visits, and those visits' types (which a move keeps). */
  booked: { appointments: BookedAppointment[]; types: OfferedType[] }
  /** A returning patient's own practitioner(s); null for anyone. */
  practitionerIds: string[] | null
  person: { kind: 'lead'; leadId: string; patientId: string | null } | { kind: 'patient'; patientId: string }
  /** Told what was booked or moved, in words, to note it in the conversation. */
  onBooked: (summary: string) => Promise<void>
  /**
   * Booking for a child of the person writing (typesForMinor): what a new
   * and a returning child may have, and their children already on file.
   * Absent: book_appointment refuses child_name.
   */
  minors?: { forNewChild: OfferedType[]; forReturningChild: OfferedType[]; children: TutorChild[] }
  /**
   * Booking for an adult linked to the person writing as family
   * (loadFamilyAdults): what a new and a returning one may have, and who
   * they are. Absent: book_appointment refuses family_member_name.
   */
  family?: { forNew: OfferedType[]; forReturning: OfferedType[]; members: FamilyAdult[] }
  /**
   * Booking for someone new the person writing brings, not on file
   * (typesForSomeoneTheyBring), and give_visit_to. Absent: both refused.
   */
  bringsSomeone?: { types: OfferedType[]; referred: boolean }
  /**
   * Their own first visit as someone a patient referred (typesForReferral):
   * for someone new only. Booked only with referred_by naming that patient.
   */
  referral?: { types: OfferedType[] }
}

type ToolResult = { content: string; isError: boolean }

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * book_appointment, once per person in one reply: a parent booking two
 * children, or a visit for themselves and one for their partner, is several
 * people, each booked once.
 */
export function bookingTool(ctx: BookingContext): (input: unknown) => Promise<ToolResult> {
  const used = new Set<string>()
  return async (input) => {
    const value = (input ?? {}) as { appointment_type?: unknown; date?: unknown; time?: unknown; move_visit_on?: unknown; full_name?: unknown; email?: unknown; child_name?: unknown; child_age?: unknown; family_member_name?: unknown; other_person_name?: unknown; other_person_phone?: unknown; other_person_relation?: unknown; referred_by?: unknown }
    const date = typeof value.date === 'string' ? value.date.trim() : ''
    const time = typeof value.time === 'string' ? value.time.trim() : ''
    if (!DAY.test(date) || !HH_MM.test(time)) return { content: 'date must be YYYY-MM-DD and time HH:MM, exactly as listed.', isError: true }

    const start = new Date(wallClockToUtc(date, time, ctx.timeZone))
    if (Number.isNaN(start.getTime()) || start.getTime() <= Date.now()) return { content: 'That time has already passed. Offer another.', isError: true }

    // For their child rather than for them: a minor, booked in the child's
    // own name with the person writing as tutor (typesForMinor). The child
    // is found among those already on file with them, or made one.
    const childName = typeof value.child_name === 'string' ? value.child_name.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
    let child: { existing: TutorChild | null; name: string } | null = null
    if (childName) {
      if (!ctx.minors) return { content: 'You cannot book for their child here. Call hand_over_to_colleague saying who it is for and the day and time they accepted.', isError: true }
      if (typeof value.move_visit_on === 'string' && value.move_visit_on.trim()) return { content: "Moving a child's visit is your colleague's. Call hand_over_to_colleague saying which visit and the new time they want.", isError: true }
      const age = typeof value.child_age === 'number' ? value.child_age : Number(value.child_age)
      if (!Number.isFinite(age) || age < 0) return { content: "Ask the child's age first, then book with child_age.", isError: true }
      if (age >= MINOR_AGE) return { content: `At ${age} they are an adult, not a child. If they are listed as family, book with family_member_name instead; otherwise call hand_over_to_colleague with their full name and the day and time accepted. Do not tell them that person has to write to the clinic.`, isError: true }
      const existing = matchChild(ctx.minors.children, childName)
      if (existing === 'ambiguous') return { content: 'More than one of their children on file has that name. Ask the child\'s surname and book with the full name; if they already gave it, call hand_over_to_colleague.', isError: true }
      child = { existing, name: childName }
    }

    // For an adult in their family (loadFamilyAdults): only someone linked to
    // them on the clinic's records. Anyone else is a person's to arrange, and
    // the answer does not say whether that name is a patient at all.
    const relativeName = typeof value.family_member_name === 'string' ? value.family_member_name.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
    let relative: FamilyAdult | null = null
    if (relativeName) {
      if (child) return { content: 'Give child_name or family_member_name, not both.', isError: true }
      if (typeof value.move_visit_on === 'string' && value.move_visit_on.trim()) return { content: "Moving a family member's visit is your colleague's. Call hand_over_to_colleague saying whose visit and the new time they want.", isError: true }
      const hit = ctx.family ? matchChild(ctx.family.members, relativeName) : null
      if (hit === 'ambiguous') return { content: 'More than one person in their family has that first name. Ask the surname and book with the full name; if they already gave it, call hand_over_to_colleague.', isError: true }
      if (!hit) return { content: "You cannot book for that person. Call hand_over_to_colleague with their full name and the day and time accepted, and tell them your colleague will confirm it. Do not say whether that person is a patient, and do not tell them that person has to write to the clinic.", isError: true }
      relative = hit
    }

    // For someone new they bring (someoneTheyBringSection): a new record of
    // their own, with their own phone, referred by the person writing --
    // never someone the clinic may already have, which is a person's call.
    let brought: BroughtPerson | null = null
    if (typeof value.other_person_name === 'string' && value.other_person_name.trim()) {
      if (child || relative) return { content: 'Book one person per call: child_name, family_member_name or other_person_name.', isError: true }
      if (!ctx.bringsSomeone) return { content: 'You cannot book for that person here. Call hand_over_to_colleague with their full name and mobile and the day and time accepted; do not say it is booked.', isError: true }
      if (typeof value.move_visit_on === 'string' && value.move_visit_on.trim()) return { content: 'To put a visit they already have in that person\'s name, call give_visit_to instead.', isError: true }
      const person = await readBroughtPerson(ctx, value.other_person_name, value.other_person_phone, value.other_person_relation)
      if ('error' in person) return { content: person.error, isError: true }
      brought = person
    }

    // Referred by a patient (referralSection): the patient they name has to
    // be one, exactly, before the referral visit is theirs. Their own booking
    // only -- whoever they bring is referred by them.
    let referrer: { id: string } | null = null
    const referredBy = typeof value.referred_by === 'string' ? value.referred_by.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
    if (referredBy && ctx.referral && !child && !relative && !brought) {
      const found = await findReferrer(ctx, referredBy)
      if (found === 'need_surname') return { content: 'Ask the surname of the patient who referred them too, then book again with referred_by. Do not book yet.', isError: true }
      if (!found || found === 'ambiguous') return { content: 'That name cannot be matched to one patient of the clinic. Never tell them whether that person is a patient. Call hand_over_to_colleague with the name they gave and the day and time they accepted, and tell them your colleague will confirm it; do not say it is booked.', isError: true }
      referrer = found
    }

    // Who this visit is for, so the same person is not booked twice in one
    // reply -- while two children, or them and their partner, may be.
    const whom = brought ? `brought:${brought.e164}` : relative ? `relative:${relative.id}` : child ? (child.existing ? `child:${child.existing.id}` : `new-child:${child.name.toLowerCase()}`) : 'self'
    if (used.has(whom)) return { content: 'You have already booked or moved a visit for this person in this reply. Do not book them again: tell them what was booked.', isError: true }

    // What is being booked: a move keeps the visit's type and is found by
    // when it is now; a new booking is one of the types this person may have
    // -- or, for their child, one the child may have.
    let moving: BookedAppointment | null = null
    let type: OfferedType | undefined
    if (brought) {
      const allowed = ctx.bringsSomeone!.types
      const name = typeof value.appointment_type === 'string' ? value.appointment_type.trim().toLowerCase() : ''
      type = allowed.find((t) => t.name.toLowerCase() === name) ?? (!name && allowed.length === 1 ? allowed[0] : undefined)
      if (!type) return { content: `For ${brought.firstName}, say which type, exactly as named: ${allowed.map((t) => t.name).join(', ') || 'none can be booked by you; call hand_over_to_colleague'}.`, isError: true }
    } else if (relative) {
      const allowed = relative.hasBeenBefore ? ctx.family!.forReturning : ctx.family!.forNew
      const name = typeof value.appointment_type === 'string' ? value.appointment_type.trim().toLowerCase() : ''
      type = allowed.find((t) => t.name.toLowerCase() === name) ?? (!name && allowed.length === 1 ? allowed[0] : undefined)
      if (!type) return { content: `For ${relative.firstName}, say which type, exactly as named: ${allowed.map((t) => t.name).join(', ') || 'none can be booked by you; call hand_over_to_colleague'}.`, isError: true }
    } else if (child) {
      const allowed = child.existing?.hasBeenBefore ? ctx.minors!.forReturningChild : ctx.minors!.forNewChild
      const name = typeof value.appointment_type === 'string' ? value.appointment_type.trim().toLowerCase() : ''
      type = allowed.find((t) => t.name.toLowerCase() === name) ?? (!name && allowed.length === 1 ? allowed[0] : undefined)
      if (!type) {
        return { content: `For ${child.existing?.hasBeenBefore ? 'a child who has been before' : 'a child who has not been yet'}, say which type, exactly as named: ${allowed.map((t) => t.name).join(', ') || 'none can be booked by you; call hand_over_to_colleague'}.`, isError: true }
      }
    } else if (typeof value.move_visit_on === 'string' && value.move_visit_on.trim()) {
      const wanted = value.move_visit_on.trim().replace('T', ' ')
      moving = ctx.booked.appointments.find((a) => localStamp(a.startsAt, ctx.timeZone) === wanted) ?? null
      if (!moving) {
        const theirs = ctx.booked.appointments.map((a) => localStamp(a.startsAt, ctx.timeZone)).join(', ')
        return { content: `They have no booked visit at ${wanted}. Their visits: ${theirs || 'none'}.`, isError: true }
      }
      type = ctx.booked.types.find((t) => t.id === moving!.typeId)
      if (!type) return { content: 'That visit cannot be moved by you. Call hand_over_to_colleague.', isError: true }
    } else {
      // The referral visit is theirs only with the patient who referred them.
      const own = [...ctx.types, ...(ctx.referral?.types ?? []).filter((t) => !ctx.types.includes(t))]
      const name = typeof value.appointment_type === 'string' ? value.appointment_type.trim().toLowerCase() : ''
      type = own.find((t) => t.name.toLowerCase() === name) ?? (!name && ctx.types.length === 1 ? ctx.types[0] : undefined)
      if (!type) {
        return { content: `Say which type, exactly as named: ${ctx.types.map((t) => t.name).join(', ') || 'none can be booked by you; call hand_over_to_colleague'}.`, isError: true }
      }
      if (type.forReferrals && !referrer) {
        return { content: `${type.name} is only for someone a patient referred. Ask the first name and surname of the patient who referred them and book with referred_by; if no patient referred them, offer ${ctx.types.map((t) => t.name).join(', ') || 'what a colleague arranges'} instead. Do not say it is booked.`, isError: true }
      }
    }

    // Free now, and with whom: the visit's own practitioner first for a move,
    // then the patient's own, then anyone the list was built from.
    const dayStart = startOfLocalDate(date, ctx.timeZone)
    let chosen: { practitionerId: string; clinicId: string } | null = null
    // A relative's or a child's times are with their own practitioner, not
    // the writer's: children who see one practitioner while their parent
    // sees another.
    // Someone new they bring is seen by whoever is free, as anyone new.
    const own = brought ? null : relative ? relative.practitionerIds : (child?.existing?.practitionerIds ?? ctx.practitionerIds)
    for (const practitionerId of await candidatePractitioners(ctx, moving, own)) {
      const calendar = await loadReceptionistCalendar(ctx.service, ctx.accountId, ctx.config, [type], new Date(), { from: dayStart, days: 1, maxTimesPerList: 1000 }, [practitionerId])
      const group = calendar.availability?.groups.find((g) => g.days.some((d) => d.date === date && d.times.includes(time)))
      if (group) {
        chosen = { practitionerId, clinicId: group.clinicId }
        break
      }
    }
    if (!chosen) {
      const day = await loadReceptionistCalendar(ctx.service, ctx.accountId, ctx.config, [type], new Date(), { from: dayStart, days: 1 }, own)
      const free = [...new Set(day.availability?.groups.flatMap((g) => g.days.filter((d) => d.date === date).flatMap((d) => d.times)) ?? [])].sort()
      return {
        content: `${time} on ${date} is not free for ${type.name}. ${free.length ? `Free that day: ${free.join(', ')}.` : 'Nothing is free that day.'} Offer one of those or another day; do not say it is booked.`,
        isError: true,
      }
    }

    const writer = receptionistServiceClient(ctx.event) as unknown as Supa

    // The patient: a lead becomes one first, as the Convert button does it.
    // For a child, that person is the tutor and the child is the patient.
    // A relative already has a record of their own: nothing to make.
    const tutor = relative ? { patientId: relative.id } : await ensurePatient(ctx, writer, chosen.practitionerId, newPatientDetails(value.full_name, value.email))
    if ('error' in tutor) return { content: tutor.error, isError: true }
    let patient = tutor
    if (child) {
      const childId = child.existing?.id ?? await createChild(writer, ctx, tutor.patientId, child.name, chosen)
      if (!childId) return { content: "The child's record could not be made. Call hand_over_to_colleague saying who it is for and the day and time they accepted; do not say it is booked.", isError: true }
      patient = { patientId: childId }
    }
    if (brought) {
      // Referred by the person writing, who is a patient now if they were not.
      const broughtId = await createBroughtPerson(writer, ctx, tutor.patientId, brought, chosen)
      if (!broughtId) return { content: "That person's record could not be made. Call hand_over_to_colleague with their full name and mobile and the day and time accepted; do not say it is booked.", isError: true }
      patient = { patientId: broughtId }
    }
    // Their own referral, recorded on their record as the desk does it; a
    // relative booked as new with the referral visit is referred by the
    // person writing.
    if (referrer) await recordReferral(writer, ctx.accountId, tutor.patientId, referrer.id)
    if (relative && type.forReferrals && ctx.person.patientId) await recordReferral(writer, ctx.accountId, relative.id, ctx.person.patientId)

    const { data: practitioner } = await ctx.service.from('team_members').select('full_name').eq('id', chosen.practitionerId).maybeSingle()
    const practitionerName = (practitioner as { full_name: string | null } | null)?.full_name ?? null
    const window = await resolveWindow(ctx.service, ctx.accountId, { startsAt: start.toISOString(), appointmentTypeId: type.id, practitionerId: chosen.practitionerId })

    used.add(whom)
    let appointmentId: string
    try {
      appointmentId = await saveAppointmentIfFree(
        writer,
        ctx.accountId,
        moving?.id ?? null,
        moving
          ? { starts_at: window.startsAt, ends_at: window.endsAt, practitioner_id: chosen.practitionerId, practitioner_name: practitionerName, rescheduled: true }
          : {
              patient_id: patient.patientId,
              clinic_id: chosen.clinicId,
              practitioner_id: chosen.practitionerId,
              practitioner_name: practitionerName,
              appointment_type_id: type.id,
              starts_at: window.startsAt,
              ends_at: window.endsAt,
              status: 'booked',
              source: 'receptionist',
            },
        { checkOverlap: true },
      )
    } catch (err) {
      used.delete(whom)
      // A record made a moment ago for this booking goes with it: left, its
      // phone would read as "already on file" on the next try.
      if (brought) await writer.from('patients').delete().eq('id', patient.patientId).eq('account_id', ctx.accountId)
      console.error('[receptionist] booking refused:', (err as Error)?.message ?? err)
      return { content: `${time} on ${date} was taken a moment ago. Offer another free time; do not say it is booked.`, isError: true }
    }

    const when = new Date(window.startsAt).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: ctx.timeZone })
    const was = moving ? new Date(moving.startsAt).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: ctx.timeZone }) : null
    // A child the records only suggested was theirs is theirs now: they named
    // them, and the visit is booked in the child's name with them as tutor.
    const confirmed = child?.existing && !child.existing.linked ? await linkChild(writer, ctx.accountId, tutor.patientId, child.existing.id) : false
    const forChild = child
      ? ` para ${child.existing ? [child.existing.firstName, child.existing.lastName].filter(Boolean).join(' ') : child.name}${child.existing ? (confirmed ? ' (marcado como menor, con quien escribe como tutor)' : '') : ' (ficha nueva, menor, con quien escribe como tutor)'}`
      : relative ? ` para ${[relative.firstName, relative.lastName].filter(Boolean).join(' ')} (familiar en su ficha)` : brought ? ` para ${brought.name} (ficha nueva, referida por quien escribe)` : referrer ? ' (referido por un paciente, anotado en su ficha)' : ''
    const summary = moving
      ? `He movido su ${type.name} del ${was} al ${when}${practitionerName ? ` con ${practitionerName}` : ''}.`
      : `He reservado ${type.name}${forChild} el ${when}${practitionerName ? ` con ${practitionerName}` : ''}.`
    console.info(`[receptionist] ${moving ? 'moved' : 'booked'} appointment ${appointmentId} (account ${ctx.accountId})`)

    // What follows any booking nobody at the clinic made: the note in the
    // conversation, the practitioner told, the patient's confirmation.
    // Best-effort -- the visit stands either way.
    try {
      await ctx.onBooked(summary)
      if (moving) {
        await pushAppointmentEvent(ctx.service as any, appointmentId, 'rescheduled')
      } else {
        await pushAppointmentEvent(ctx.service as any, appointmentId, 'booked_by_receptionist')
        if (await claimAutomaticConfirmation(ctx.service, appointmentId)) await sendAppointmentConfirmation(ctx.service, ctx.accountId, appointmentId)
      }
    } catch (err) {
      console.error('[receptionist] after booking:', (err as Error)?.message ?? err)
    }

    const whenEn = new Date(window.startsAt).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: ctx.timeZone })
    // Their other visits close to the new time. One moved "to next week"
    // landed the day after a visit they already had there, and nobody told
    // them they now had two in a row.
    // (Their own visits, not a child's: the child's are not in this list.)
    const near = ctx.booked.appointments
      .filter((a) => !child && !relative && !brought && a.id !== moving?.id && Math.abs(new Date(a.startsAt).getTime() - start.getTime()) < 2 * DAY_MS)
      .map((a) => new Date(a.startsAt).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: ctx.timeZone }))
    // Someone coming for the first time is told where to go.
    const address = moving ? null : await firstVisitAddress(ctx.service, patient.patientId, chosen.clinicId)
    return {
      content: [
        `${moving ? 'Moved' : 'Booked'}: ${type.name}${child ? ` for ${child.name}, in the child's name with them as tutor` : relative ? ` for ${relative.firstName}, in their own name` : brought ? ` for ${brought.firstName}, in their own name, referred by the person writing` : ''}, ${whenEn}${practitionerName ? `, with ${practitionerName}` : ''}. ${moving ? 'Their old time is free again.' : relative || brought ? `${(relative ?? brought)!.firstName} will get the clinic's usual confirmation themselves${brought ? ', on their own phone' : ''}.` : `They will also get the clinic's usual confirmation${child ? ', as the tutor' : ''}.`} Tell them, with the day and time in words.`,
        near.length ? `They also have ${near.length === 1 ? 'a visit' : 'visits'} on ${near.join(' and ')}: mention ${near.length === 1 ? 'it' : 'them'}, and ask whether they want to keep ${near.length === 1 ? 'it' : 'them'}.` : '',
        address ? `It is their first visit: give them the clinic's address, ${address}.` : '',
      ].filter(Boolean).join(' '),
      isError: false,
    }
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A child the records only suggested was the writer's (loadTutorChildren),
 * confirmed by them naming the child for a visit: a minor with the writer as
 * tutor -- unless someone else is already their tutor, which is left alone --
 * and linked as their child both ways under Familia (patient_relations). The
 * date of birth is not touched; the clinic may not have one, and an age said
 * in a chat is not one. True when the child is now theirs.
 */
export async function linkChild(writer: Supa, accountId: string, tutorId: string, childId: string): Promise<boolean> {
  const { data: updated, error } = await writer
    .from('patients')
    .update({ is_minor: true, tutor_patient_id: tutorId } as never)
    .eq('id', childId)
    .eq('account_id', accountId)
    .or(`tutor_patient_id.is.null,tutor_patient_id.eq.${tutorId}`)
    .select('id')
  if (error || !(updated ?? []).length) {
    if (error) console.error('[receptionist] could not link the child to their tutor:', error.message)
    return false
  }
  const { error: relError } = await writer.from('patient_relations').upsert(
    [
      { account_id: accountId, patient_id: tutorId, related_patient_id: childId, relation: 'child' },
      { account_id: accountId, patient_id: childId, related_patient_id: tutorId, relation: 'parent' },
    ] as never,
    { onConflict: 'patient_id,related_patient_id', ignoreDuplicates: true },
  )
  if (relError) console.error('[receptionist] could not link the child as family:', relError.message)
  return true
}

/**
 * A child's own record: a minor, with the person writing as tutor, at the
 * clinic and with the practitioner of the visit being booked. No contact
 * number of their own -- the tutor's is what the clinic writes to
 * (appointmentNotifications.ts), and the same number on two records would
 * file the tutor's replies under the child.
 */
async function createChild(writer: Supa, ctx: BookingContext, tutorId: string, name: string, at: { practitionerId: string; clinicId: string }): Promise<string | null> {
  const [firstName, ...rest] = name.split(' ')
  const id = randomUUID()
  // Not read back in the same statement: RLS checks the returned row against
  // the SELECT policy, which cannot see a patient that does not exist yet
  // (leadConversion.ts says the same).
  const { error } = await writer.from('patients').insert({
    id,
    account_id: ctx.accountId,
    clinic_id: at.clinicId,
    first_name: firstName || name,
    last_name: rest.join(' ') || null,
    is_minor: true,
    tutor_patient_id: tutorId,
    default_practitioner_id: at.practitionerId,
  } as never)
  if (error) {
    console.error('[receptionist] could not make the child record:', error.message)
    return null
  }
  return id
}

/** Someone new the person writing brings, as they described them, checked. */
interface BroughtPerson {
  name: string
  firstName: string
  lastName: string
  /** Their mobile as WhatsApp digits, and as a patient contact number. */
  e164: string
  contact: { countryCode: string; number: string }
  /** What they are to the person writing, as patient_relations records it; null when not said, or a friend. */
  relation: FamilyRelation | null
}

/**
 * The person they bring, from what the model passed: a first name and a
 * surname, a mobile that is not the writer's own, and nobody the clinic may
 * already have under that number -- which is a person's call, as it is for
 * a lead (ensurePatient), and is never said out loud.
 */
async function readBroughtPerson(ctx: BookingContext, nameIn: unknown, phoneIn: unknown, relationIn: unknown): Promise<BroughtPerson | { error: string }> {
  const name = typeof nameIn === 'string' ? nameIn.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/g, ' ').trim().replace(/[.,;]+$/, '').slice(0, 120) : ''
  const [firstName, ...rest] = name.split(' ')
  if (!firstName || !rest.length) return { error: "Ask that person's surname(s) as well, then call again. Do not say it is booked." }
  const phone = typeof phoneIn === 'string' ? phoneIn.trim() : ''
  if (!phone) return { error: "Ask that person's own mobile number, then call again with it. Do not say it is booked." }
  const { data: account } = await ctx.service.from('accounts').select('default_phone_country').eq('id', ctx.accountId).maybeSingle()
  const country = (account as { default_phone_country: string | null } | null)?.default_phone_country ?? 'ES'
  const e164 = toE164Loose(phone, country)
  const contact = e164 ? leadPhoneAsContactNumber(e164, country) : null
  if (!e164 || !contact || e164.length < 8) return { error: `"${phone}" is not a mobile number. Ask for it again. Do not say it is booked.` }
  if (await isWritersOwnNumber(ctx, e164)) return { error: "That is the number of the person writing, not of the person they bring. Ask for that person's own mobile. Do not say it is booked." }
  if ((await findLikelyExistingPatients(ctx.service, ctx.accountId, e164, null)).length) {
    return { error: "That number is already on the clinic's records, so a colleague has to arrange this. Call hand_over_to_colleague with the person's name and the day and time accepted, and tell them your colleague will confirm it. Never say whether that person is a patient, and do not say it is booked." }
  }
  const relation = typeof relationIn === 'string' && (BROUGHT_RELATIONS as readonly string[]).includes(relationIn) && relationIn !== 'friend' ? (relationIn as FamilyRelation) : null
  return { name, firstName, lastName: rest.join(' '), e164, contact, relation }
}

async function isWritersOwnNumber(ctx: BookingContext, e164: string): Promise<boolean> {
  if (ctx.person.kind === 'lead') {
    const { data: lead } = await ctx.service.from('leads').select('phone').eq('id', ctx.person.leadId).maybeSingle()
    const phone = (lead as { phone: string | null } | null)?.phone
    if (phone && whatsappDigits(phone) === e164) return true
  }
  if (!ctx.person.patientId) return false
  const { data: numbers } = await ctx.service.from('patient_contact_numbers').select('number, country_code').eq('patient_id', ctx.person.patientId)
  return ((numbers ?? []) as { number: string; country_code: string }[]).some((n) => phoneMatches(n.number, n.country_code, e164))
}

/**
 * Their record: a new patient referred by the person writing (Origen:
 * Paciente, Referido por -- what the desk sets by hand), at the clinic and
 * with the practitioner of the visit, with their own number for WhatsApp.
 * The link is recorded whether or not the writer has been to the clinic; the
 * referral visit and its price are only for someone they bring once they
 * have (typesForSomeoneTheyBring). Linked as family both ways when they said
 * what that person is to them.
 */
async function createBroughtPerson(writer: Supa, ctx: BookingContext, writerId: string, person: BroughtPerson, at: { practitionerId: string | null; clinicId: string }): Promise<string | null> {
  const id = randomUUID()
  // Not read back in the same statement: see createChild.
  const { error } = await writer.from('patients').insert({
    id,
    account_id: ctx.accountId,
    clinic_id: at.clinicId,
    first_name: person.firstName,
    last_name: person.lastName,
    default_practitioner_id: at.practitionerId,
    referral_source: 'Patient',
    referred_by_patient_id: writerId,
  } as never)
  if (error) {
    console.error('[receptionist] could not make the record of the person they bring:', error.message)
    return null
  }
  const { error: numberError } = await writer.from('patient_contact_numbers').insert({ account_id: ctx.accountId, patient_id: id, country_code: person.contact.countryCode, number: person.contact.number, is_whatsapp: true } as never)
  if (numberError) console.error('[receptionist] could not save their number:', numberError.message)
  if (person.relation) {
    const { error: relError } = await writer.from('patient_relations').upsert(
      [
        { account_id: ctx.accountId, patient_id: writerId, related_patient_id: id, relation: person.relation },
        { account_id: ctx.accountId, patient_id: id, related_patient_id: writerId, relation: inverseRelation(person.relation) },
      ] as never,
      { onConflict: 'patient_id,related_patient_id', ignoreDuplicates: true },
    )
    if (relError) console.error('[receptionist] could not link them as family:', relError.message)
  }
  return id
}

/**
 * The one patient a referral names (matchReferrer), never the person writing
 * themselves, and only someone who has been to the clinic: a person whose
 * first visit was cancelled, or who never had one, refers nobody. Read from
 * the clinic's records by first name, whatever its accents; the answer is a
 * record or not, never a name for the model to say.
 */
async function findReferrer(ctx: BookingContext, name: string): Promise<{ id: string } | 'ambiguous' | 'need_surname' | null> {
  const first = name.split(' ')[0] ?? ''
  if (!first) return 'need_surname'
  const { data } = await ctx.service
    .from('patients')
    .select('id, first_name, last_name')
    .eq('account_id', ctx.accountId)
    .is('anonymized_at', null)
    .ilike('first_name', accentBlindPrefix(first))
    .limit(500)
  const people = ((data ?? []) as { id: string; first_name: string; last_name: string | null }[])
    .filter((p) => p.id !== ctx.person.patientId)
    .map((p) => ({ id: p.id, firstName: p.first_name, lastName: p.last_name }))
  // Everyone with that name first (few), then only those who have been.
  const named = people.filter((p) => matchReferrer([p], name) === p)
  if (!named.length) return matchReferrer(people, name) === 'need_surname' ? 'need_surname' : null
  const { data: done } = await ctx.service.from('appointments').select('patient_id').in('patient_id', named.map((p) => p.id)).eq('status', 'completed').is('deleted_at', null)
  const came = new Set(((done ?? []) as { patient_id: string }[]).map((a) => a.patient_id))
  const hit = matchReferrer(named.filter((p) => came.has(p.id)), name)
  return hit && typeof hit === 'object' ? { id: hit.id } : hit
}

/** Origen: Paciente, Referido por: that patient -- unless the record already names who referred them. */
async function recordReferral(writer: Supa, accountId: string, patientId: string, referrerId: string): Promise<void> {
  if (patientId === referrerId) return
  const { error } = await writer
    .from('patients')
    .update({ referral_source: 'Patient', referred_by_patient_id: referrerId } as never)
    .eq('id', patientId)
    .eq('account_id', accountId)
    .is('referred_by_patient_id', null)
  if (error) console.error('[receptionist] could not record the referral:', error.message)
}

/**
 * give_visit_to, once per reply: a first visit the person writing booked for
 * themselves, put in the name of someone new they bring -- "la cita es para
 * mi pareja". Same day, time and practitioner; that person gets a record of
 * their own, referred by the writer, and the confirmation on their own phone.
 * It becomes the first visit that person may have (typesForSomeoneTheyBring)
 * -- never the writer's ad offer -- when one has the same length; a longer
 * one would need the calendar checked again, which is a person's. Only a
 * first visit: a returning patient's visit is not someone else's first.
 */
export function giveVisitTool(ctx: BookingContext): (input: unknown) => Promise<ToolResult> {
  let used = false
  return async (input) => {
    if (used) return { content: 'You have already changed a visit in this reply. Tell them what was changed.', isError: true }
    if (!ctx.bringsSomeone) return { content: 'You cannot change whose visit it is here. Call hand_over_to_colleague saying whose it is, with their name and mobile.', isError: true }
    const value = (input ?? {}) as { visit_on?: unknown; person_name?: unknown; person_phone?: unknown; person_relation?: unknown }
    const wanted = typeof value.visit_on === 'string' ? value.visit_on.trim().replace('T', ' ') : ''
    const visit = ctx.booked.appointments.find((a) => localStamp(a.startsAt, ctx.timeZone) === wanted) ?? null
    const writerId = ctx.person.patientId
    if (!visit || !writerId) {
      const theirs = ctx.booked.appointments.map((a) => localStamp(a.startsAt, ctx.timeZone)).join(', ')
      return { content: `They have no booked visit at ${wanted || '(no visit_on given)'}. Their visits: ${theirs || 'none'}. Do not say anything is changed.`, isError: true }
    }
    if (new Date(visit.startsAt).getTime() <= Date.now()) return { content: 'That visit has already started. Call hand_over_to_colleague saying whose it is.', isError: true }
    const was = ctx.booked.types.find((t) => t.id === visit.typeId)
    if (!was || (was.stage !== 'first_visit' && was.stage !== 'first_visit_offer')) {
      return { content: 'Only a first visit can be put in someone new\'s name. Call hand_over_to_colleague saying whose it is, with their name and mobile; do not say it is changed.', isError: true }
    }
    const person = await readBroughtPerson(ctx, value.person_name, value.person_phone, value.person_relation)
    if ('error' in person) return { content: person.error.replace('Do not say it is booked.', 'Do not say it is changed.'), isError: true }

    const { data: row } = await ctx.service.from('appointments').select('clinic_id').eq('id', visit.id).maybeSingle()
    const clinicId = (row as { clinic_id: string | null } | null)?.clinic_id
    if (!clinicId) return { content: 'That visit could not be read. Call hand_over_to_colleague saying whose it is.', isError: true }

    const writer = receptionistServiceClient(ctx.event) as unknown as Supa
    used = true
    const personId = await createBroughtPerson(writer, ctx, writerId, person, { practitionerId: visit.practitionerId, clinicId })
    if (!personId) {
      used = false
      return { content: "That person's record could not be made. Call hand_over_to_colleague with their name and mobile; do not say it is changed.", isError: true }
    }
    // What that person may have, not what the writer had: the ad's offer is
    // for whoever answered the ad, so it does not pass to the person they
    // bring. The referral visit when the writer has been, else the plain
    // first visit -- one of the same length, or the visit stays as it is
    // and a person sorts the type (a longer one needs the calendar again).
    const theirs = ctx.bringsSomeone.types.find((t) => t.durationMinutes === was.durationMinutes) ?? null
    const type = theirs ?? was
    const { data: changed, error } = await writer
      .from('appointments')
      .update({ patient_id: personId, appointment_type_id: type.id } as never)
      .eq('id', visit.id)
      .eq('account_id', ctx.accountId)
      .eq('patient_id', writerId)
      .eq('status', 'booked')
      .is('deleted_at', null)
      .select('id')
    if (error || !changed?.length) {
      used = false
      await writer.from('patients').delete().eq('id', personId).eq('account_id', ctx.accountId)
      console.error('[receptionist] give_visit_to refused:', error?.message ?? 'no row changed')
      return { content: 'That visit could not be changed: a colleague may have changed it a moment ago. Call hand_over_to_colleague saying whose it is; do not say it is changed.', isError: true }
    }

    const format = (locale: string) => new Date(visit.startsAt).toLocaleString(locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: ctx.timeZone })
    console.info(`[receptionist] gave appointment ${visit.id} to a new patient (account ${ctx.accountId})`)
    // Best-effort, as after a booking: the visit is theirs either way.
    try {
      await ctx.onBooked(`He pasado su ${was.name} del ${format('es-ES')} a nombre de ${person.name} (ficha nueva, referida por quien escribe)${type.id !== was.id ? `, como ${type.name}` : ''}.`)
      await sendAppointmentConfirmation(ctx.service, ctx.accountId, visit.id)
    } catch (err) {
      console.error('[receptionist] after give_visit_to:', (err as Error)?.message ?? err)
    }
    return {
      content: [
        `Done: the visit on ${format('en-GB')} is now in ${person.firstName}'s name, referred by the person writing, with the same practitioner. ${person.firstName} gets the confirmation on their own phone. Tell them, with the day and time in words.`,
        type.id !== was.id ? `It is now a ${type.name}${typePrice(type) ? ` (${typePrice(type)})` : ''}, not a ${was.name}: what ${was.name} costs was for the person writing, not for ${person.firstName}. If they ask about the price, say so.` : '',
      ].filter(Boolean).join(' '),
      isError: false,
    }
  }
}

/** The clinic's address, when this patient has never been; null otherwise or when it has none. */
async function firstVisitAddress(service: Supa, patientId: string, clinicId: string): Promise<string | null> {
  const [{ count }, { data: clinic }] = await Promise.all([
    service.from('appointments').select('id', { count: 'exact', head: true }).eq('patient_id', patientId).eq('status', 'completed').is('deleted_at', null),
    service.from('clinics').select('address').eq('id', clinicId).maybeSingle(),
  ])
  if ((count ?? 0) > 0) return null
  const address = ((clinic as { address: string | null } | null)?.address ?? '').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim()
  return address || null
}

/**
 * add_to_waitlist for one person in one reply: the waiting list the front
 * desk already works from (pages/waitlist), with when they can come in its
 * notes. A lead is made a patient first, as booking does -- the list is of
 * patients. One entry per person: a second call updates it.
 */
export function waitlistTool(ctx: BookingContext): (input: unknown) => Promise<ToolResult> {
  let used = false
  return async (input) => {
    if (used) return { content: 'They are already on the waiting list from this reply.', isError: true }
    const value = (input ?? {}) as { appointment_type?: unknown; preference?: unknown; full_name?: unknown; email?: unknown }
    const preference = typeof value.preference === 'string' ? value.preference.replace(/\s+/g, ' ').trim().slice(0, 300) : ''
    if (!preference) return { content: 'Say when they can come (preference).', isError: true }
    const name = typeof value.appointment_type === 'string' ? value.appointment_type.trim().toLowerCase() : ''
    const type = ctx.types.find((t) => t.name.toLowerCase() === name) ?? (!name && ctx.types.length === 1 ? ctx.types[0] : undefined) ?? (!name ? ctx.booked.types[0] : undefined)
    if (!type) return { content: `Say which type, exactly as named: ${ctx.types.map((t) => t.name).join(', ')}.`, isError: true }

    const writer = receptionistServiceClient(ctx.event) as unknown as Supa
    const patient = await ensurePatient(ctx, writer, ctx.practitionerIds?.[0] ?? null, newPatientDetails(value.full_name, value.email))
    // ensurePatient's reasons are worded for a booking; the answer here is the same hand-over.
    if ('error' in patient) return { content: 'A colleague has to add them to the waiting list. Call hand_over_to_colleague saying when they can come.', isError: true }

    const { data: p } = await ctx.service.from('patients').select('clinic_id').eq('id', patient.patientId).maybeSingle()
    let clinicId = (p as { clinic_id: string | null } | null)?.clinic_id ?? null
    if (!clinicId) {
      const { data: clinics } = await ctx.service.from('clinics').select('id').eq('account_id', ctx.accountId).is('archived_at', null).order('created_at').limit(1)
      clinicId = ((clinics ?? []) as { id: string }[])[0]?.id ?? null
    }
    if (!clinicId) return { content: 'The waiting list is not available. Call hand_over_to_colleague saying when they can come.', isError: true }

    used = true
    const { data: existing } = await ctx.service.from('waitlist_entries').select('id').eq('account_id', ctx.accountId).eq('patient_id', patient.patientId).eq('status', 'waiting').limit(1)
    const entryId = ((existing ?? []) as { id: string }[])[0]?.id
    const { error } = entryId
      ? await writer.from('waitlist_entries').update({ notes: preference, appointment_type_id: type.id } as never).eq('id', entryId)
      : await writer.from('waitlist_entries').insert({
          account_id: ctx.accountId,
          clinic_id: clinicId,
          patient_id: patient.patientId,
          appointment_type_id: type.id,
          practitioner_id: ctx.practitionerIds?.[0] ?? null,
          status: 'waiting',
          source: 'receptionist',
          notes: preference,
        } as never)
    if (error) {
      used = false
      console.error('[receptionist] waitlist refused:', error.message)
      return { content: 'They could not be added to the waiting list. Call hand_over_to_colleague saying when they can come.', isError: true }
    }
    try {
      await ctx.onBooked(`He apuntado a la lista de espera para ${type.name}: ${preference}.`)
    } catch (err) {
      console.error('[receptionist] after waitlist:', (err as Error)?.message ?? err)
    }
    return { content: `On the waiting list for ${type.name} (${preference}). Tell them the clinic will let them know if a time that suits them frees up; do not promise one.`, isError: false }
  }
}

/**
 * cancel_appointment for one person in one reply: one of the visits the
 * prompt listed, named by when it is now (as a move names one), set to
 * cancelled. Only a visit still booked, and only when the row really changes
 * -- a colleague cancelling it a moment earlier must not run the clinic's
 * cancellation automations a second time (CancelStep.vue has the same
 * guard). A visit that has already started is not its to cancel either: the
 * prompt lists today's visits from midnight, so a patient writing at 18:00
 * about their 17:30 can name one, and what to do about a missed visit is a
 * person's call. What follows is what follows the reminder's "Cancelar"
 * button (afterUnattendedCancellation). Never a fee.
 */
export function cancelTool(ctx: BookingContext): (input: unknown) => Promise<ToolResult> {
  let used = false
  return async (input) => {
    if (used) return { content: 'You have already cancelled a visit in this reply. Tell them what was cancelled.', isError: true }
    const value = (input ?? {}) as { visit_on?: unknown }
    const wanted = typeof value.visit_on === 'string' ? value.visit_on.trim().replace('T', ' ') : ''
    const visit = ctx.booked.appointments.find((a) => localStamp(a.startsAt, ctx.timeZone) === wanted) ?? null
    const patientId = ctx.person.patientId
    if (!visit || !patientId) {
      const theirs = ctx.booked.appointments.map((a) => localStamp(a.startsAt, ctx.timeZone)).join(', ')
      return { content: `They have no booked visit at ${wanted || '(no visit_on given)'}. Their visits: ${theirs || 'none'}. Do not say anything is cancelled.`, isError: true }
    }
    if (new Date(visit.startsAt).getTime() <= Date.now()) {
      return { content: 'That visit has already started, so it is not yours to cancel. Call hand_over_to_colleague saying which visit they mean; do not say it is cancelled.', isError: true }
    }

    const writer = receptionistServiceClient(ctx.event) as unknown as Supa
    used = true
    const { data: changed, error } = await writer
      .from('appointments')
      .update({ status: 'cancelled' } as never)
      .eq('id', visit.id)
      .eq('account_id', ctx.accountId)
      .eq('status', 'booked')
      .is('deleted_at', null)
      .select('id')
    if (error || !changed?.length) {
      used = false
      console.error('[receptionist] cancellation refused:', error?.message ?? 'no row changed')
      return { content: 'That visit could not be cancelled: it may already have been cancelled or changed by a colleague. Do not say it is cancelled: call hand_over_to_colleague saying which visit they want cancelled.', isError: true }
    }

    const typeName = ctx.booked.types.find((t) => t.id === visit.typeId)?.name ?? null
    const format = (locale: string) => new Date(visit.startsAt).toLocaleString(locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: ctx.timeZone })
    console.info(`[receptionist] cancelled appointment ${visit.id} (account ${ctx.accountId})`)

    // Best-effort, as after a booking: the visit is cancelled either way.
    try {
      await ctx.onBooked(`He cancelado su ${typeName ?? 'cita'} del ${format('es-ES')}.`)
    } catch (err) {
      console.error('[receptionist] after cancelling:', (err as Error)?.message ?? err)
    }
    await afterUnattendedCancellation(ctx.service, getRequestURL(ctx.event).origin, ctx.accountId, visit.id, patientId)

    const remaining = ctx.booked.appointments
      .filter((a) => a.id !== visit.id)
      .map((a) => new Date(a.startsAt).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: ctx.timeZone }))
    return {
      content: [
        `Cancelled: ${typeName ?? 'their visit'}, ${format('en-GB')}. The time is free again. Tell them it is cancelled, with the day and time in words, and that they can write whenever they want another time.`,
        remaining.length ? `They still have ${remaining.length === 1 ? 'a visit' : 'visits'} on ${remaining.join(' and ')}, which ${remaining.length === 1 ? 'stands' : 'stand'}.` : '',
      ].filter(Boolean).join(' '),
      isError: false,
    }
  }
}

/** "YYYY-MM-DD HH:MM" on the clinic's clock. */
function localStamp(iso: string, timeZone: string): string {
  const at = new Date(iso)
  const hm = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone })
  return `${clinicDateOf(at, timeZone)} ${hm}`
}

async function candidatePractitioners(ctx: BookingContext, moving: BookedAppointment | null, own: string[] | null = ctx.practitionerIds): Promise<string[]> {
  const preferred = [moving?.practitionerId, ...(own ?? [])].filter((id): id is string => Boolean(id))
  if (own) return [...new Set(preferred)]
  const { data } = await ctx.service
    .from('team_members')
    .select('id')
    .eq('account_id', ctx.accountId)
    .eq('is_practitioner', true)
    .eq('online_booking_enabled', true)
    .is('deleted_at', null)
    .order('created_at')
  return [...new Set([...preferred, ...((data ?? []) as { id: string }[]).map((m) => m.id)])]
}

/** The patient the visit is for; a lead is converted first, with the name and email they gave. */
async function ensurePatient(
  ctx: BookingContext,
  writer: Supa,
  practitionerId: string | null,
  given: { fullName: string | null; email: string | null },
): Promise<{ patientId: string } | { error: string }> {
  let patientId: string | null = ctx.person.patientId
  if (!patientId && ctx.person.kind === 'lead') {
    const { data: lead } = await ctx.service
      .from('leads')
      .select('id, clinic_id, full_name, phone, email, source, patient_id')
      .eq('id', ctx.person.leadId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    const found = lead as { id: string; clinic_id: string | null; full_name: string; phone: string | null; email: string | null; source: string | null; patient_id: string | null } | null
    if (!found) return { error: 'This enquiry could not be found. Call hand_over_to_colleague.' }
    // What they told us in the conversation wins over the WhatsApp profile name.
    const l = { ...found, full_name: given.fullName ?? found.full_name, email: given.email ?? found.email }
    patientId = l.patient_id
    if (!patientId) {
      // Maybe already a patient: a person decides which record, never a guess.
      const likely = await findLikelyExistingPatients(ctx.service, ctx.accountId, l.phone, l.email)
      if (likely.length) {
        return { error: 'They may already be a patient here, so a colleague has to book this. Call hand_over_to_colleague saying the day, time and type they accepted; do not say it is booked.' }
      }
      const { data: account } = await ctx.service.from('accounts').select('default_phone_country').eq('id', ctx.accountId).maybeSingle()
      const created = await createPatientFromLead(writer, ctx.accountId, l, {
        defaultPractitionerId: practitionerId,
        defaultCountry: (account as { default_phone_country: string | null } | null)?.default_phone_country ?? 'ES',
      })
      // The lead keeps the same name and email the patient record got.
      if (given.fullName || given.email) {
        await writer.from('leads').update({ ...(given.fullName ? { full_name: given.fullName } : {}), ...(given.email ? { email: given.email } : {}) } as never).eq('id', l.id).eq('account_id', ctx.accountId)
      }
      const claim = await claimConvertedLead(writer, ctx.accountId, l.id, created, { linked: false, source: l.source })
      patientId = claim.patientId
      if (claim.claimed) await automationEvent(ctx.service as any, ctx.accountId, { leadId: l.id }, 'lead.converted', getRequestURL(ctx.event).origin)
    }
  }
  if (!patientId) return { error: 'There is no patient to book for. Call hand_over_to_colleague.' }
  const { data: patient } = await ctx.service.from('patients').select('do_not_contact, is_minor').eq('id', patientId).maybeSingle()
  const p = patient as { do_not_contact: boolean | null; is_minor: boolean | null } | null
  if (!p) return { error: 'The patient could not be found. Call hand_over_to_colleague.' }
  if (p.do_not_contact || p.is_minor) {
    return { error: 'This patient has to be booked by a colleague. Call hand_over_to_colleague saying the day, time and type they accepted; do not say it is booked.' }
  }
  return { patientId }
}

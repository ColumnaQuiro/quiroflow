import type Anthropic from '@anthropic-ai/sdk'
import type { H3Event } from 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { randomUUID } from 'node:crypto'
import { loadReceptionistCalendar, type BookedAppointment, type OfferedType, type ReceptionistConfig, type TutorChild } from '~/server/utils/receptionist'
import { claimConvertedLead, createPatientFromLead, findLikelyExistingPatients } from '~/server/utils/leadConversion'
import { resolveWindow, saveAppointmentIfFree } from '~/server/utils/publicApiAppointments'
import { automationEvent } from '~/server/utils/automationEngine'
import { afterUnattendedCancellation } from '~/server/utils/unattendedCancellation'
import { pushAppointmentEvent } from '~/server/utils/staffPush'
import { claimAutomaticConfirmation, sendAppointmentConfirmation } from '~/server/utils/appointmentNotifications'
import { receptionistServiceClient } from '~/server/utils/receptionistAudit'
import { clinicDateOf, startOfLocalDate, wallClockToUtc } from '~/utils/clinicClock'
import { MINOR_AGE, matchChild, newPatientDetails } from '~/utils/receptionistTypes'

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
    },
    required: ['date', 'time'],
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
}

type ToolResult = { content: string; isError: boolean }

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** book_appointment for one person in one reply. */
export function bookingTool(ctx: BookingContext): (input: unknown) => Promise<ToolResult> {
  let used = false
  return async (input) => {
    if (used) return { content: 'You have already booked or moved a visit in this reply. Do not book again: tell them what was booked.', isError: true }
    const value = (input ?? {}) as { appointment_type?: unknown; date?: unknown; time?: unknown; move_visit_on?: unknown; full_name?: unknown; email?: unknown; child_name?: unknown; child_age?: unknown }
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
      if (age >= MINOR_AGE) return { content: `At ${age} they are an adult and book their own appointment. Ask them to write to the clinic themselves; do not book it.`, isError: true }
      const existing = matchChild(ctx.minors.children, childName)
      if (existing === 'ambiguous') return { content: 'More than one of their children on file has that name. Ask the child\'s surname and book with the full name; if they already gave it, call hand_over_to_colleague.', isError: true }
      child = { existing, name: childName }
    }

    // What is being booked: a move keeps the visit's type and is found by
    // when it is now; a new booking is one of the types this person may have
    // -- or, for their child, one the child may have.
    let moving: BookedAppointment | null = null
    let type: OfferedType | undefined
    if (child) {
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
      const name = typeof value.appointment_type === 'string' ? value.appointment_type.trim().toLowerCase() : ''
      type = ctx.types.find((t) => t.name.toLowerCase() === name) ?? (!name && ctx.types.length === 1 ? ctx.types[0] : undefined)
      if (!type) {
        return { content: `Say which type, exactly as named: ${ctx.types.map((t) => t.name).join(', ') || 'none can be booked by you; call hand_over_to_colleague'}.`, isError: true }
      }
    }

    // Free now, and with whom: the visit's own practitioner first for a move,
    // then the patient's own, then anyone the list was built from.
    const dayStart = startOfLocalDate(date, ctx.timeZone)
    let chosen: { practitionerId: string; clinicId: string } | null = null
    for (const practitionerId of await candidatePractitioners(ctx, moving)) {
      const calendar = await loadReceptionistCalendar(ctx.service, ctx.accountId, ctx.config, [type], new Date(), { from: dayStart, days: 1, maxTimesPerList: 1000 }, [practitionerId])
      const group = calendar.availability?.groups.find((g) => g.days.some((d) => d.date === date && d.times.includes(time)))
      if (group) {
        chosen = { practitionerId, clinicId: group.clinicId }
        break
      }
    }
    if (!chosen) {
      const day = await loadReceptionistCalendar(ctx.service, ctx.accountId, ctx.config, [type], new Date(), { from: dayStart, days: 1 }, ctx.practitionerIds)
      const free = [...new Set(day.availability?.groups.flatMap((g) => g.days.filter((d) => d.date === date).flatMap((d) => d.times)) ?? [])].sort()
      return {
        content: `${time} on ${date} is not free for ${type.name}. ${free.length ? `Free that day: ${free.join(', ')}.` : 'Nothing is free that day.'} Offer one of those or another day; do not say it is booked.`,
        isError: true,
      }
    }

    const writer = receptionistServiceClient(ctx.event) as unknown as Supa

    // The patient: a lead becomes one first, as the Convert button does it.
    // For a child, that person is the tutor and the child is the patient.
    const tutor = await ensurePatient(ctx, writer, chosen.practitionerId, newPatientDetails(value.full_name, value.email))
    if ('error' in tutor) return { content: tutor.error, isError: true }
    let patient = tutor
    if (child) {
      const childId = child.existing?.id ?? await createChild(writer, ctx, tutor.patientId, child.name, chosen)
      if (!childId) return { content: "The child's record could not be made. Call hand_over_to_colleague saying who it is for and the day and time they accepted; do not say it is booked.", isError: true }
      patient = { patientId: childId }
    }

    const { data: practitioner } = await ctx.service.from('team_members').select('full_name').eq('id', chosen.practitionerId).maybeSingle()
    const practitionerName = (practitioner as { full_name: string | null } | null)?.full_name ?? null
    const window = await resolveWindow(ctx.service, ctx.accountId, { startsAt: start.toISOString(), appointmentTypeId: type.id, practitionerId: chosen.practitionerId })

    used = true
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
      used = false
      console.error('[receptionist] booking refused:', (err as Error)?.message ?? err)
      return { content: `${time} on ${date} was taken a moment ago. Offer another free time; do not say it is booked.`, isError: true }
    }

    const when = new Date(window.startsAt).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: ctx.timeZone })
    const was = moving ? new Date(moving.startsAt).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: ctx.timeZone }) : null
    const forChild = child ? ` para ${child.existing ? [child.existing.firstName, child.existing.lastName].filter(Boolean).join(' ') : child.name}${child.existing ? '' : ' (ficha nueva, menor, con quien escribe como tutor)'}` : ''
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
      .filter((a) => !child && a.id !== moving?.id && Math.abs(new Date(a.startsAt).getTime() - start.getTime()) < 2 * DAY_MS)
      .map((a) => new Date(a.startsAt).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: ctx.timeZone }))
    // Someone coming for the first time is told where to go.
    const address = moving ? null : await firstVisitAddress(ctx.service, patient.patientId, chosen.clinicId)
    return {
      content: [
        `${moving ? 'Moved' : 'Booked'}: ${type.name}${child ? ` for ${child.name}, in the child's name with them as tutor` : ''}, ${whenEn}${practitionerName ? `, with ${practitionerName}` : ''}. ${moving ? 'Their old time is free again.' : `They will also get the clinic's usual confirmation${child ? ', as the tutor' : ''}.`} Tell them, with the day and time in words.`,
        near.length ? `They also have ${near.length === 1 ? 'a visit' : 'visits'} on ${near.join(' and ')}: mention ${near.length === 1 ? 'it' : 'them'}, and ask whether they want to keep ${near.length === 1 ? 'it' : 'them'}.` : '',
        address ? `It is their first visit: give them the clinic's address, ${address}.` : '',
      ].filter(Boolean).join(' '),
      isError: false,
    }
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

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

async function candidatePractitioners(ctx: BookingContext, moving: BookedAppointment | null): Promise<string[]> {
  const preferred = [moving?.practitionerId, ...(ctx.practitionerIds ?? [])].filter((id): id is string => Boolean(id))
  if (ctx.practitionerIds) return [...new Set(preferred)]
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

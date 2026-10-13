import type Anthropic from '@anthropic-ai/sdk'
import type { H3Event } from 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { loadReceptionistCalendar, type BookedAppointment, type OfferedType, type ReceptionistConfig } from '~/server/utils/receptionist'
import { claimConvertedLead, createPatientFromLead, findLikelyExistingPatients } from '~/server/utils/leadConversion'
import { resolveWindow, saveAppointmentIfFree } from '~/server/utils/publicApiAppointments'
import { automationEvent } from '~/server/utils/automationEngine'
import { pushAppointmentEvent } from '~/server/utils/staffPush'
import { claimAutomaticConfirmation, sendAppointmentConfirmation } from '~/server/utils/appointmentNotifications'
import { receptionistServiceClient } from '~/server/utils/receptionistAudit'
import { clinicDateOf, startOfLocalDate, wallClockToUtc } from '~/utils/clinicClock'
import { newPatientDetails } from '~/utils/receptionistTypes'

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
}

type ToolResult = { content: string; isError: boolean }

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** book_appointment for one person in one reply. */
export function bookingTool(ctx: BookingContext): (input: unknown) => Promise<ToolResult> {
  let used = false
  return async (input) => {
    if (used) return { content: 'You have already booked or moved a visit in this reply. Do not book again: tell them what was booked.', isError: true }
    const value = (input ?? {}) as { appointment_type?: unknown; date?: unknown; time?: unknown; move_visit_on?: unknown; full_name?: unknown; email?: unknown }
    const date = typeof value.date === 'string' ? value.date.trim() : ''
    const time = typeof value.time === 'string' ? value.time.trim() : ''
    if (!DAY.test(date) || !HH_MM.test(time)) return { content: 'date must be YYYY-MM-DD and time HH:MM, exactly as listed.', isError: true }

    const start = new Date(wallClockToUtc(date, time, ctx.timeZone))
    if (Number.isNaN(start.getTime()) || start.getTime() <= Date.now()) return { content: 'That time has already passed. Offer another.', isError: true }

    // What is being booked: a move keeps the visit's type and is found by
    // when it is now; a new booking is one of the types this person may have.
    let moving: BookedAppointment | null = null
    let type: OfferedType | undefined
    if (typeof value.move_visit_on === 'string' && value.move_visit_on.trim()) {
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
    const patient = await ensurePatient(ctx, writer, chosen.practitionerId, newPatientDetails(value.full_name, value.email))
    if ('error' in patient) return { content: patient.error, isError: true }

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
    const summary = moving
      ? `He movido su ${type.name} del ${was} al ${when}${practitionerName ? ` con ${practitionerName}` : ''}.`
      : `He reservado ${type.name} el ${when}${practitionerName ? ` con ${practitionerName}` : ''}.`
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
    const near = ctx.booked.appointments
      .filter((a) => a.id !== moving?.id && Math.abs(new Date(a.startsAt).getTime() - start.getTime()) < 2 * DAY_MS)
      .map((a) => new Date(a.startsAt).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: ctx.timeZone }))
    // Someone coming for the first time is told where to go.
    const address = moving ? null : await firstVisitAddress(ctx.service, patient.patientId, chosen.clinicId)
    return {
      content: [
        `${moving ? 'Moved' : 'Booked'}: ${type.name}, ${whenEn}${practitionerName ? `, with ${practitionerName}` : ''}. ${moving ? 'Their old time is free again.' : "They will also get the clinic's usual confirmation."} Tell them, with the day and time in words.`,
        near.length ? `They also have ${near.length === 1 ? 'a visit' : 'visits'} on ${near.join(' and ')}: mention ${near.length === 1 ? 'it' : 'them'}, and ask whether they want to keep ${near.length === 1 ? 'it' : 'them'}.` : '',
        address ? `It is their first visit: give them the clinic's address, ${address}.` : '',
      ].filter(Boolean).join(' '),
      isError: false,
    }
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

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

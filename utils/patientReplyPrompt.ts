import { formatEur } from './billing'
import { DEFAULT_CLINIC_TIMEZONE } from './clinicClock'
import { CONFIDENTIALITY_SECTION, promptSafeName } from './receptionistGuard'
import { NO_REPLY } from './receptionistAutoReply'
import { CONFIRM_BEFORE_BOOKING, familySection, minorsSection, offeredTypesSection, rescheduleSection, type BookedVisit, type PromptChild, type PromptRelative, type PromptType } from './receptionistTypes'
import { receptionistBookingSection, receptionistClockSection, type ReceptionistAvailability } from './receptionistSlots'
import { CARD_ANSWERS_LINE, historyMarkersSection, INFORMAL_ADDRESS_LINE, LATER_ANSWER_LINE, NO_INVENTION_LINE, NOT_CHIROPRACTIC_SYMPTOM_LINE, PART_OF_DAY_ANSWER_LINE, replyLanguageLine, SENT_FILES_LINE, STATED_LIMITS_LINE, WAITLIST_SECTION } from './receptionistHistory'
import type { ReceptionistPrompt } from './receptionistPrompt'

// What the receptionist knows about a patient when drafting a reply to them
// in the Inbox: their next visits, their care plan, what they owe. Read at
// the moment of drafting, by whoever asked for it -- so a member whose role
// cannot see money gets a draft that does not mention it either.
//
// The prompt is built here too (buildPatientReplyPrompt), out of the server
// code, so the wording the model is given can be pinned by a unit test.
export interface PatientReplyFacts {
  firstName: string | null
  upcoming: { startsAt: string; typeName: string | null; practitionerName: string | null }[]
  lastVisitAt: string | null
  /** The type of that visit, which is what "otra cita" usually means. */
  lastVisitType?: string | null
  plan: { name: string; totalVisits: number; done: number; cadence: string } | null
  /**
   * An open package (bono) with sessions still to use. Counted in sessions,
   * not money, so a stored draft may mention it.
   */
  bono?: { name: string; sessionsLeft: number } | null
  /** Null when the asker cannot see money, or it could not be read. */
  outstandingCents: number | null
}

function when(iso: string, timeZone: string) {
  return new Date(iso).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone })
}

export function patientFactsSection(f: PatientReplyFacts, timeZone: string | null | undefined): string {
  const zone = timeZone || DEFAULT_CLINIC_TIMEZONE
  const lines: string[] = []
  // A name the patient may have typed themselves: flattened, so it cannot
  // start a section of the prompt.
  const name = promptSafeName(f.firstName)
  if (name) lines.push(`- Name: ${name}`)
  if (f.upcoming.length === 0) lines.push('- Next visit: nothing booked.')
  else {
    for (const [i, v] of f.upcoming.entries()) {
      const what = [v.typeName, v.practitionerName ? `with ${v.practitionerName}` : null].filter(Boolean).join(' ')
      lines.push(`- ${i === 0 ? 'Next visit' : 'Then'}: ${when(v.startsAt, zone)}${what ? ` (${what})` : ''}`)
    }
  }
  if (f.lastVisitAt) lines.push(`- Last visit: ${new Date(f.lastVisitAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: zone })}${f.lastVisitType ? ` (${f.lastVisitType})` : ''}`)
  if (f.plan) {
    const left = Math.max(0, f.plan.totalVisits - f.plan.done)
    lines.push(`- Care plan "${f.plan.name}": ${f.plan.done} of ${f.plan.totalVisits} visits done, ${left} left${f.plan.cadence ? `, ${f.plan.cadence}` : ''}.`)
  }
  if (f.bono && f.bono.sessionsLeft > 0) {
    lines.push(`- Package "${promptSafeName(f.bono.name) ?? 'bono'}": ${f.bono.sessionsLeft} session${f.bono.sessionsLeft === 1 ? '' : 's'} left to use.`)
  }
  if (f.outstandingCents !== null) {
    lines.push(f.outstandingCents > 0 ? `- Unpaid: ${formatEur(f.outstandingCents)}.` : '- Unpaid: nothing.')
  }
  return `# What you already know about this patient\nFrom the clinic's records, as of now. Use it to answer; never contradict it, and never mention anything about them that is not here or in the conversation.\n\n${lines.join('\n')}`
}

/** The open package with the most sessions left, or null when none has any. */
export function openBono(rows: { package_name: string | null; sessions_total: number | null; sessions_used: number | null }[] | null): { name: string; sessionsLeft: number } | null {
  let best: { name: string; sessionsLeft: number } | null = null
  for (const row of rows ?? []) {
    const sessionsLeft = (row.sessions_total ?? 0) - (row.sessions_used ?? 0)
    if (sessionsLeft > 0 && (!best || sessionsLeft > best.sessionsLeft)) best = { name: row.package_name ?? 'Bono', sessionsLeft }
  }
  return best
}

/**
 * What someone who has been before is NOT offered. The clinic's knowledge
 * cards are written for people asking about a first visit, so without this a
 * patient last seen in 2024 asking a price was quoted "primera visita a 70 €",
 * and one with six sessions left on a bono, answering a recall message about
 * a reactivation visit, was offered the reactivation. Empty for a patient
 * record with no visit yet (a first visit booked from an ad, say): the first
 * visit and its price are still theirs.
 */
export function returningPatientSection(f: PatientReplyFacts, opts: { reactivationType?: string | null; now?: Date } = {}): string {
  const left = f.bono?.sessionsLeft ?? 0
  if (!f.lastVisitAt && left <= 0) return ''
  const lines = [
    `# They have been to the clinic before
This person is a returning patient, not someone new. Never offer them a first visit, never quote the first-visit price or the first-visit offer, and never treat a price question as one about a first visit: answer it with the session and package prices from the clinic knowledge.`,
  ]
  if (left > 0) {
    lines.push(`They still have ${left} session${left === 1 ? '' : 's'} left on their package. A visit they book now uses one of them: offer their usual session (the type of their last visit, normally an adjustment), not a reactivation or report visit -- even if an earlier message in the conversation suggested one -- and do not quote a price for it. Offer times for it yourself rather than handing over; only hand over if they want to stop, pause or change the package.`)
  } else if (opts.reactivationType && f.lastVisitAt && lapsed(f.lastVisitAt, opts.now ?? new Date())) {
    // Back after a long break with nothing left to use: the clinic's own
    // visit for that, not the type of a visit a year ago (a report, say).
    lines.push(`Their last visit was more than ${LAPSED_MONTHS} months ago and they have no package to use. If they want an appointment, offer "${opts.reactivationType}" -- not the type of their last visit, and not a report visit.`)
  }
  return lines.join('\n\n')
}

/** Months without a visit after which someone is back "after a long break" -- the reactivation recall's own six. */
export const LAPSED_MONTHS = 6

function lapsed(lastVisitAt: string, now: Date): boolean {
  const since = new Date(now)
  since.setMonth(since.getMonth() - LAPSED_MONTHS)
  return new Date(lastVisitAt).getTime() < since.getTime()
}

/** What of the receptionist's settings the prompt reads; the tone already as its instruction. */
export interface PatientPromptConfig {
  personaName: string
  toneLine: string
  languages: string[]
  knowledge: { title: string; lines: string[] }[]
  escalationRules: { rule: string; action: string }[]
  neverSays: string
  slotsPerReply: number
  bookingWindowDays: number
}

/** The whole system prompt, given everything read. */
export function buildPatientReplyPrompt(
  config: PatientPromptConfig,
  opts: {
    facts: PatientReplyFacts
    /** Already narrowed to a returning patient (typesForAudience 'existing'). */
    offeredTypes: PromptType[]
    calendar: { now: Date; timeZone: string; availability: ReceptionistAvailability | null; withWhom?: string[] | null }
    /** Whether the find_free_times tool is on this request. */
    searchTool?: boolean
    /** Their booked visits, whose types they can be offered new times for. */
    bookedVisits?: BookedVisit[]
    /** Sent without a person reading it first; see buildSystemPrompt's sendsItself. */
    sendsItself?: boolean
    /** Booking for a child of the person writing (minorsSection); absent, nothing is said about it. */
    minors?: { forNewChild: PromptType[]; forReturningChild: PromptType[]; children: PromptChild[] }
    /** book_appointment is on this request -- only ever with sendsItself. */
    canBook?: boolean
    /** add_to_waitlist is on this request -- only ever with sendsItself. */
    canWaitlist?: boolean
    /** Booking for an adult in their family (familySection); absent, nothing is said about it. */
    family?: { forNew: PromptType[]; forReturning: PromptType[]; members: PromptRelative[] }
    /** The type offered to someone back after a long break (receptionist_config.reactivation_appointment_type_id), when it is on offeredTypes. */
    reactivationType?: string | null
  },
): ReceptionistPrompt {
  const knowledge = config.knowledge
    .map((card) => `## ${card.title}\n${card.lines.map((line) => `- ${line}`).join('\n')}`)
    .join('\n\n')
  const escalations = config.escalationRules.map((rule) => `- ${rule.rule} -> ${rule.action}`).join('\n')
  const booked = opts.bookedVisits ?? []
  const hasTimes = opts.offeredTypes.length > 0 || booked.length > 0
  const availability = hasTimes ? opts.calendar.availability : null
  // Clinic first, this patient and this moment after it: see
  // utils/receptionistPrompt.ts, and buildSystemPrompt, which is split the same way.
  const clinic = [
    `You are ${config.personaName}, the receptionist for a chiropractic clinic. You are replying to one of the clinic's own patients, who has written to the clinic.`,
    `Tone: ${config.toneLine}`,
    `Sound like an experienced clinic receptionist who knows this patient: neutral, professional, to the point. Do not open with an exclamation or filler ("¡Perfecto!", "¡Genial!", "¡Claro!", "¡Por supuesto!", "Great!"), do not use emojis -- not even to answer one of theirs -- and do not greet with an exclamation ("¡Hola, María!", "¡Buenas tardes!"). Start with the substance.`,
    `When something goes to a member of staff, speak of them as your own colleague: in Spanish "mi compañera" or "mi compañero" (for example "Se lo paso a mi compañera, la quiropráctica"), in English "my colleague". Never "un compañero", "un miembro del equipo" or "a colleague".`,
    `Write dates in words, in the patient's language, with the weekday: "el lunes 20 de octubre", "Monday 20 October". Never "20/10" or "2026-10-20".`,
    replyLanguageLine(config.languages),
    knowledge ? `# What you know about this clinic\n\n${knowledge}` : '',
    // Not every message wants an answer: a "Confirmar" tapped on the reminder,
    // a thanks. A re-confirmation nobody asked for is noise in their WhatsApp.
    `If their latest message needs no answer at all -- a thank-you, an "ok", a confirmation of a visit they already have, an emoji -- write exactly ${NO_REPLY} and nothing else. Nothing is then sent.`,
    `Read the whole conversation before replying. Answer what they asked, using what you know about them -- "your next visit is on Tuesday at 10:00" rather than asking them when it is. If you do not know something, say your colleague will check rather than guessing.`,
    historyMarkersSection(Boolean(opts.sendsItself)),
    INFORMAL_ADDRESS_LINE,
    NO_INVENTION_LINE,
    PART_OF_DAY_ANSWER_LINE,
    SENT_FILES_LINE,
    LATER_ANSWER_LINE,
    STATED_LIMITS_LINE,
    CARD_ANSWERS_LINE,
    NOT_CHIROPRACTIC_SYMPTOM_LINE,
    // A patient's details are on their record; asking for them again reads as
    // the clinic not knowing who they are.
    `Never ask a patient for their name, email or phone number: the clinic has them.`,
    // Clinical questions go to the practitioner, not to the front desk's draft.
    `Never give clinical or medical advice, and never comment on their symptoms, treatment or progress beyond the visit counts under "What you already know about this patient": say their practitioner will answer that.`,
    escalations ? `# Stop and hand over to a person when\n\n${escalations}\n\nWhen one of these applies, ${opts.sendsItself ? 'call hand_over_to_colleague, then ' : ''}say your colleague will pick this up shortly and stop.` : '',
    config.neverSays ? `# Never\n\n${config.neverSays}` : '',
    opts.sendsItself
      ? `# This reply is sent as it is\nIt goes straight to them: nobody at the clinic reads it first. Write the message itself and nothing else -- no preamble, no options to choose between, no notes to anyone. Whenever a rule under "Stop and hand over to a person when" applies, they want something you cannot do, or you are not sure what to answer, call hand_over_to_colleague with the reason before you reply. ${opts.canBook ? `${CONFIRM_BEFORE_BOOKING} Then call book_appointment with it (to move a visit they already have, with move_visit_on); only once it confirms, tell them it is booked, with the day, time and who with. If it refuses, offer another free time or call hand_over_to_colleague. To cancel a visit they already have, call cancel_appointment with visit_on.` : 'When they accept a time, call hand_over_to_colleague saying exactly what to book or move (type, day, time and who with): a colleague books it, and you tell them they will get a confirmation.'}`
      : `# This reply is a draft\nA member of staff will read what you write before it is sent, and may edit it. Write the message itself and nothing else -- no preamble, no options to choose between, no notes to the reader.`,
  ]

  const conversation = [
    receptionistClockSection(opts.calendar.now, opts.calendar.timeZone),
    patientFactsSection(opts.facts, opts.calendar.timeZone),
    offeredTypesSection(opts.offeredTypes),
    opts.minors ? minorsSection({ ...opts.minors, canBook: !!opts.canBook, sendsItself: !!opts.sendsItself }) : '',
    opts.family ? familySection({ ...opts.family, canBook: !!opts.canBook, sendsItself: !!opts.sendsItself }) : '',
    // A returning patient asking for "otra cita" means another of what they
    // have been having -- their adjustment, their maintenance visit -- and
    // the clinic's own knowledge says when that changes.
    opts.offeredTypes.length
      ? `If they want another visit and do not say which, offer the same type as their last visit when it is on that list. If it is not, or you cannot tell which they need, say your colleague will arrange the right one.`
      : '',
    returningPatientSection(opts.facts, { reactivationType: opts.reactivationType, now: opts.calendar.now }),
    // Listed under "What you already know", so not again here.
    rescheduleSection(booked, opts.calendar.timeZone || DEFAULT_CLINIC_TIMEZONE, { listVisits: false, canBook: opts.canBook }),
    hasTimes
      ? receptionistBookingSection({ availability, slotsPerReply: config.slotsPerReply, bookingWindowDays: config.bookingWindowDays, searchTool: opts.searchTool && Boolean(availability), withWhom: opts.calendar.withWhom })
      : '',
    opts.canBook
      ? `Never say a visit is booked or moved unless book_appointment has just confirmed it in this reply, never that one is cancelled unless cancel_appointment has, and never that a payment was received or a refund made.`
      : `You must NEVER state that a visit is booked, moved, cancelled or confirmed, or that a payment was received or a refund made. A member of staff does those. If they ask to book or move a visit, offer times and say you are passing it on, and that they will get a confirmation; if they ask to cancel, say your colleague will take care of it.`,
    `Only mention an amount owed if they ask about money or payment, and then only exactly as given above.`,
    opts.canWaitlist ? WAITLIST_SECTION : '',
    // Last, so nothing above can be read as overriding it.
    CONFIDENTIALITY_SECTION,
  ]

  return { clinic: clinic.filter(Boolean).join('\n\n'), conversation: conversation.filter(Boolean).join('\n\n') }
}

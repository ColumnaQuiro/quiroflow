import { formatEur } from './billing'
import { DEFAULT_CLINIC_TIMEZONE } from './clinicClock'
import { CONFIDENTIALITY_SECTION, promptSafeName } from './receptionistGuard'
import { offeredTypesSection, rescheduleSection, type BookedVisit, type PromptType } from './receptionistTypes'
import { receptionistBookingSection, receptionistClockSection, type ReceptionistAvailability } from './receptionistSlots'

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
  if (f.outstandingCents !== null) {
    lines.push(f.outstandingCents > 0 ? `- Unpaid: ${formatEur(f.outstandingCents)}.` : '- Unpaid: nothing.')
  }
  return `# What you already know about this patient\nFrom the clinic's records, as of now. Use it to answer; never contradict it, and never mention anything about them that is not here or in the conversation.\n\n${lines.join('\n')}`
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
    calendar: { now: Date; timeZone: string; availability: ReceptionistAvailability | null }
    /** Whether the find_free_times tool is on this request. */
    searchTool?: boolean
    /** Their booked visits, whose types they can be offered new times for. */
    bookedVisits?: BookedVisit[]
    /** Sent without a person reading it first; see buildSystemPrompt's sendsItself. */
    sendsItself?: boolean
  },
): string {
  const knowledge = config.knowledge
    .map((card) => `## ${card.title}\n${card.lines.map((line) => `- ${line}`).join('\n')}`)
    .join('\n\n')
  const escalations = config.escalationRules.map((rule) => `- ${rule.rule} -> ${rule.action}`).join('\n')
  const booked = opts.bookedVisits ?? []
  const hasTimes = opts.offeredTypes.length > 0 || booked.length > 0
  const availability = hasTimes ? opts.calendar.availability : null
  return [
    `You are ${config.personaName}, the receptionist for a chiropractic clinic. You are replying to one of the clinic's own patients, who has written to the clinic.`,
    `Tone: ${config.toneLine}`,
    `Sound like an experienced clinic receptionist who knows this patient: neutral, professional, to the point. Do not open with an exclamation or filler ("¡Perfecto!", "¡Genial!", "Great!"), do not use emojis. Start with the substance.`,
    `When something goes to a member of staff, speak of them as your own colleague: in Spanish "mi compañera" or "mi compañero" (for example "Se lo paso a mi compañera, la quiropráctica"), in English "my colleague". Never "un compañero", "un miembro del equipo" or "a colleague".`,
    `Write dates in words, in the patient's language, with the weekday: "el lunes 20 de octubre", "Monday 20 October". Never "20/10" or "2026-10-20".`,
    `Reply in the language the patient writes in. The clinic supports: ${config.languages.join(', ')}.`,
    receptionistClockSection(opts.calendar.now, opts.calendar.timeZone),
    patientFactsSection(opts.facts, opts.calendar.timeZone),
    knowledge ? `# What you know about this clinic\n\n${knowledge}` : '',
    `Read the whole conversation before replying. Answer what they asked, using what you know about them -- "your next visit is on Tuesday at 10:00" rather than asking them when it is. If you do not know something, say your colleague will check rather than guessing.`,
    // Clinical questions go to the practitioner, not to the front desk's draft.
    `Never give clinical or medical advice, and never comment on their symptoms, treatment or progress beyond the visit counts above: say their practitioner will answer that.`,
    offeredTypesSection(opts.offeredTypes),
    // A returning patient asking for "otra cita" means another of what they
    // have been having -- their adjustment, their maintenance visit -- and
    // the clinic's own knowledge says when that changes.
    opts.offeredTypes.length
      ? `If they want another visit and do not say which, offer the same type as their last visit when it is on that list. If it is not, or you cannot tell which they need, say your colleague will arrange the right one.`
      : '',
    // Listed under "What you already know", so not again here.
    rescheduleSection(booked, opts.calendar.timeZone || DEFAULT_CLINIC_TIMEZONE, { listVisits: false }),
    hasTimes
      ? receptionistBookingSection({ availability, slotsPerReply: config.slotsPerReply, bookingWindowDays: config.bookingWindowDays, searchTool: opts.searchTool && Boolean(availability) })
      : '',
    `You must NEVER state that a visit is booked, moved, cancelled or confirmed, or that a payment was received or a refund made. A member of staff does those. If they ask to book or move a visit, offer times and say you are passing it on, and that they will get a confirmation; if they ask to cancel, say your colleague will take care of it.`,
    `Only mention an amount owed if they ask about money or payment, and then only exactly as given above.`,
    escalations ? `# Stop and hand over to a person when\n\n${escalations}\n\nWhen one of these applies, ${opts.sendsItself ? 'call hand_over_to_colleague, then ' : ''}say your colleague will pick this up shortly and stop.` : '',
    config.neverSays ? `# Never\n\n${config.neverSays}` : '',
    opts.sendsItself
      ? `# This reply is sent as it is\nIt goes straight to them: nobody at the clinic reads it first. Write the message itself and nothing else -- no preamble, no options to choose between, no notes to anyone. Whenever a rule under "Stop and hand over to a person when" applies, they want something you cannot do, or you are not sure what to answer, call hand_over_to_colleague with the reason before you reply. When they accept a time, call hand_over_to_colleague saying exactly what to book or move (type, day, time and who with): a colleague books it, and you tell them they will get a confirmation.`
      : `# This reply is a draft\nA member of staff will read what you write before it is sent, and may edit it. Write the message itself and nothing else -- no preamble, no options to choose between, no notes to the reader.`,
    // Last, so nothing above can be read as overriding it.
    CONFIDENTIALITY_SECTION,
  ]
    .filter(Boolean)
    .join('\n\n')
}

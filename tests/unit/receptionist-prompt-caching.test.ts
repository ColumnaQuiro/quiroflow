import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { buildPatientReplyPrompt, type PatientPromptConfig } from '../../utils/patientReplyPrompt'
import type { PromptClinic } from '../../utils/receptionistClinic'
import { CONFIDENTIALITY_SECTION } from '../../utils/receptionistGuard'
import { receptionistPromptText, receptionistSystemBlocks, ROLE_HEADING, withTailBreakpoint } from '../../utils/receptionistPrompt'

vi.mock('~/server/utils/requireGrowth', () => ({ hasReceptionist: () => true }))
const { buildSystemPrompt, toneWording } = await import('../../server/utils/receptionist')

// The receptionist's briefing is cached per clinic (utils/receptionistPrompt.ts),
// which only works while the cached part is byte-for-byte the same for every
// conversation. Nothing fails when it is not: every reply just pays full
// price again, which is how it ran until 14 Oct 2026. These pin that the
// person, the clock and the calendar stay out of it.
//
// And since 21 Nov 2026 the cached part is the same for a lead and a patient,
// so the two share one cache entry instead of each expiring on its own.

const config: PatientPromptConfig = {
  personaName: 'Alba',
  toneLine: 'Courteous and brief.',
  languages: ['es', 'en'],
  knowledge: [{ title: 'Precios', lines: ['Primera visita: 50 €', 'Ajuste: 40 €'] }],
  escalationRules: [{ rule: 'Quiere cancelar una cita', action: 'Pasar a una persona.' }],
  neverSays: 'No hables de otras clínicas.',
  slotsPerReply: 2,
  bookingWindowDays: 14,
}

const availability = {
  groups: [{
    clinicId: 'c1',
    clinicName: null,
    types: [{ name: 'Ajuste', durationMinutes: 30 }],
    days: [{ date: '2026-10-22', times: ['09:30', '10:30'] }],
    truncatedAfter: null,
  }],
}

const one = {
  facts: { firstName: 'Ana', upcoming: [], lastVisitAt: null, plan: null, outstandingCents: null },
  offeredTypes: [],
  calendar: { now: new Date('2026-10-12T08:00:00Z'), timeZone: 'Europe/Madrid', availability: null },
}

const another = {
  facts: {
    firstName: 'Luis',
    upcoming: [{ startsAt: '2026-10-21T08:00:00Z', typeName: 'Ajuste', practitionerName: 'Ana Ruiz' }],
    lastVisitAt: '2026-10-07T08:00:00Z',
    lastVisitType: 'Ajuste',
    plan: { name: 'Plan lumbar', totalVisits: 10, done: 4, cadence: 'weekly' },
    outstandingCents: 4000,
  },
  offeredTypes: [{ name: 'Ajuste', durationMinutes: 30 }],
  calendar: { now: new Date('2026-10-13T17:42:00Z'), timeZone: 'Europe/Madrid', availability },
  bookedVisits: [{ startsAt: '2026-10-21T08:00:00Z', typeName: 'Ajuste' }],
  searchTool: true,
}

describe('The cached part of the receptionist briefing', () => {
  it('is the same for two different patients at two different moments', () => {
    expect(buildPatientReplyPrompt(config, another).clinic).toBe(buildPatientReplyPrompt(config, one).clinic)
    // And while sending as it is, booking on its own.
    const sending = { sendsItself: true, canBook: true, canWaitlist: true }
    expect(buildPatientReplyPrompt(config, { ...another, ...sending }).clinic).toBe(buildPatientReplyPrompt(config, { ...one, ...sending }).clinic)
  })

  it('holds the clinic and leaves the person, the clock and the free times to the rest', () => {
    const { clinic, role, conversation } = buildPatientReplyPrompt(config, another)
    expect(clinic).toContain('Primera visita: 50 €')
    // The hand-over rules are cached too, in the role: they must come after
    // the lead's condition section (buildSystemPrompt), as they always did.
    expect(role).toContain('Quiere cancelar una cita')
    expect(clinic).not.toContain('# Stop and hand over to a person when')
    for (const varying of ['Luis', 'Plan lumbar', '2026-10-22', '09:30']) {
      expect(clinic).not.toContain(varying)
      expect(conversation).toContain(varying)
    }
  })

  it('still ends with the confidentiality rules, so nothing can override them', () => {
    expect(receptionistPromptText(buildPatientReplyPrompt(config, another)).endsWith(CONFIDENTIALITY_SECTION)).toBe(true)
  })
})

const leadConfig = {
  enabled: true,
  personaName: 'Alba',
  languages: ['es', 'en'],
  tone: 'warm_brief',
  neverSays: 'No hables de otras clínicas.',
  knowledge: [{ id: 'k1', title: 'Precios', lines: ['Primera visita: 50 €', 'Ajuste: 40 €'] }],
  qualificationQuestions: ['¿Cómo nos conociste?'],
  escalationRules: [{ rule: 'Quiere cancelar una cita', action: 'Pasar a una persona.' }],
  bookingWindowDays: 14,
  minimumNoticeMinutes: 120,
  slotsPerReply: 2,
  bookableAppointmentTypeIds: [],
  afterHours: true,
  missedCallTextBack: false,
  answerDuringHours: true,
  noReplyPhrases: [],
  monthlyReplyLimit: null,
  reactivationAppointmentTypeId: null,
  updatedAt: null,
} as Parameters<typeof buildSystemPrompt>[0]
const patientConfig: PatientPromptConfig = { ...config, toneLine: toneWording(leadConfig.tone) }
const clinicDetails: PromptClinic[] = [{ name: 'Clínica Demo', address: 'Calle Inventada 1', phone: null, email: null, clinicHours: null, practitionerHours: [] }]
const team = ['Laura Vidal', 'Marta Ríos']

function lead(mode: { sendsItself: boolean; canBook: boolean }) {
  return buildSystemPrompt(leadConfig, { testMode: false, offeredTypes: [{ name: 'Primera visita', durationMinutes: 45 }], calendar: { ...another.calendar, withWhom: null }, draft: { personName: 'Persona Inventada' }, clinicDetails, team, ...mode })
}
function patient(mode: { sendsItself: boolean; canBook: boolean }) {
  return buildPatientReplyPrompt(patientConfig, { ...another, clinicDetails, team, ...mode })
}

describe('One cached part for leads and patients', () => {
  it('is the same bytes for a lead and a patient at the same clinic, sending or drafting', () => {
    for (const mode of [{ sendsItself: true, canBook: true }, { sendsItself: false, canBook: false }]) {
      expect(lead(mode).clinic).toBe(patient(mode).clinic)
    }
  })

  it('leaves who is writing to the role after it, under its own heading', () => {
    const mode = { sendsItself: true, canBook: true }
    expect(lead(mode).clinic).not.toContain('prospective patients')
    expect(patient(mode).clinic).not.toContain("the clinic's own patients")
    expect(lead(mode).role.startsWith(`${ROLE_HEADING}\nYou answer enquiries from prospective patients.`)).toBe(true)
    expect(patient(mode).role.startsWith(`${ROLE_HEADING}\nYou are replying to one of the clinic's own patients`)).toBe(true)
    // Everything a lead's briefing said is still said, once.
    expect(lead(mode).role).toContain('# When they mention a condition')
    expect(lead(mode).role).toContain('¿Cómo nos conociste?')
    expect(patient(mode).role).toContain('Never ask a patient for their name, email or phone number')
  })

  it('tells a lead the patient-only tool it is offered is not for them', () => {
    expect(lead({ sendsItself: true, canBook: true }).role).toContain('stop_follow_ups is for the clinic\'s own patients')
    expect(lead({ sendsItself: false, canBook: false }).role).not.toContain('stop_follow_ups')
  })

  it('keeps the person out of both cached parts', () => {
    for (const prompt of [lead({ sendsItself: true, canBook: true }), patient({ sendsItself: true, canBook: true })]) {
      for (const varying of ['Persona Inventada', 'Luis', 'Plan lumbar', '2026-10-22', '09:30']) {
        expect(prompt.clinic).not.toContain(varying)
        expect(prompt.role).not.toContain(varying)
      }
    }
  })
})

describe('The request as sent', () => {
  it('caches the clinic and the role for an hour, at two breakpoints, and not the conversation', () => {
    const blocks = receptionistSystemBlocks(patient({ sendsItself: true, canBook: true }))
    expect(blocks.map((b) => b.cache_control ?? null)).toEqual([{ type: 'ephemeral', ttl: '1h' }, { type: 'ephemeral', ttl: '1h' }, null])
  })

  it('marks only the newest block of the messages, and leaves the caller\'s untouched', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'Hola, quiero cita' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'find_free_times', input: { from_date: '2026-10-22' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Nada libre.' }] },
    ]
    const before = JSON.stringify(messages)
    const sent = withTailBreakpoint(messages)
    expect(JSON.stringify(messages)).toBe(before)
    const marked = sent.flatMap((m) => (m.content as Anthropic.ContentBlockParam[]).filter((b) => 'cache_control' in b && b.cache_control))
    expect(marked).toHaveLength(1)
    expect(marked[0]).toMatchObject({ type: 'tool_result', cache_control: { type: 'ephemeral', ttl: '5m' } })
    // A plain string becomes the one text block it stands for.
    expect(sent[0]!.content).toEqual([{ type: 'text', text: 'Hola, quiero cita' }])
  })

  it('uses three of the four breakpoints a request may carry', () => {
    const system = receptionistSystemBlocks(lead({ sendsItself: true, canBook: true }))
    const messages = withTailBreakpoint([{ role: 'user', content: 'Hola' }])
    const count = system.filter((b) => b.cache_control).length + messages.flatMap((m) => m.content as Anthropic.ContentBlockParam[]).filter((b) => 'cache_control' in b && b.cache_control).length
    expect(count).toBe(3)
  })
})

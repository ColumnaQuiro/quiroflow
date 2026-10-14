import { describe, expect, it } from 'vitest'
import { buildPatientReplyPrompt, type PatientPromptConfig } from '../../utils/patientReplyPrompt'
import { CONFIDENTIALITY_SECTION } from '../../utils/receptionistGuard'
import { receptionistPromptText } from '../../utils/receptionistPrompt'

// The receptionist's briefing is cached per clinic (utils/receptionistPrompt.ts),
// which only works while the cached part is byte-for-byte the same for every
// conversation. Nothing fails when it is not: every reply just pays full
// price again, which is how it ran until 14 Oct 2026. These pin that the
// person, the clock and the calendar stay out of it.
//
// Only the patient prompt is pinned here: the lead prompt (buildSystemPrompt)
// lives in server/utils, which this suite cannot import. It is split the same
// way, section for section.

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
    const { clinic, conversation } = buildPatientReplyPrompt(config, another)
    expect(clinic).toContain('Primera visita: 50 €')
    expect(clinic).toContain('Quiere cancelar una cita')
    for (const varying of ['Luis', 'Plan lumbar', '2026-10-22', '09:30']) {
      expect(clinic).not.toContain(varying)
      expect(conversation).toContain(varying)
    }
  })

  it('still ends with the confidentiality rules, so nothing can override them', () => {
    expect(receptionistPromptText(buildPatientReplyPrompt(config, another)).endsWith(CONFIDENTIALITY_SECTION)).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { buildPatientReplyPrompt, patientFactsSection, type PatientPromptConfig, type PatientReplyFacts } from '../../utils/patientReplyPrompt'
import { receptionistPromptText } from '../../utils/receptionistPrompt'

// A reply to a patient in the Inbox, drafted by the receptionist
// (server/utils/patientReplyDraft.ts): what it is told about them, and the
// lines that keep a draft from promising what only a person can do.
const facts: PatientReplyFacts = {
  firstName: 'Nora',
  upcoming: [
    { startsAt: '2026-10-13T08:00:00Z', typeName: 'Seguimiento', practitionerName: 'Ana Ruiz' },
    { startsAt: '2026-10-20T08:00:00Z', typeName: null, practitionerName: null },
  ],
  lastVisitAt: '2026-10-06T08:00:00Z',
  plan: { name: 'Plan lumbar', totalVisits: 10, done: 4, cadence: 'weekly' },
  outstandingCents: 4500,
}

describe('patientFactsSection', () => {
  it('states the next visits at the clinic hour, the plan and what they owe', () => {
    const s = patientFactsSection(facts, 'Europe/Madrid')
    expect(s).toContain('- Name: Nora')
    expect(s).toContain('Next visit: Tuesday 13 October at 10:00 (Seguimiento with Ana Ruiz)')
    expect(s).toContain('Then: Tuesday 20 October at 10:00')
    expect(s).toContain('Care plan "Plan lumbar": 4 of 10 visits done, 6 left, weekly.')
    expect(s).toMatch(/Unpaid: 45,00\s€\./)
  })

  it('says nothing about money when the asker cannot see it, and says when nothing is booked', () => {
    const s = patientFactsSection({ ...facts, upcoming: [], plan: null, outstandingCents: null }, 'Europe/Madrid')
    expect(s).toContain('Next visit: nothing booked.')
    expect(s).not.toContain('Unpaid')
    expect(s).not.toContain('Care plan')
  })
})

describe('buildPatientReplyPrompt', () => {
  it('speaks to a patient, carries the facts, and never lets the draft claim a booking or payment', () => {
    const config: PatientPromptConfig = { personaName: 'Alba', toneLine: 'Courteous and brief.', languages: ['es', 'en'], knowledge: [], escalationRules: [], neverSays: '', slotsPerReply: 2, bookingWindowDays: 14 }
    const prompt = receptionistPromptText(buildPatientReplyPrompt(config, {
      facts,
      offeredTypes: [],
      calendar: { now: new Date('2026-10-11T10:00:00Z'), timeZone: 'Europe/Madrid', availability: null },
    }))
    expect(prompt).toContain("replying to one of the clinic's own patients")
    expect(prompt).toContain('# What you already know about this patient')
    expect(prompt).toContain('NEVER state that a visit is booked, moved, cancelled or confirmed')
    expect(prompt).toContain('Never give clinical or medical advice')
    expect(prompt).toContain('# This reply is a draft')
  })
})

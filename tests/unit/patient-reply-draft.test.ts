import { describe, expect, it } from 'vitest'
import { buildPatientReplyPrompt, openBono, patientFactsSection, returningPatientSection, type PatientPromptConfig, type PatientReplyFacts } from '../../utils/patientReplyPrompt'
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

// From the receptionist's daily review, 19 Oct 2026: a patient last seen in
// 2024 was quoted the first-visit price, and one with six bono sessions left
// was offered a reactivation visit.
describe('returning patients', () => {
  it('keeps the first visit and its price from someone who has been before', () => {
    const s = returningPatientSection({ ...facts, bono: null })
    expect(s).toContain('Never offer them a first visit, never quote the first-visit price')
    expect(s).not.toContain('left on their package')
  })

  it('offers a bono holder their usual session, not a reactivation', () => {
    const s = returningPatientSection({ ...facts, bono: { name: 'Bono 10', sessionsLeft: 6 } })
    expect(s).toContain('6 sessions left on their package')
    expect(s).toContain('not a reactivation or report visit')
    expect(patientFactsSection({ ...facts, bono: { name: 'Bono 10', sessionsLeft: 6 } }, 'Europe/Madrid')).toContain('- Package "Bono 10": 6 sessions left to use.')
  })

  // From the daily review of 21 Oct 2026: last seen a year ago at a report
  // visit, answering the six-month reactivation recall, and offered another
  // report -- the type of their last visit.
  it('offers someone back after six months with no bono the clinic\'s reactivation visit', () => {
    const now = new Date('2026-10-21T10:00:00Z')
    const lapsed = { ...facts, lastVisitAt: '2025-10-23T08:00:00Z', lastVisitType: 'Informe Quiropractico', bono: null }
    const s = returningPatientSection(lapsed, { reactivationType: 'Reactivación paciente', now })
    expect(s).toContain('offer "Reactivación paciente" -- not the type of their last visit, and not a report visit')
  })

  it('keeps the usual type when the clinic has named no reactivation visit, the visit was recent, or a bono is open', () => {
    const now = new Date('2026-10-21T10:00:00Z')
    const lapsed = { ...facts, lastVisitAt: '2025-10-23T08:00:00Z', bono: null }
    expect(returningPatientSection(lapsed, { reactivationType: null, now })).not.toContain('Reactivación')
    expect(returningPatientSection({ ...lapsed, lastVisitAt: '2026-06-01T08:00:00Z' }, { reactivationType: 'Reactivación paciente', now })).not.toContain('Reactivación')
    const withBono = returningPatientSection({ ...lapsed, bono: { name: 'Bono 10', sessionsLeft: 3 } }, { reactivationType: 'Reactivación paciente', now })
    expect(withBono).not.toContain('offer "Reactivación paciente"')
    expect(withBono).toContain('not a reactivation or report visit')
  })

  it('says nothing for a record with no visit yet, whose first visit is still theirs', () => {
    expect(returningPatientSection({ ...facts, lastVisitAt: null, bono: null })).toBe('')
  })

  it('reaches the prompt', () => {
    const config: PatientPromptConfig = { personaName: 'Alba', toneLine: 'Courteous and brief.', languages: ['es'], knowledge: [], escalationRules: [], neverSays: '', slotsPerReply: 2, bookingWindowDays: 14 }
    const prompt = receptionistPromptText(buildPatientReplyPrompt(config, { facts, offeredTypes: [], calendar: { now: new Date('2026-10-11T10:00:00Z'), timeZone: 'Europe/Madrid', availability: null } }))
    expect(prompt).toContain('# They have been to the clinic before')
  })

  it('picks the open package with sessions left', () => {
    expect(openBono([{ package_name: 'Bono 5', sessions_total: 5, sessions_used: 5 }, { package_name: 'Bono 10', sessions_total: 10, sessions_used: 4 }])).toEqual({ name: 'Bono 10', sessionsLeft: 6 })
    expect(openBono([{ package_name: 'Bono 5', sessions_total: 5, sessions_used: 5 }])).toBeNull()
    expect(openBono(null)).toBeNull()
  })
})

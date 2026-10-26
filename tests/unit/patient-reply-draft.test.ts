import { describe, expect, it } from 'vitest'
import { LEFT_THE_CLINIC_LINE, buildPatientReplyPrompt, openBono, patientFactsSection, returningPatientSection, summariseVisitHistory, visitHistoryRule, type PastVisit, type PatientPromptConfig, type PatientReplyFacts } from '../../utils/patientReplyPrompt'
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

// A patient missed Thursday's visit, was called about it, and wrote on Friday
// with the following Thursday noted down. The receptionist saw only visits
// still booked and the last one attended, so for it he had no visit at all,
// and it handed over instead of offering the time that was free.
describe('visit history', () => {
  const now = new Date('2026-10-23T10:30:00Z')
  const v = (startsAt: string, status: string, typeName = 'Mantenimiento', practitionerName = 'Natacha Felix'): PastVisit => ({ startsAt, status, typeName, practitionerName })
  const past = [
    v('2026-10-22T17:45:00Z', 'no_show'),
    v('2026-09-29T15:30:00Z', 'completed'),
    v('2026-09-10T15:30:00Z', 'cancelled'),
    v('2026-08-27T15:30:00Z', 'completed'),
    v('2026-08-12T15:30:00Z', 'completed', 'Ajuste', 'Natacha Felix'),
    v('2026-05-05T15:30:00Z', 'no_show'),
  ]

  it('summarises rather than lists: the latest whatever became of it, recent misses, the usual visit', () => {
    const h = summariseVisitHistory(past, { now, attended: 23, firstVisitAt: '2025-11-04T10:00:00Z' })!
    expect(h.latest?.status).toBe('no_show')
    expect(h.usualType).toBe('Mantenimiento')
    expect(h.usualPractitioner).toBe('Natacha Felix')
    // The latest is not repeated, and May is past the three months.
    expect(h.recentMisses.map((m) => m.startsAt)).toEqual(['2026-09-10T15:30:00Z'])
    expect(h.attended).toBe(23)
  })

  it('tells the receptionist a missed visit plainly, at the clinic hour', () => {
    const history = summariseVisitHistory(past, { now, attended: 23, firstVisitAt: '2025-11-04T10:00:00Z' })
    const s = patientFactsSection({ ...facts, upcoming: [], lastVisitAt: '2026-09-29T15:30:00Z', lastVisitType: 'Mantenimiento', history }, 'Europe/Madrid')
    expect(s).toContain('Next visit: nothing booked.')
    expect(s).toContain('Last visit they came to: 29 September 2026 (Mantenimiento)')
    expect(s).toContain('Most recent appointment before now: Thursday 22 October at 19:45 (Mantenimiento with Natacha Felix) -- they did NOT come (marked as missed).')
    expect(s).toContain('Visits they came to: 23, the first on 4 November 2025; usually Mantenimiento with Natacha Felix.')
    expect(s).toContain('Also missed or cancelled in the last three months: Thursday 10 September at 17:30 (Mantenimiento with Natacha Felix), cancelled.')
  })

  it('does not repeat the latest when they came to it', () => {
    const history = summariseVisitHistory(past.slice(1), { now, attended: 23, firstVisitAt: null })
    const s = patientFactsSection({ ...facts, upcoming: [], history }, 'Europe/Madrid')
    expect(s).not.toContain('Most recent appointment before now')
  })

  it('has nothing to say for someone with no past appointment', () => {
    expect(summariseVisitHistory([], { now, attended: 0, firstVisitAt: null })).toBeNull()
    expect(visitHistoryRule({ ...facts, history: null })).toBe('')
  })

  it('answers a remembered date from the records, offers a time, and never mentions a fee', () => {
    const history = summariseVisitHistory(past, { now, attended: 23, firstVisitAt: null })
    const config: PatientPromptConfig = { personaName: 'Alba', toneLine: 'Courteous and brief.', languages: ['es'], knowledge: [], escalationRules: [], neverSays: '', slotsPerReply: 2, bookingWindowDays: 14 }
    const prompt = receptionistPromptText(buildPatientReplyPrompt(config, {
      facts: { ...facts, upcoming: [], history },
      offeredTypes: [],
      calendar: { now, timeZone: 'Europe/Madrid', availability: null },
    }))
    expect(prompt).toContain('If they mention a visit that is not under "Next visit"')
    expect(prompt).toContain('without mentioning any fee or charge')
    expect(prompt).toContain('offer them a new time with their usual practitioner')
    expect(prompt).toContain('Do not hand over just because what they remember differs from the records')
    expect(prompt).toContain('they did NOT come')
  })
})

// A patient wrote that she had moved away. The receptionist said goodbye and
// handed over so someone could take her off the recalls; nobody did, and the
// next recall would have gone to her anyway.
describe('someone who has left', () => {
  const config: PatientPromptConfig = { personaName: 'Alba', toneLine: 'Courteous and brief.', languages: ['es'], knowledge: [], escalationRules: [], neverSays: '', slotsPerReply: 2, bookingWindowDays: 14 }
  const prompt = (canStopFollowUps: boolean) => receptionistPromptText(buildPatientReplyPrompt(config, {
    facts,
    offeredTypes: [],
    calendar: { now: new Date('2026-10-25T09:30:00Z'), timeZone: 'Europe/Madrid', availability: null },
    sendsItself: true,
    canStopFollowUps,
  }))

  it('takes them off the follow-ups itself when it can, instead of handing over', () => {
    expect(prompt(true)).toContain(LEFT_THE_CLINIC_LINE)
    expect(LEFT_THE_CLINIC_LINE).toContain('call stop_follow_ups')
    expect(LEFT_THE_CLINIC_LINE).toContain('This replaces handing it over to a colleague')
  })

  it('never reads a later or a trip as leaving', () => {
    expect(LEFT_THE_CLINIC_LINE).toContain('Never call it for a later, a holiday, a trip')
  })

  it('says nothing about it when the tool is not on the request (a draft)', () => {
    expect(prompt(false)).not.toContain('stop_follow_ups')
  })
})

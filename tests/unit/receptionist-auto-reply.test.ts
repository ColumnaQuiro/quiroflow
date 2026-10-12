import { describe, it, expect } from 'vitest'
import {
  MAX_AUTO_REPLIES_PER_DAY,
  autoReplyHeldBack,
  autoReplyNow,
  clinicOpenAt,
  personRepliedSince,
  type ConversationMessage,
} from '../../utils/receptionistAutoReply'
import { buildPatientReplyPrompt, type PatientPromptConfig } from '../../utils/patientReplyPrompt'

// When the AI receptionist answers on its own rather than drafting: the
// clinic's two switches against its opening hours, and what holds it back in
// a conversation (a person in it, the day's limit, an open handover).

const hours = { mon: [['09:00', '14:00'], ['16:00', '20:00']], tue: [['09:00', '20:00']], wed: [], thu: [], fri: [['09:00', '14:00']], sat: [], sun: [] } as Record<string, [string, string][]>

describe('Receptionist auto-reply', () => {
  it("reads opening hours on the clinic's own clock", () => {
    // Monday 12 Oct 2026, 10:00 in Madrid (08:00Z).
    expect(clinicOpenAt(new Date('2026-10-12T08:00:00Z'), 'Europe/Madrid', hours)).toBe(true)
    // The lunch gap, 15:00 Madrid.
    expect(clinicOpenAt(new Date('2026-10-12T13:00:00Z'), 'Europe/Madrid', hours)).toBe(false)
    // 21:30 Monday Madrid is 19:30Z: closed, though 19:30 would be open.
    expect(clinicOpenAt(new Date('2026-10-12T19:30:00Z'), 'Europe/Madrid', hours)).toBe(false)
    // 23:30Z Monday is already Tuesday 01:30 in Madrid.
    expect(clinicOpenAt(new Date('2026-10-12T23:30:00Z'), 'Europe/Madrid', hours)).toBe(false)
    expect(clinicOpenAt(new Date('2026-10-12T08:00:00Z'), 'Europe/Madrid', null)).toBeNull()
    expect(clinicOpenAt(new Date('2026-10-12T08:00:00Z'), 'Europe/Madrid', { mon: [] })).toBeNull()
  })

  it('answers by the switches: outside hours, during hours, or neither', () => {
    expect(autoReplyNow({ afterHours: true, answerDuringHours: false }, false)).toBe(true)
    expect(autoReplyNow({ afterHours: true, answerDuringHours: false }, true)).toBe(false)
    expect(autoReplyNow({ afterHours: false, answerDuringHours: true }, true)).toBe(true)
    expect(autoReplyNow({ afterHours: false, answerDuringHours: false }, false)).toBe(false)
    // Hours unknown: read as open, so only "during hours" answers.
    expect(autoReplyNow({ afterHours: true, answerDuringHours: false }, null)).toBe(false)
    expect(autoReplyNow({ afterHours: false, answerDuringHours: true }, null)).toBe(true)
  })

  const now = new Date('2026-10-12T20:00:00Z')
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString()
  const msg = (direction: string, sentByAi: boolean, minutesAgo: number): ConversationMessage => ({ direction, sentByAi, createdAt: at(minutesAgo) })

  it('stays quiet while a person from the clinic is in the conversation', () => {
    expect(autoReplyHeldBack([msg('inbound', false, 5), msg('outbound', false, 30)], now)).toBe('person')
    expect(autoReplyHeldBack([msg('outbound', false, 90), msg('inbound', false, 5)], now)).toBeNull()
    // Its own replies are not a person.
    expect(autoReplyHeldBack([msg('outbound', true, 2), msg('inbound', false, 1)], now)).toBeNull()
  })

  it('sends at most the day\'s limit in one conversation', () => {
    const sent = Array.from({ length: MAX_AUTO_REPLIES_PER_DAY }, (_, i) => msg('outbound', true, 60 * (i + 1)))
    expect(autoReplyHeldBack(sent, now)).toBe('limit')
    expect(autoReplyHeldBack(sent.slice(1), now)).toBeNull()
    // Yesterday's do not count.
    expect(autoReplyHeldBack(sent.map((m) => ({ ...m, createdAt: new Date(new Date(m.createdAt).getTime() - 24 * 3600_000).toISOString() })), now)).toBeNull()
  })

  it('takes a handover as picked up once a person has written since', () => {
    const handedOver = at(60)
    expect(personRepliedSince([msg('outbound', true, 59), msg('inbound', false, 30)], handedOver)).toBe(false)
    expect(personRepliedSince([msg('outbound', false, 10)], handedOver)).toBe(true)
  })
})


describe('A reply that is sent as it is', () => {
  const config: PatientPromptConfig = {
    personaName: 'Alba',
    toneLine: 'Courteous and brief.',
    languages: ['es'],
    knowledge: [],
    escalationRules: [{ rule: 'Quiere cancelar una cita', action: 'Pasar a una persona.' }],
    neverSays: '',
    slotsPerReply: 2,
    bookingWindowDays: 14,
  }
  const base = {
    facts: { firstName: 'Ana', upcoming: [], lastVisitAt: null, plan: null, outstandingCents: null },
    offeredTypes: [],
    calendar: { now: new Date('2026-10-12T20:00:00Z'), timeZone: 'Europe/Madrid', availability: null },
  }

  it('says nobody reads it first, and to hand over rather than guess', () => {
    const prompt = buildPatientReplyPrompt(config, { ...base, sendsItself: true })
    expect(prompt).toContain('# This reply is sent as it is')
    expect(prompt).toContain('call hand_over_to_colleague')
    expect(prompt).not.toContain('# This reply is a draft')
  })

  it('is still a draft for a person to read otherwise', () => {
    const prompt = buildPatientReplyPrompt(config, base)
    expect(prompt).toContain('# This reply is a draft')
    expect(prompt).not.toContain('hand_over_to_colleague')
  })

  // Booking on its own: what it may say is held to what book_appointment did.
  it('books with book_appointment, and says booked only once it confirms', () => {
    const visits = [{ startsAt: '2026-10-20T08:00:00Z', typeName: 'Ajuste' }]
    const prompt = buildPatientReplyPrompt(config, { ...base, bookedVisits: visits, sendsItself: true, canBook: true })
    expect(prompt).toContain('call book_appointment with it')
    expect(prompt).toContain('unless book_appointment has just confirmed it in this reply')
    expect(prompt).toContain('move it with book_appointment (move_visit_on')
    expect(prompt).not.toContain('a colleague books it')
    // Never cancels.
    expect(prompt).toContain('If they ask to cancel, say your colleague will take care of it.')
  })

  it('hands an accepted time to a colleague when it cannot book', () => {
    const prompt = buildPatientReplyPrompt(config, { ...base, sendsItself: true })
    expect(prompt).toContain('a colleague books it')
    expect(prompt).not.toContain('call book_appointment')
  })
})

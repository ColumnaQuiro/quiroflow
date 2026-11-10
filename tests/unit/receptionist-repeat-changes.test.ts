import { describe, expect, it } from 'vitest'
import { REPEAT_CHANGE_LIMIT, changesWithoutComing, repeatChangeRefusal, repeatChangeSection, type DiaryChange } from '../../utils/receptionistTypes'
import { buildPatientReplyPrompt } from '../../utils/patientReplyPrompt'
import { receptionistPromptText } from '../../utils/receptionistPrompt'

// Some patients moved or cancelled the same visit two and three times
// through the receptionist without coming in between (10 Nov 2026). Each
// change was granted on the spot. From the third on it is a person's, and
// the patient is told their place cannot be guaranteed.

const TZ = 'Europe/Madrid'
const move = (at: string, from: string, to: string): DiaryChange => ({ at, changes: { starts_at: { from, to } } })
const cancel = (at: string): DiaryChange => ({ at, changes: { status: { from: 'booked', to: 'cancelled' } } })

describe('Changes to a visit without coming', () => {
  it('counts a move to another day and a cancellation, each on its day', () => {
    const rows = [
      move('2026-11-02T09:00:00Z', '2026-11-03T16:00:00Z', '2026-11-05T16:00:00Z'),
      cancel('2026-11-04T18:00:00Z'),
      move('2026-11-09T10:00:00Z', '2026-11-10T16:00:00Z', '2026-11-12T09:00:00Z'),
    ]
    expect(changesWithoutComing(rows, null, TZ)).toBe(3)
  })

  it('does not count a new time the same day, nor a change that moved nothing', () => {
    const rows = [
      move('2026-11-02T09:00:00Z', '2026-11-03T09:00:00Z', '2026-11-03T16:00:00Z'),
      { at: '2026-11-02T09:05:00Z', changes: { status: { from: 'booked', to: 'completed' } } },
      { at: '2026-11-02T09:06:00Z', changes: null },
    ]
    expect(changesWithoutComing(rows, null, TZ)).toBe(0)
  })

  // "Mejor el jueves... no, el viernes" is one change, not two.
  it('counts several changes on one day once', () => {
    const rows = [
      move('2026-11-02T09:00:00Z', '2026-11-03T16:00:00Z', '2026-11-05T16:00:00Z'),
      move('2026-11-02T09:20:00Z', '2026-11-05T16:00:00Z', '2026-11-06T16:00:00Z'),
      cancel('2026-11-02T19:00:00Z'),
    ]
    expect(changesWithoutComing(rows, null, TZ)).toBe(1)
  })

  // The day is the clinic's: 23:30 in Madrid on the 2nd is already the 2nd
  // at 22:30 UTC, and 00:30 on the 3rd is still the 2nd in UTC.
  it("reads the day on the clinic's clock", () => {
    const rows = [cancel('2026-11-02T22:30:00Z'), cancel('2026-11-02T23:30:00Z')]
    expect(changesWithoutComing(rows, null, TZ)).toBe(2)
    expect(changesWithoutComing(rows, null, 'UTC')).toBe(1)
  })

  it('starts again once they have come', () => {
    const rows = [
      cancel('2026-10-20T09:00:00Z'),
      move('2026-10-27T09:00:00Z', '2026-10-28T16:00:00Z', '2026-11-04T16:00:00Z'),
      cancel('2026-11-09T09:00:00Z'),
    ]
    expect(changesWithoutComing(rows, '2026-11-04T16:00:00Z', TZ)).toBe(1)
    expect(changesWithoutComing(rows, '2026-11-09T16:00:00Z', TZ)).toBe(0)
  })
})

describe('What the receptionist is told about them', () => {
  it('says nothing below the limit', () => {
    expect(repeatChangeSection(0, { canBook: true, sendsItself: true })).toBe('')
    expect(repeatChangeSection(REPEAT_CHANGE_LIMIT - 1, { canBook: true, sendsItself: true })).toBe('')
  })

  it('hands the next change to a colleague, without guaranteeing the place', () => {
    const section = repeatChangeSection(2, { canBook: true, sendsItself: true })
    expect(section).toContain('# They have changed their visit twice without coming')
    expect(section).toContain('do not offer times and do not call book_appointment for it')
    expect(section).toContain('Veo que ya hemos cambiado tu cita dos veces y todavía no has podido venir')
    expect(section).toContain('no podemos garantizarte el hueco')
    expect(section).toContain('call hand_over_to_colleague')
    // A visit they will not come to is still cancelled, so the time is not lost.
    expect(section).toContain('cancel it with cancel_appointment as usual')
    // Their child's or relative's visit is not theirs to answer for.
    expect(section).toContain('A visit for their child, a relative or someone they bring is booked as usual')
    expect(repeatChangeSection(3, { canBook: true, sendsItself: true })).toContain('tres veces')
  })

  it('names no tool in a draft a person reads first', () => {
    const section = repeatChangeSection(2, { canBook: false, sendsItself: false })
    expect(section).not.toContain('book_appointment')
    expect(section).not.toContain('cancel_appointment')
    expect(section).not.toContain('hand_over_to_colleague')
    expect(section).toContain('say your colleague will cancel it')
  })

  it('refuses the booking itself with the same words', () => {
    const refusal = repeatChangeRefusal(2)
    expect(refusal).toContain('twice without them coming')
    expect(refusal).toContain('Call hand_over_to_colleague')
    expect(refusal).toContain('their place cannot be guaranteed')
  })

  it("is in a patient's prompt only once they have reached the limit", () => {
    const config = { personaName: 'Alba', toneLine: 'Courteous and brief.', languages: ['es'], knowledge: [], escalationRules: [], neverSays: '', slotsPerReply: 2, bookingWindowDays: 14 }
    const base = { facts: { firstName: 'Nora', upcoming: [], lastVisitAt: null, plan: null, outstandingCents: null }, offeredTypes: [], calendar: { now: new Date('2026-11-10T09:00:00Z'), timeZone: TZ, availability: null }, sendsItself: true, canBook: true }
    expect(receptionistPromptText(buildPatientReplyPrompt(config, { ...base, changesWithoutComing: 1 }))).not.toContain('without coming')
    expect(receptionistPromptText(buildPatientReplyPrompt(config, { ...base, changesWithoutComing: 2 }))).toContain('# They have changed their visit twice without coming')
  })
})

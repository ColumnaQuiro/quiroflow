import { describe, expect, it } from 'vitest'
import {
  answeredAReminder,
  appointmentReminderDecision,
  effectiveReminderLead,
  reminderCandidateRange,
  reminderOpensAt,
  REMINDER_CRON_INTERVAL_MINUTES,
  type ReminderCandidate,
  type ReminderLead,
} from '../../utils/appointmentReminderDue'

const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000
// 21 Oct 2026, 10:00 UTC: the visit every case below is about.
const visit = new Date(Date.UTC(2026, 9, 21, 10, 0))
const at = (msBeforeVisit: number) => new Date(visit.getTime() - msBeforeVisit)

function appt(overrides: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    starts_at: visit.toISOString(),
    // Booked a fortnight ahead: before any reminder time.
    created_at: at(14 * 24 * HOUR).toISOString(),
    confirmation_sent_at: at(14 * 24 * HOUR).toISOString(),
    reminder_claimed_at: null,
    rescheduled: false,
    ...overrides,
  }
}

// What the cron would do on every 15-minute tick from `fromMs` before the
// visit until the visit, with the claim it writes on a send or a skip. The
// number of hours can change between ticks (`hoursAt`), as an override or
// the clinic's setting can.
function runTicks(a: ReminderCandidate, hoursAt: (msBefore: number) => ReminderLead, fromMs = 8 * 24 * HOUR, phaseMs = 0) {
  const sentAt: number[] = []
  let row = { ...a }
  for (let before = fromMs - phaseMs; before > 0; before -= REMINDER_CRON_INTERVAL_MINUTES * MINUTE) {
    const now = at(before)
    const hours = hoursAt(before)
    // The database query, then the verdict, as the cron does.
    const range = reminderCandidateRange(hours, now)
    const fetched = !row.reminder_claimed_at && visit >= range.from && visit <= range.to
    if (!fetched) continue
    const decision = appointmentReminderDecision(row, hours, now)
    if (decision === 'send' || decision === 'skip') row = { ...row, reminder_claimed_at: now.toISOString() }
    if (decision === 'send') sentAt.push(before)
  }
  return sentAt
}

describe('which lead applies', () => {
  it("is the patient's own hours when set, the clinic's days otherwise, one day when neither is", () => {
    expect(effectiveReminderLead(2, 1, 'Europe/Madrid')).toBe(2)
    expect(effectiveReminderLead(null, 2, 'Atlantic/Canary')).toEqual({ days: 2, timeZone: 'Atlantic/Canary' })
    expect(effectiveReminderLead(undefined, null, null)).toEqual({ days: 1, timeZone: 'Europe/Madrid' })
    // Out of range in the row: read as the nearest allowed.
    expect(effectiveReminderLead(null, 30, 'Europe/Madrid')).toEqual({ days: 7, timeZone: 'Europe/Madrid' })
  })
})

describe("the clinic's reminder, N days before at 10:00", () => {
  const madrid = (days: number): ReminderLead => ({ days, timeZone: 'Europe/Madrid' })
  // 21 Oct 2026 is summer time in Madrid (UTC+2): the visit is at 12:00 there,
  // and the day before at 10:00 Madrid is 08:00 UTC.
  const dayBeforeAtTen = new Date(Date.UTC(2026, 9, 20, 8, 0))

  it('goes out at 10:00 clinic time on the day before, not 24 hours before the visit', () => {
    expect(reminderOpensAt(visit, madrid(1))).toEqual(dayBeforeAtTen)
    expect(appointmentReminderDecision(appt(), madrid(1), new Date(dayBeforeAtTen.getTime() - MINUTE))).toBe('not_yet')
    expect(appointmentReminderDecision(appt(), madrid(1), dayBeforeAtTen)).toBe('send')
  })

  it('sends a whole day of visits together, whatever hour each is at', () => {
    const early = new Date(Date.UTC(2026, 9, 21, 7, 0)) // 09:00 Madrid
    const late = new Date(Date.UTC(2026, 9, 21, 17, 30)) // 19:30 Madrid
    const lastMinute = new Date(Date.UTC(2026, 9, 21, 21, 59)) // 23:59 Madrid
    for (const v of [early, late, lastMinute]) expect(reminderOpensAt(v, madrid(1))).toEqual(dayBeforeAtTen)
    // 00:30 Madrid on the 22nd is still the 21st in UTC: it belongs to the next batch.
    expect(reminderOpensAt(new Date(Date.UTC(2026, 9, 21, 22, 30)), madrid(1))).toEqual(new Date(Date.UTC(2026, 9, 21, 8, 0)))
  })

  it('counts calendar days at the clinic: three days before is the 18th at 10:00', () => {
    expect(reminderOpensAt(visit, madrid(3))).toEqual(new Date(Date.UTC(2026, 9, 18, 8, 0)))
  })

  it('is 10:00 on the clock after the clocks go back', () => {
    // Monday 26 Oct 2026, 09:00 Madrid (winter time, UTC+1). Summer time ended
    // at 03:00 on the Sunday, so 10:00 that Sunday is 09:00 UTC, not 08:00.
    const monday = new Date(Date.UTC(2026, 9, 26, 8, 0))
    expect(reminderOpensAt(monday, madrid(1))).toEqual(new Date(Date.UTC(2026, 9, 25, 9, 0)))
  })

  it("is 10:00 in the clinic's own zone", () => {
    // The Canaries are an hour behind the mainland: their 10:00 is 09:00 UTC in summer.
    expect(reminderOpensAt(visit, { days: 1, timeZone: 'Atlantic/Canary' })).toEqual(new Date(Date.UTC(2026, 9, 20, 9, 0)))
  })

  it('goes out exactly once, on the first tick from 10:00, for every number of days and any tick phase', () => {
    for (const days of [1, 2, 3, 7]) {
      const opensMsBefore = visit.getTime() - reminderOpensAt(visit, madrid(days)).getTime()
      for (const phase of [0, 1, 7, 14]) {
        const sent = runTicks(appt(), () => madrid(days), 9 * 24 * HOUR, phase * MINUTE)
        expect(sent, `${days} d, ticks ${phase} min off`).toHaveLength(1)
        expect(sent[0]).toBeLessThanOrEqual(opensMsBefore)
        expect(sent[0]).toBeGreaterThan(opensMsBefore - REMINDER_CRON_INTERVAL_MINUTES * MINUTE)
      }
    }
  })

  it('goes out on the next tick for a visit booked after 10:00 for tomorrow, unless the confirmation just said it', () => {
    const bookedAfterTen = { created_at: new Date(dayBeforeAtTen.getTime() + 5 * HOUR).toISOString() }
    const nextTick = new Date(dayBeforeAtTen.getTime() + 5 * HOUR + 10 * MINUTE)
    expect(appointmentReminderDecision(appt({ ...bookedAfterTen, confirmation_sent_at: null }), madrid(1), nextTick)).toBe('send')
    expect(appointmentReminderDecision(appt({ ...bookedAfterTen, confirmation_sent_at: bookedAfterTen.created_at }), madrid(1), nextTick)).toBe('skip')
    // Booked that morning before 10:00: it joins the 10:00 batch like any other.
    const bookedAtNine = { created_at: new Date(dayBeforeAtTen.getTime() - HOUR).toISOString(), confirmation_sent_at: new Date(dayBeforeAtTen.getTime() - HOUR).toISOString() }
    expect(appointmentReminderDecision(appt(bookedAtNine), madrid(1), dayBeforeAtTen)).toBe('send')
  })

  it('is not sent with less than two hours to go', () => {
    expect(appointmentReminderDecision(appt({ created_at: at(3 * HOUR).toISOString(), confirmation_sent_at: null }), madrid(1), at(119 * MINUTE))).toBe('skip')
  })

  it('is asked of the database for every visit whose 10:00 can already have come', () => {
    const now = dayBeforeAtTen
    const range = reminderCandidateRange(madrid(1), now)
    expect(range.from).toEqual(new Date(now.getTime() + 2 * HOUR))
    // The last visit of tomorrow (23:59 Madrid) is inside the range.
    expect(new Date(Date.UTC(2026, 9, 21, 21, 59)).getTime()).toBeLessThanOrEqual(range.to.getTime())
  })
})

describe('the appointment reminder', () => {
  it('goes out on the last tick before its time, not after it', () => {
    expect(appointmentReminderDecision(appt(), 24, at(24 * HOUR + 16 * MINUTE))).toBe('not_yet')
    expect(appointmentReminderDecision(appt(), 24, at(24 * HOUR + 15 * MINUTE))).toBe('send')
    expect(appointmentReminderDecision(appt(), 24, at(24 * HOUR))).toBe('send')
  })

  it('goes out exactly once for every lead a clinic or patient can pick, whatever minute the ticks fall on', () => {
    for (const hours of [1, 2, 3, 6, 12, 24, 48, 72, 168]) {
      for (const phase of [0, 1, 7, 14]) {
        const sent = runTicks(appt(), () => hours, 8 * 24 * HOUR, phase * MINUTE)
        expect(sent, `${hours} h, ticks ${phase} min off the hour`).toHaveLength(1)
        // Within one tick of the asked-for time, and never after it.
        expect(sent[0]).toBeGreaterThan(hours * HOUR - 1)
        expect(sent[0]).toBeLessThanOrEqual(hours * HOUR + REMINDER_CRON_INTERVAL_MINUTES * MINUTE)
      }
    }
  })

  it('reaches a two-hour patient even when a tick is missed', () => {
    // Ticks every 15 minutes, but the one at 2 h before never ran: the next
    // one, 1 h 45 before, still sends.
    expect(appointmentReminderDecision(appt(), 2, at(105 * MINUTE))).toBe('send')
    // Even an hour late.
    expect(appointmentReminderDecision(appt(), 2, at(61 * MINUTE))).toBe('send')
    // Not in the last half of their lead.
    expect(appointmentReminderDecision(appt(), 2, at(59 * MINUTE))).toBe('skip')
  })

  it('is not sent again when the hours are lowered after it went out', () => {
    // Reminded at 24 h; at 20 h before the visit the patient is set to 2 h.
    const sent = runTicks(appt(), (before) => (before > 20 * HOUR ? 24 : 2))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toBeGreaterThan(24 * HOUR - 1)
  })

  it('is sent at the new time when the hours are lowered before it went out', () => {
    // Set from the clinic's 24 to 2 h, two days before the visit.
    const sent = runTicks(appt(), (before) => (before > 48 * HOUR ? 24 : 2))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toBeLessThanOrEqual(2 * HOUR + 15 * MINUTE)
  })

  it('is not skipped when the hours are raised past where the appointment already is', () => {
    // 30 h before the visit, 24 becomes 48: the 48 h mark is already behind
    // it. It goes on the first tick under the new setting rather than never.
    const sent = runTicks(appt(), (before) => (before > 30 * HOUR ? 24 : 48))
    expect(sent).toEqual([30 * HOUR])
  })

  it('is not sent twice when the hours are raised after it went out', () => {
    const sent = runTicks(appt(), (before) => (before > 10 * HOUR ? 24 : 48))
    expect(sent).toHaveLength(1)
  })

  it('goes out for a visit booked once its reminder time had passed, unless the confirmation just said it', () => {
    // Tonight for tomorrow morning, with reminders at 24 h.
    const bookedLate = { created_at: at(14 * HOUR).toISOString() }
    expect(appointmentReminderDecision(appt({ ...bookedLate, confirmation_sent_at: null }), 24, at(14 * HOUR - 5 * MINUTE))).toBe('send')
    expect(appointmentReminderDecision(appt({ ...bookedLate, confirmation_sent_at: at(14 * HOUR).toISOString() }), 24, at(14 * HOUR - 5 * MINUTE))).toBe('skip')
    // Unless it has been moved since: that confirmation named another time.
    expect(appointmentReminderDecision(appt({ ...bookedLate, confirmation_sent_at: at(14 * HOUR).toISOString(), rescheduled: true }), 24, at(13 * HOUR))).toBe('send')
    // A confirmation sent long before the reminder time does not count.
    expect(appointmentReminderDecision(appt(), 24, at(24 * HOUR))).toBe('send')
  })

  it('is not sent for a visit booked with less than two hours to go', () => {
    expect(appointmentReminderDecision(appt({ created_at: at(90 * MINUTE).toISOString(), confirmation_sent_at: null }), 24, at(89 * MINUTE))).toBe('skip')
  })

  it('is done once claimed for the time the appointment is at', () => {
    expect(appointmentReminderDecision(appt({ reminder_claimed_at: at(24 * HOUR).toISOString() }), 2, at(2 * HOUR))).toBe('done')
  })
})

describe('what a tick asks the database for', () => {
  const now = new Date(Date.UTC(2026, 9, 20, 10, 0))
  it('reaches as far as the lead plus one tick, and stops where a reminder would be noise', () => {
    expect(reminderCandidateRange(24, now)).toEqual({
      from: new Date(now.getTime() + 2 * HOUR),
      to: new Date(now.getTime() + 24 * HOUR + 15 * MINUTE),
    })
    expect(reminderCandidateRange(2, now)).toEqual({
      from: new Date(now.getTime() + HOUR),
      to: new Date(now.getTime() + 2 * HOUR + 15 * MINUTE),
    })
  })
})

describe('an answer that silences the next reminder', () => {
  const t = (ms: number) => at(ms).toISOString()

  it('is one given after a reminder of the visit', () => {
    expect(answeredAReminder(t(70 * HOUR), [t(72 * HOUR)])).toBe(true)
    expect(answeredAReminder(t(72 * HOUR), [t(72 * HOUR)])).toBe(true)
  })

  it('is not one given at booking, before any reminder', () => {
    // Confirmar on the booking message, a fortnight ahead: the 3-day reminder
    // was sent after it, and the 24-hour one must still go.
    expect(answeredAReminder(t(14 * 24 * HOUR), [t(72 * HOUR)])).toBe(false)
    expect(answeredAReminder(t(14 * 24 * HOUR), [])).toBe(false)
  })

  it('is not one with no time recorded', () => {
    expect(answeredAReminder(null, [t(72 * HOUR)])).toBe(false)
    expect(answeredAReminder(t(1 * HOUR), [null, undefined])).toBe(false)
  })
})

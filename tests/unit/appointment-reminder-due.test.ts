import { describe, expect, it } from 'vitest'
import {
  appointmentReminderDecision,
  effectiveReminderHours,
  reminderCandidateRange,
  REMINDER_CRON_INTERVAL_MINUTES,
  type ReminderCandidate,
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
function runTicks(a: ReminderCandidate, hoursAt: (msBefore: number) => number, fromMs = 8 * 24 * HOUR, phaseMs = 0) {
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

describe('which number of hours applies', () => {
  it("is the patient's own when set, the clinic's otherwise, 24 when neither is", () => {
    expect(effectiveReminderHours(2, 24)).toBe(2)
    expect(effectiveReminderHours(null, 48)).toBe(48)
    expect(effectiveReminderHours(undefined, null)).toBe(24)
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

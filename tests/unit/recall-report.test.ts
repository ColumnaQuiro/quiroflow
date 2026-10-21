import { describe, expect, it } from 'vitest'
import { isRecallRule, recallReport, type RecallBooking } from '../../utils/recallReport'

// Reports › Recalls (utils/recallReport.ts): who each recall rule reached,
// and of them who replied, booked, came or asked not to be contacted -- each
// within 30 days of the first message.

const rules = [
  { id: 'r3m', name: 'Mantenimiento: 3 meses sin venir', trigger_event: 'segment', entry_mode: 'one_at_a_time' },
  { id: 'r6m', name: 'Reactivación: 6 a 12 meses', trigger_event: 'segment', entry_mode: 'one_at_a_time' },
]
const patients = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, first_name: id.toUpperCase(), last_name: 'Prueba', do_not_contact: id === 'd' }))
const booking = (patient_id: string, created_at: string, extra: Partial<RecallBooking> = {}): RecallBooking => ({ patient_id, created_at, starts_at: created_at, status: 'booked', source: 'staff', price_cents: 6000, ...extra })
const now = new Date('2026-11-30T12:00:00Z')

describe('Recall report', () => {
  const report = recallReport(
    {
      rules,
      sends: [
        { rule_id: 'r3m', patient_id: 'a', at: '2026-10-19T08:00:00Z' },
        // A second message in the same rule does not restart their 30 days.
        { rule_id: 'r3m', patient_id: 'a', at: '2026-10-26T08:00:00Z' },
        { rule_id: 'r3m', patient_id: 'b', at: '2026-10-19T08:00:00Z' },
        { rule_id: 'r6m', patient_id: 'c', at: '2026-10-20T08:00:00Z' },
        { rule_id: 'r6m', patient_id: 'd', at: '2026-10-20T08:00:00Z' },
        { rule_id: 'r6m', patient_id: 'e', at: '2026-11-20T08:00:00Z' },
        // Reached by both rules: one person in the totals.
        { rule_id: 'r6m', patient_id: 'a', at: '2026-10-21T08:00:00Z' },
      ],
      replies: [
        { patient_id: 'a', at: '2026-10-19T09:00:00Z' },
        { patient_id: 'b', at: '2026-10-22T09:00:00Z' },
        { patient_id: 'd', at: '2026-10-20T10:00:00Z' },
      ],
      bookings: [
        booking('a', '2026-10-19T09:30:00Z', { status: 'completed', source: 'receptionist' }),
        // Booked after the 30 days: not the recall's doing.
        booking('b', '2026-11-25T09:00:00Z'),
        // Cancelled: not a booking.
        booking('c', '2026-10-21T09:00:00Z', { status: 'cancelled' }),
      ],
      patients,
    },
    now,
  )
  const row = (rule: string, patient: string) => report.rows.find((r) => r.ruleId === rule && r.patientId === patient)!

  it('gives each contacted patient a status, within 30 days of the first message', () => {
    expect(row('r3m', 'a').status).toBe('booked')
    expect(row('r3m', 'a').contactedAt).toBe('2026-10-19T08:00:00Z')
    expect(row('r3m', 'b').status).toBe('replied')
    expect(row('r6m', 'c').status).toBe('no_reply')
    expect(row('r6m', 'd').status).toBe('opted_out')
    expect(row('r6m', 'e').status).toBe('waiting')
  })

  it('counts per rule, with value and the receptionist’s bookings', () => {
    const r3m = report.byRule.find((r) => r.ruleId === 'r3m')!
    expect(r3m).toMatchObject({ contacted: 2, replied: 2, booked: 1, came: 1, optedOut: 0, waiting: 0, valueCents: 6000, byReceptionist: 1 })
    const r6m = report.byRule.find((r) => r.ruleId === 'r6m')!
    // A booked before r6m reached them, so it is r3m's, not this rule's.
    expect(r6m).toMatchObject({ contacted: 4, booked: 0, optedOut: 1, waiting: 1 })
  })

  it('counts a patient once in the totals, at their first recall', () => {
    expect(report.totals.contacted).toBe(5)
    expect(report.totals.booked).toBe(1)
    expect(report.totals.valueCents).toBe(6000)
  })

  it('takes segment rules and one-at-a-time rules as recalls, not reminders', () => {
    expect(isRecallRule({ trigger_event: 'segment', entry_mode: 'one_at_a_time' })).toBe(true)
    expect(isRecallRule({ trigger_event: 'appointment.completed', entry_mode: 'one_at_a_time' })).toBe(true)
    expect(isRecallRule({ trigger_event: 'appointment.hours_before', entry_mode: 'every_time' })).toBe(false)
  })
})

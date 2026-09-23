import { describe, it, expect } from 'vitest'
import { matchingMove, parseActivitySummary } from '../../utils/appointmentActivity'

// The sentences fn_audit_log (0058_audit_logs.sql) writes, read back into
// facts the panel can word in either language.

describe('Appointment activity', () => {
  it('reads each sentence the trigger writes', () => {
    expect(parseActivitySummary('Created')).to.deep.equal([{ kind: 'created' }])
    expect(parseActivitySummary('Deleted')).to.deep.equal([{ kind: 'deleted' }])
    expect(parseActivitySummary('Status changed from booked to cancelled')).to.deep.equal([{ kind: 'status', from: 'booked', to: 'cancelled' }])
    expect(parseActivitySummary('Status changed from booked to no_show')).to.deep.equal([{ kind: 'status', from: 'booked', to: 'no_show' }])
  })

  it('splits several changes made at once', () => {
    expect(parseActivitySummary('Rescheduled to 25 Sep 16:00; Practitioner changed; Room changed; Type changed')).to.deep.equal([
      { kind: 'time' },
      { kind: 'practitioner' },
      { kind: 'room' },
      { kind: 'type' },
    ])
  })

  it('keeps a sentence it does not know, rather than dropping it', () => {
    expect(parseActivitySummary('Status changed from booked to cancelled; Something new')).to.deep.equal([
      { kind: 'status', from: 'booked', to: 'cancelled' },
      { kind: 'other', text: 'Something new' },
    ])
  })

  it('pairs a time change with the move written by the same click', () => {
    const moves = [
      { at: '2026-09-23T10:00:03.000Z', id: 'a' },
      { at: '2026-09-23T12:00:00.000Z', id: 'b' },
    ]
    expect(matchingMove('2026-09-23T10:00:01.000Z', moves)?.id).to.equal('a')
    expect(matchingMove('2026-09-23T11:59:30.000Z', moves)?.id).to.equal('b')
    // An edit in the panel moves the time with no reschedule row at all.
    expect(matchingMove('2026-09-23T15:00:00.000Z', moves)).to.equal(null)
  })
})

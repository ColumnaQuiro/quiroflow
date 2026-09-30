import { describe, it, expect } from 'vitest'
import { quiroflowKeeps, type AppointmentHere } from '../../utils/importAppointmentGuard'

// When a PracticeHub re-run may change a visit already here. The cases are
// Columnaquiro's, as they stood in production on 30 Sep 2026, three weeks
// after the clinic moved over and PracticeHub stopped being updated.
const here = (over: Partial<AppointmentHere> = {}): AppointmentHere => ({
  status: 'booked',
  rescheduled: false,
  checkedInAt: null,
  ...over,
})

describe('Whether QuiroFlow keeps its version of a visit', () => {
  it('keeps a completed visit that PracticeHub still has as booked a week earlier', () => {
    // 9425: moved to 22 Sep here, checked in, completed, invoiced.
    // PracticeHub: booked on 15 Sep.
    const visit = here({ status: 'completed', rescheduled: true, checkedInAt: '2026-09-22T15:40:00Z' })
    expect(quiroflowKeeps(visit, ['starts_at', 'ends_at', 'status'])).to.equal('moved_here')
  })

  it('keeps a booking moved here that PracticeHub would pull back into the past', () => {
    // 9813: booked for 1 Oct here, still on its old September date there.
    expect(quiroflowKeeps(here({ rescheduled: true }), ['starts_at', 'ends_at'])).to.equal('moved_here')
  })

  it('keeps everything about a moved visit, not only its time', () => {
    // Moving it may have been moving it to another practitioner's column.
    expect(quiroflowKeeps(here({ rescheduled: true }), ['practitioner_id', 'practitioner_name'])).to.equal('moved_here')
  })

  it('never sets a completed visit back to booked', () => {
    expect(quiroflowKeeps(here({ status: 'completed' }), ['status'])).to.equal('outcome_here')
  })

  it('never moves a visit that happened', () => {
    expect(quiroflowKeeps(here({ status: 'completed' }), ['starts_at', 'ends_at'])).to.equal('outcome_here')
    expect(quiroflowKeeps(here({ status: 'no_show' }), ['starts_at'])).to.equal('outcome_here')
  })

  it('never un-cancels a visit cancelled here', () => {
    expect(quiroflowKeeps(here({ status: 'cancelled' }), ['status'])).to.equal('outcome_here')
  })

  it('treats a check-in as an outcome even while the status still says booked', () => {
    expect(quiroflowKeeps(here({ checkedInAt: '2026-09-24T07:30:00Z' }), ['starts_at'])).to.equal('outcome_here')
  })

  it("still lets PracticeHub correct a past visit's practitioner or type", () => {
    expect(quiroflowKeeps(here({ status: 'completed' }), ['practitioner_id', 'practitioner_name', 'appointment_type_id'])).to.equal(null)
  })

  it('follows PracticeHub for a booking nobody has touched here', () => {
    // History from before the move: PracticeHub is the only record of it.
    expect(quiroflowKeeps(here(), ['starts_at', 'ends_at', 'status'])).to.equal(null)
  })

  it('has nothing to keep when the row changes nothing', () => {
    expect(quiroflowKeeps(here({ status: 'completed', rescheduled: true }), [])).to.equal(null)
  })
})

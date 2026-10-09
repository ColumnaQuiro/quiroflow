import { describe, expect, it } from 'vitest'
import { flowReport, formatFlowMinutes, summariseFlowStage, visitStages } from '../../utils/patientFlowStats'

const at = (hhmm: string) => `2026-10-09T${hhmm}:00Z`
const visit = (starts: string, checkedIn: string | null, withP: string | null, checkout: string | null, practitionerId: string | null = 'p1') => ({
  starts_at: at(starts),
  practitioner_id: practitionerId,
  checked_in_at: checkedIn ? at(checkedIn) : null,
  flow_with_practitioner_at: withP ? at(withP) : null,
  flow_checkout_at: checkout ? at(checkout) : null,
})

describe('the stages of one visit', () => {
  it('measures wait, delay, session and arrival in minutes', () => {
    // Booked 10:00, arrived 09:55, went in 10:12, out 10:40.
    expect(visitStages(visit('10:00', '09:55', '10:12', '10:40'))).toEqual({ wait: 17, delay: 12, session: 28, arrival: -5 })
  })

  it('never reports negative delay when someone is seen early', () => {
    expect(visitStages(visit('10:00', '09:40', '09:50', '10:20')).delay).toBe(0)
  })

  it('drops a stage whose stamps are out of order or hours apart, not the whole visit', () => {
    // Checkout forgotten until closing time: session dropped, wait kept.
    const s = visitStages(visit('10:00', '09:58', '10:05', '19:30'))
    expect(s.session).toBeNull()
    expect(s.wait).toBe(7)
    // With-practitioner stamped before check-in.
    expect(visitStages(visit('10:00', '10:05', '10:01', '10:30')).wait).toBeNull()
  })

  it('leaves out what was not stamped', () => {
    expect(visitStages(visit('10:00', '09:58', null, null))).toEqual({ wait: null, delay: null, session: null, arrival: -2 })
  })
})

describe('the report', () => {
  it('summarises averages, medians and the distribution', () => {
    const s = summariseFlowStage([2, 4, 6, 12, 30])
    expect(s.count).toBe(5)
    expect(s.average).toBeCloseTo(10.8)
    expect(s.median).toBe(6)
    expect(s.buckets).toEqual([0.4, 0.2, 0.2, 0, 0.2])
  })

  it('counts only checked-in visits, groups by practitioner, and gives the on-time share', () => {
    const r = flowReport([
      visit('10:00', '09:55', '10:02', '10:30', 'p1'),
      visit('11:00', '10:58', '11:20', '11:45', 'p1'),
      visit('12:00', '11:59', '12:04', '12:30', 'p2'),
      visit('13:00', null, null, null, 'p2'), // never checked in: not part of the flow
    ])
    expect(r.tracked).toBe(3)
    expect(r.onTime).toBeCloseTo(2 / 3)
    expect(r.byPractitioner[0]).toMatchObject({ practitionerId: 'p1', visits: 2, wait: 14.5, delay: 11, session: 26.5 })
    expect(r.byPractitioner[1]).toMatchObject({ practitionerId: 'p2', visits: 1, wait: 5 })
  })

  it('is empty, not zero, with nothing to measure', () => {
    const r = flowReport([])
    expect(r.tracked).toBe(0)
    expect(r.onTime).toBeNull()
    expect(r.stages.wait.average).toBeNull()
  })
})

describe('formatting minutes', () => {
  it('reads as minutes, then hours', () => {
    expect(formatFlowMinutes(4.4)).toBe('4 min')
    expect(formatFlowMinutes(65)).toBe('1 h 05 min')
    expect(formatFlowMinutes(-3)).toBe('-3 min')
    expect(formatFlowMinutes(null)).toBe('–')
  })
})

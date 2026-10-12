import { describe, it, expect } from 'vitest'
import { cohortRetention, rebookingByPractitioner, retentionPct, winBackStats, type RetentionVisit } from '../../utils/retentionStats'

// The Retention report (utils/retentionStats.ts): who came back, by the month
// they first came, and who left each practitioner with the next visit booked.
const tz = 'Europe/Madrid'
const v = (patient: string, starts: string, extra: Partial<RetentionVisit> = {}): RetentionVisit => ({
  patient_id: patient,
  practitioner_id: 'ana',
  starts_at: starts,
  ends_at: new Date(Date.parse(starts) + 30 * 60_000).toISOString(),
  status: 'completed',
  created_at: new Date(Date.parse(starts) - 7 * 86_400_000).toISOString(),
  ...extra,
})

describe('Retention by the month of the first visit', () => {
  const now = new Date('2026-10-11T10:00:00Z')
  const opts = { from: new Date('2026-01-01T00:00:00Z'), to: now, now, timeZone: tz }

  it('counts who came back, and who was still coming at 90 and 180 days', () => {
    const visits = [
      // March: came back, and still coming after 90 and 180 days.
      v('p1', '2026-03-02T09:00:00Z'), v('p1', '2026-03-09T09:00:00Z'), v('p1', '2026-09-20T09:00:00Z'),
      // March: one visit only.
      v('p2', '2026-03-15T09:00:00Z'),
      // September: too recent for 90 days.
      v('p3', '2026-09-01T09:00:00Z'), v('p3', '2026-09-08T09:00:00Z'),
    ]
    const rows = cohortRetention(visits, opts)
    expect(rows.map((r) => r.month)).toEqual(['2026-03', '2026-09'])
    expect(rows[0]).toMatchObject({ patients: 2, cameBack: 1, at90: { of: 2, still: 1 }, at180: { of: 2, still: 1 } })
    expect(rows[1]).toMatchObject({ patients: 1, cameBack: 1, at90: null, at180: null })
  })

  it('does not count a returning patient as new', () => {
    const visits = [v('p1', '2025-06-01T09:00:00Z'), v('p1', '2026-04-01T09:00:00Z')]
    expect(cohortRetention(visits, opts)).toEqual([])
  })

  it('ignores cancelled and missed visits', () => {
    expect(cohortRetention([v('p1', '2026-05-01T09:00:00Z', { status: 'cancelled' })], opts)).toEqual([])
  })
})

describe('Rebooking by practitioner', () => {
  const now = new Date('2026-10-11T10:00:00Z')
  const opts = { from: new Date('2026-08-01T00:00:00Z'), to: now, now }

  it('counts a visit that left with the next one booked, and who came back within 30 days', () => {
    const first = v('p1', '2026-08-03T09:00:00Z')
    const visits = [
      first,
      // Booked during the first visit, and attended 10 days later.
      v('p1', '2026-08-13T09:00:00Z', { created_at: '2026-08-03T09:20:00Z' }),
      // A visit with nothing after it.
      v('p2', '2026-08-05T09:00:00Z', { practitioner_id: 'luis' }),
    ]
    const rows = rebookingByPractitioner(visits, opts)
    const ana = rows.find((r) => r.practitionerId === 'ana')!
    expect(ana.visits).toBe(2)
    expect(ana.rebooked).toBe(1)
    expect(ana.cameBack30).toEqual({ of: 2, came: 1 })
    const luis = rows.find((r) => r.practitionerId === 'luis')!
    expect(luis).toMatchObject({ visits: 1, rebooked: 0, cameBack30: { of: 1, came: 0 } })
  })

  it('does not count a cancelled next visit, or one booked days later, as rebooked at the visit', () => {
    const visits = [
      v('p1', '2026-08-03T09:00:00Z'),
      v('p1', '2026-08-20T09:00:00Z', { created_at: '2026-08-03T09:10:00Z', status: 'cancelled' }),
      v('p1', '2026-08-25T09:00:00Z', { created_at: '2026-08-10T10:00:00Z', status: 'booked' }),
    ]
    expect(rebookingByPractitioner(visits, opts)[0]!.rebooked).toBe(0)
  })

  it('leaves visits under 30 days old out of "came back within 30 days"', () => {
    const rows = rebookingByPractitioner([v('p1', '2026-10-01T09:00:00Z')], opts)
    expect(rows[0]!.cameBack30).toEqual({ of: 0, came: 0 })
  })
})

describe('Percentages', () => {
  it('rounds, and says nothing when there is nothing to divide by', () => {
    expect(retentionPct(1, 3)).toBe(33)
    expect(retentionPct(0, 0)).toBe(null)
  })
})

describe('winBackStats', () => {
  const now = new Date('2026-10-12T10:00:00Z')
  const opts = { from: new Date('2026-07-01T00:00:00Z'), to: new Date('2026-10-13T00:00:00Z'), now }
  it('counts each contacted patient once, booked if they booked within 30 days of the first contact', () => {
    const s = winBackStats(
      [
        { patient_id: 'a', created_at: '2026-08-01T10:00:00Z' },
        { patient_id: 'a', created_at: '2026-08-20T10:00:00Z' },
        { patient_id: 'b', created_at: '2026-08-01T10:00:00Z' },
        { patient_id: 'c', created_at: '2026-10-05T10:00:00Z' },
        { patient_id: 'old', created_at: '2026-05-01T10:00:00Z' },
      ],
      [
        { patient_id: 'a', created_at: '2026-08-10T10:00:00Z' },
        // Too late to put down to the contact.
        { patient_id: 'b', created_at: '2026-09-15T10:00:00Z' },
        { patient_id: 'old', created_at: '2026-05-02T10:00:00Z' },
      ],
      opts,
    )
    expect(s).toEqual({ contacted: 3, booked: 1, waiting: 1 })
  })
  it('does not count a booking made before the contact', () => {
    const s = winBackStats([{ patient_id: 'a', created_at: '2026-08-10T10:00:00Z' }], [{ patient_id: 'a', created_at: '2026-08-09T10:00:00Z' }], opts)
    expect(s).toEqual({ contacted: 1, booked: 0, waiting: 0 })
  })
})

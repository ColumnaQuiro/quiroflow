import { describe, it, expect } from 'vitest'
import { careStopCounts, type CareStopRow } from '../../utils/retentionStats'

// Reasons for stopping care in Reports > Retention (careStopCounts).
const s = (reason: string | null, at: string, extra: Partial<CareStopRow> = {}): CareStopRow => ({ reason_id: reason, practitioner_id: 'ana', clinic_id: 'centro', recorded_at: at, ...extra })
const range = { from: new Date('2026-07-01T00:00:00Z'), to: new Date('2026-09-30T23:59:59Z') }

describe('careStopCounts', () => {
  const stops = [
    s('precio', '2026-07-03T10:00:00Z'),
    s('precio', '2026-08-03T10:00:00Z', { practitioner_id: 'luis' }),
    s('verano', '2026-08-10T10:00:00Z', { clinic_id: 'norte' }),
    s(null, '2026-09-01T10:00:00Z'),
    s('precio', '2026-06-30T10:00:00Z'),
    s('verano', '2026-10-01T10:00:00Z'),
  ]

  it('counts the period only, most common reason first, a deleted reason included', () => {
    const r = careStopCounts(stops, range)
    expect(r.total).toBe(4)
    expect(r.byReason).toEqual([
      { reasonId: 'precio', count: 2 },
      { reasonId: 'verano', count: 1 },
      { reasonId: null, count: 1 },
    ])
  })

  it('splits by practitioner', () => {
    const r = careStopCounts(stops, range)
    expect(r.byPractitioner.map((p) => [p.practitionerId, p.total])).toEqual([
      ['ana', 3],
      ['luis', 1],
    ])
  })

  it('narrows to a practitioner and a clinic', () => {
    expect(careStopCounts(stops, { ...range, practitionerId: 'luis' }).total).toBe(1)
    expect(careStopCounts(stops, { ...range, clinicId: 'norte' }).byReason).toEqual([{ reasonId: 'verano', count: 1 }])
  })
})

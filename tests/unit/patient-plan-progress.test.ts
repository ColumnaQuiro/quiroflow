import { describe, expect, it } from 'vitest'
import { patientPlanProgress } from '../../utils/patientPlanProgress'

const plan = { total_visits: 6, started_at: '2026-09-01T00:00:00Z' }
const now = new Date('2026-10-11T12:00:00Z')
const v = (id: string, starts_at: string, status: string) => ({ id, starts_at, status })

describe('patientPlanProgress', () => {
  it('counts attended visits since the plan started, and the booked ones still ahead', () => {
    const p = patientPlanProgress(plan, [
      v('before', '2026-08-20T10:00:00Z', 'completed'),
      v('a', '2026-09-03T10:00:00Z', 'completed'),
      v('b', '2026-09-10T10:00:00Z', 'completed'),
      v('missed', '2026-09-17T10:00:00Z', 'no_show'),
      v('later', '2026-10-25T10:00:00Z', 'booked'),
      v('soon', '2026-10-18T10:00:00Z', 'booked'),
      v('gone', '2026-10-20T10:00:00Z', 'cancelled'),
    ], now)
    expect(p.done).toBe(2)
    expect(p.left).toBe(4)
    expect(p.booked.map((x) => x.id)).toEqual(['soon', 'later'])
    expect(p.toBook).toBe(2)
    expect(p.pct).toBe(33)
  })

  it('does not count a booked visit already in the past as ahead', () => {
    const p = patientPlanProgress(plan, [v('stale', '2026-10-01T10:00:00Z', 'booked')], now)
    expect(p.booked).toEqual([])
    expect(p.toBook).toBe(6)
  })

  it('reads a finished plan as nothing left, even past its total', () => {
    const visits = Array.from({ length: 7 }, (_, i) => v(`x${i}`, `2026-09-${String(i + 2).padStart(2, '0')}T10:00:00Z`, 'completed'))
    const p = patientPlanProgress(plan, visits, now)
    expect(p.left).toBe(0)
    expect(p.toBook).toBe(0)
    expect(p.pct).toBe(100)
  })
})

import { describe, expect, it } from 'vitest'
import { carePlanPeriods, periodWindow, planOnTrack } from '../../utils/carePlanPeriods'

// Started Monday 5 Oct 2026; "today" is Wednesday 21 Oct (week 3).
const plan = { started_at: '2026-10-05', frequency_value: 1, frequency_unit: 'week', visits_per_period: 2, total_visits: 10 }
const today = '2026-10-21'

describe('a care plan, period by period', () => {
  it('splits it into periods of N visits from the start', () => {
    const p = carePlanPeriods(plan, [], today)
    expect(p.map((x) => [x.start, x.end, x.expected])).toEqual([
      ['2026-10-05', '2026-10-11', 2],
      ['2026-10-12', '2026-10-18', 2],
      ['2026-10-19', '2026-10-25', 2],
      ['2026-10-26', '2026-11-01', 2],
      ['2026-11-02', '2026-11-08', 2],
    ])
    expect(p[2].isCurrent).toBe(true)
  })

  it('says how each went, and whether the plan is on track', () => {
    const visits = [
      { day: '2026-10-05', status: 'completed' },
      { day: '2026-10-08', status: 'completed' }, // week 1 done
      { day: '2026-10-13', status: 'completed' }, // week 2: one short, over -> behind
      { day: '2026-10-20', status: 'completed' },
      { day: '2026-10-23', status: 'booked' }, // week 3: the rest booked -> scheduled
      { day: '2026-11-03', status: 'booked' }, // week 5: something booked
      { day: '2026-10-15', status: 'cancelled' },
    ]
    const p = carePlanPeriods(plan, visits, today)
    expect(p.map((x) => x.status)).toEqual(['completed', 'behind', 'scheduled', 'unscheduled', 'scheduled'])
    expect(p[0]).toMatchObject({ completed: 2, booked: 0 })
    expect(planOnTrack(p)).toBe(false)
    expect(planOnTrack(p.filter((x) => x.index !== 1))).toBe(true)
  })

  it('marks the current period as current until it falls short', () => {
    expect(carePlanPeriods(plan, [{ day: '2026-10-19', status: 'completed' }], today)[2].status).toBe('current')
  })

  it('handles intervals, months and a short last period', () => {
    const p = carePlanPeriods({ started_at: '2026-01-31', frequency_value: 1, frequency_unit: 'month', total_visits: 3 }, [], '2026-01-31')
    expect(p.map((x) => [x.start, x.end])).toEqual([['2026-01-31', '2026-02-27'], ['2026-02-28', '2026-03-30'], ['2026-03-31', '2026-04-29']])
    const q = carePlanPeriods({ started_at: '2026-10-05', frequency_value: 2, frequency_unit: 'week', visits_per_period: 2, total_visits: 5 }, [], today)
    expect(q.map((x) => x.expected)).toEqual([2, 2, 1])
    expect(q[1]).toMatchObject({ start: '2026-10-19', end: '2026-11-01' })
  })

  it('shows a window around now', () => {
    const long = carePlanPeriods({ ...plan, total_visits: 40 }, [], today)
    expect(periodWindow(long).map((x) => x.index)).toEqual([1, 2, 3, 4, 5, 6])
    expect(periodWindow(long.slice(0, 4)).length).toBe(4)
  })
})

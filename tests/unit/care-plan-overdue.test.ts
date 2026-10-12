import { describe, expect, it } from 'vitest'
import { carePlanOverdueDays } from '../../utils/carePlanOverdue'

// "Behind on their care plan" for automations (utils/carePlanOverdue.ts): the
// care_plan_continuity_alerts rule, restated for the service role.
const now = new Date('2026-10-12T10:00:00Z')
const plan = { created_at: '2026-08-01T00:00:00Z', started_at: '2026-08-01', total_visits: 10, frequency_value: 1, frequency_unit: 'week', visits_per_period: 1 }
const v = (starts_at: string, status = 'completed') => ({ starts_at, status })

describe('carePlanOverdueDays', () => {
  it('counts from the last completed visit plus the gap', () => {
    // Last visit 12 Sep, weekly: due 19 Sep, 23 days ago.
    expect(carePlanOverdueDays([plan], [v('2026-09-05T09:00:00Z'), v('2026-09-12T09:00:00Z')], now)).toBe(23)
  })
  it('is not behind with anything booked ahead, a finished plan, or no visit yet', () => {
    expect(carePlanOverdueDays([plan], [v('2026-09-12T09:00:00Z'), v('2026-10-15T09:00:00Z', 'booked')], now)).toBeNull()
    expect(carePlanOverdueDays([{ ...plan, total_visits: 1 }], [v('2026-09-12T09:00:00Z')], now)).toBeNull()
    expect(carePlanOverdueDays([plan], [], now)).toBeNull()
  })
  it('ignores a cancelled visit ahead and visits before the plan started', () => {
    expect(carePlanOverdueDays([plan], [v('2026-07-01T09:00:00Z'), v('2026-09-12T09:00:00Z'), v('2026-10-15T09:00:00Z', 'cancelled')], now)).toBe(23)
    expect(carePlanOverdueDays([plan], [v('2026-07-01T09:00:00Z')], now)).toBeNull()
  })
  it('reads the latest plan, with its own cadence', () => {
    const newer = { ...plan, created_at: '2026-09-01T00:00:00Z', started_at: '2026-09-01', frequency_value: 2 }
    // Every 2 weeks from 12 Sep: due 26 Sep, 16 days ago.
    expect(carePlanOverdueDays([plan, newer], [v('2026-09-12T09:00:00Z')], now)).toBe(16)
  })
  it('is not behind on the day it is due', () => {
    expect(carePlanOverdueDays([plan], [v('2026-10-05T09:00:00Z')], now)).toBeNull()
  })
})

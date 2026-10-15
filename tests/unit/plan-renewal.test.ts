import { describe, expect, it } from 'vitest'
import { renewalDue, renewalPreset } from '../../utils/planRenewal'

describe('renewalDue', () => {
  it('flags a plan with two visits or fewer left, and not one without visits', () => {
    expect(renewalDue({ total_visits: 12 }, 9)).toBe(false)
    expect(renewalDue({ total_visits: 12 }, 10)).toBe(true)
    expect(renewalDue({ total_visits: 12 }, 12)).toBe(true)
    expect(renewalDue({ total_visits: 0 }, 0)).toBe(false)
  })
})

describe('renewalPreset', () => {
  const current = { frequency_value: 1, frequency_unit: 'week', visits_per_period: 2, total_visits: 12 }
  it('fills maintenance, the same plan again, or discharge', () => {
    expect(renewalPreset('maintenance', current)).toMatchObject({ frequency_value: 3, frequency_unit: 'week', visits_per_period: 1, total_visits: 8 })
    expect(renewalPreset('same', current)).toMatchObject({ frequency_value: 1, visits_per_period: 2, total_visits: 12 })
    expect(renewalPreset('discharge', current).total_visits).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { staffSectionIncluded } from '../../utils/growthPlans'
import { leaveCarryIn, type TeamAbsence } from '../../utils/teamLeave'

const absence = (over: Partial<TeamAbsence>): TeamAbsence => ({ id: 'a', team_member_id: 'ana', kind: 'vacation', starts_on: '2025-08-04', ends_on: '2025-08-15', half_day: false, status: 'approved', ...over })

describe('holiday carried over', () => {
  it('is what was left of last year, up to the clinic’s limit', () => {
    // Ten working days taken of 22: 12 left, 5 carry.
    expect(leaveCarryIn([absence({})], 22, 2026, new Set(), 5)).toBe(5)
    // Twenty taken: 2 left, 2 carry.
    expect(leaveCarryIn([absence({}), absence({ id: 'b', starts_on: '2025-09-01', ends_on: '2025-09-12' })], 22, 2026, new Set(), 5)).toBe(2)
  })
  it('carries nothing when the clinic does not allow it, or nothing was left', () => {
    expect(leaveCarryIn([], 22, 2026, new Set(), 0)).toBe(0)
    expect(leaveCarryIn([absence({ starts_on: '2025-01-01', ends_on: '2025-12-31' })], 22, 2026, new Set(), 5)).toBe(0)
  })
  it('counts only approved holiday inside last year, closures left out', () => {
    const list = [
      absence({ status: 'pending' }),
      absence({ id: 's', kind: 'sick' }),
      // 29 Dec 2025 – 2 Jan 2026: three working days in 2025, one of them closed.
      absence({ id: 'ny', starts_on: '2025-12-29', ends_on: '2026-01-02' }),
    ]
    expect(leaveCarryIn(list, 3, 2026, new Set(['2025-12-31']), 10)).toBe(1)
  })
})

describe('who gets Personal', () => {
  it('Practice and Clinic, a trial, or a comped account; not Solo', () => {
    expect(staffSectionIncluded({ plan_id: 'pro', status: 'active' })).toBe(true)
    expect(staffSectionIncluded({ plan_id: 'clinic', status: 'past_due' })).toBe(true)
    expect(staffSectionIncluded({ plan_id: 'starter', status: 'active' })).toBe(false)
    expect(staffSectionIncluded({ plan_id: 'starter', status: 'trialing' })).toBe(true)
    expect(staffSectionIncluded({ plan_id: 'starter', status: 'active', comped: true })).toBe(true)
    expect(staffSectionIncluded({ plan_id: 'pro', status: 'canceled' })).toBe(false)
    expect(staffSectionIncluded(null)).toBe(false)
  })
})

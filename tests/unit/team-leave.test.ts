import { describe, expect, it } from 'vitest'
import { absenceInYear, clinicClosedDays, daysOfYear, leaveOverlaps, teamLeaveBalance, type TeamAbsence } from '../../utils/teamLeave'

// The team's leave across a year (utils/teamLeave.ts), behind Personal.
const absence = (over: Partial<TeamAbsence>): TeamAbsence => ({ id: 'a', team_member_id: 'ana', kind: 'vacation', starts_on: '2026-08-03', ends_on: '2026-08-07', half_day: false, status: 'approved', ...over })

describe('daysOfYear', () => {
  it('lists every day, leap years included', () => {
    expect(daysOfYear(2026)).toHaveLength(365)
    expect(daysOfYear(2028)).toHaveLength(366)
    expect(daysOfYear(2026)[0]).toBe('2026-01-01')
    expect(daysOfYear(2026).at(-1)).toBe('2026-12-31')
  })
})

describe('clinicClosedDays', () => {
  it('turns whole-clinic blocks into clinic calendar days', () => {
    // 6 Jan 2026 in Madrid: 23:00 UTC on the 5th to 23:00 UTC on the 6th.
    expect([...clinicClosedDays([{ starts_at: '2026-01-05T23:00:00Z', ends_at: '2026-01-06T23:00:00Z' }], 'Europe/Madrid')]).toEqual(['2026-01-06'])
  })
})

describe('absenceInYear', () => {
  it('clips an absence to the year, and leaves out one outside it', () => {
    expect(absenceInYear({ starts_on: '2025-12-29', ends_on: '2026-01-02' }, 2026)).toEqual({ from: '2026-01-01', to: '2026-01-02' })
    expect(absenceInYear({ starts_on: '2026-11-02', ends_on: '2999-12-31' }, 2026)).toEqual({ from: '2026-11-02', to: '2026-12-31' })
    expect(absenceInYear({ starts_on: '2025-03-02', ends_on: '2025-03-06' }, 2026)).toBeNull()
  })
})

describe('teamLeaveBalance', () => {
  it('counts working days taken, still to come and pending, and only holiday', () => {
    const list = [
      absence({ starts_on: '2026-08-03', ends_on: '2026-08-07' }), // 5, taken
      absence({ starts_on: '2026-12-21', ends_on: '2026-12-23' }), // 3, to come
      absence({ starts_on: '2026-12-28', ends_on: '2026-12-28', half_day: true, status: 'pending' }), // 0.5, pending
      absence({ kind: 'sick', starts_on: '2026-09-01', ends_on: '2026-09-04' }), // not holiday
      absence({ status: 'rejected', starts_on: '2026-10-05', ends_on: '2026-10-09' }),
    ]
    expect(teamLeaveBalance(list, 22, 2026, '2026-11-09', new Set())).toEqual({ allowance: 22, taken: 5, coming: 3, pending: 0.5, left: 14 })
  })

  it('leaves out closed days, and the days that fall in another year', () => {
    const list = [absence({ starts_on: '2026-12-28', ends_on: '2027-01-08' })]
    // 28-31 Dec is four working days; the clinic shuts on the 31st.
    expect(teamLeaveBalance(list, 22, 2026, '2026-11-09', new Set(['2026-12-31'])).coming).toBe(3)
    // 1-8 Jan 2027: six working days.
    expect(teamLeaveBalance(list, 22, 2027, '2026-11-09', new Set()).coming).toBe(6)
  })
})

describe('leaveOverlaps', () => {
  const practitioners = new Set(['ana', 'luis', 'eva'])
  it('finds working days two or more practitioners are away, pending included', () => {
    const list = [
      absence({ team_member_id: 'ana', starts_on: '2026-08-03', ends_on: '2026-08-07' }),
      absence({ team_member_id: 'luis', starts_on: '2026-08-06', ends_on: '2026-08-10', status: 'pending' }),
      absence({ team_member_id: 'eva', starts_on: '2026-08-07', ends_on: '2026-08-07', half_day: true }),
    ]
    const overlaps = leaveOverlaps(list, practitioners, 2026, new Set())
    expect([...overlaps.keys()].sort()).toEqual(['2026-08-06', '2026-08-07'])
    expect(overlaps.get('2026-08-07')!.sort()).toEqual(['ana', 'luis'])
  })

  it('ignores the front desk, weekends, closed days and rejected requests', () => {
    const list = [
      absence({ team_member_id: 'ana', starts_on: '2026-08-07', ends_on: '2026-08-10' }),
      absence({ team_member_id: 'desk', starts_on: '2026-08-07', ends_on: '2026-08-10' }),
      absence({ team_member_id: 'luis', starts_on: '2026-08-08', ends_on: '2026-08-10' }),
      absence({ team_member_id: 'eva', starts_on: '2026-08-07', ends_on: '2026-08-07', status: 'rejected' }),
    ]
    // 8-9 Aug is a weekend and the 10th is closed: nothing left.
    expect(leaveOverlaps(list, practitioners, 2026, new Set(['2026-08-10'])).size).toBe(0)
  })
})

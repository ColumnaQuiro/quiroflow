import { describe, it, expect } from 'vitest'
import { pregnancyProgress, pregnancyWeeksLabel } from '../../utils/pregnancy'

// Weeks and trimester are counted from the due date (40 weeks = 280 days).

describe('pregnancyProgress', () => {
  it('counts weeks and days back from the due date', () => {
    // 280 - 109 = 171 days = 24 weeks + 3 days.
    const p = pregnancyProgress('2027-02-07', '2026-10-21')
    expect(p.daysToDue).toBe(109)
    expect([p.weeks, p.days]).toEqual([24, 3])
    expect(p.trimester).toBe(2)
    expect(pregnancyWeeksLabel(p, (en) => en)).toBe('24+3 wk')
  })

  it('places the trimester boundaries at 14 and 28 weeks', () => {
    // 13+6 and 14+0.
    expect(pregnancyProgress('2027-04-22', '2026-10-21').trimester).toBe(1)
    expect(pregnancyProgress('2027-04-21', '2026-10-21').trimester).toBe(2)
    expect(pregnancyProgress('2026-12-30', '2026-10-21').weeks).toBe(30)
    expect(pregnancyProgress('2026-12-30', '2026-10-21').trimester).toBe(3)
  })

  it('stays at full term on and past the due date', () => {
    const p = pregnancyProgress('2026-10-14', '2026-10-21')
    expect(p.daysToDue).toBe(-7)
    expect(p.fraction).toBe(1)
    expect(p.weeks).toBe(41)
  })
})

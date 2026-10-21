import { describe, expect, it } from 'vitest'
import { trendLayout, trendMax, trendSeries, trendSummary, trendValue } from '../../utils/postureTrend'
import type { FrontMetrics, SideMetrics } from '../../utils/posture'

const front = (m: Partial<FrontMetrics> = {}): FrontMetrics => ({ headTilt: 0, shoulderTilt: 0, hipTilt: 0, headShift: 0, shoulderShift: 0, hipShift: 0, ...m })
const side = (m: Partial<SideMetrics> = {}): SideMetrics => ({ earForward: 0, shoulderForward: 0, hipForward: 0, kneeForward: 0, headAngle: 0, headWeight: 5.4, ...m })

describe('trendValue', () => {
  it('plots tilts by size, whichever side, and the knee that bends more', () => {
    expect(trendValue({ front: front({ shoulderTilt: -2.5 }) }, 'shoulderTilt')).toBe(2.5)
    expect(trendValue({ front: front({ kneeAngleR: 1.2, kneeAngleL: -3.4 }) }, 'knees')).toBe(3.4)
    expect(trendValue({ front: front() }, 'knees')).toBeNull()
    expect(trendValue({ front: front() }, 'headWeight')).toBeNull()
  })
})

describe('trendSeries', () => {
  it('keeps the assessments that measured it, oldest first', () => {
    const series = trendSeries([
      { takenAt: '2026-09-01', metrics: { right: side({ headWeight: 13.4 }) } },
      { takenAt: '2026-06-01', metrics: { right: side({ headWeight: 21.1 }) } },
      { takenAt: '2026-07-01', metrics: { front: front() } },
    ], 'headWeight')
    expect(series).toEqual([{ takenAt: '2026-06-01', value: 21.1 }, { takenAt: '2026-09-01', value: 13.4 }])
  })
})

describe('trendLayout', () => {
  it('puts the top above every value and the ideal, and 0 at the bottom', () => {
    expect(trendMax([21.1, 12.2], 5.4)).toBe(25)
    expect(trendMax([1.8, 3.4], 0)).toBe(4)
    const l = trendLayout([{ takenAt: 'a', value: 4 }, { takenAt: 'b', value: 2 }], 0, { width: 100, height: 100, left: 10, right: 10, top: 10, bottom: 10 })
    expect(l.max).toBe(5)
    expect(l.points.map((p) => [p.x, p.y])).toEqual([[10, 26], [90, 58]])
    expect(l.idealY).toBe(90)
  })
})

describe('trendSummary', () => {
  it('measures the way towards aligned, not just the change', () => {
    expect(trendSummary([{ takenAt: 'a', value: 21.1 }, { takenAt: 'b', value: 12.2 }], 5.4)).toEqual({ delta: -8.9, better: true, share: 57 })
    expect(trendSummary([{ takenAt: 'a', value: 1 }, { takenAt: 'b', value: 2 }], 0)).toEqual({ delta: 1, better: false, share: null })
    expect(trendSummary([{ takenAt: 'a', value: 1 }], 0)).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import {
  BLIND_SPOT_CENTRE,
  blindSpotAngles,
  blindSpotArea,
  blindSpotAsymmetry,
  blindSpotContour,
  blindSpotScreenOffset,
  blindSpotTrials,
  clampBlindSpotPoints,
  degToMm,
  formatBlindSpotArea,
  type BlindSpotPoint,
} from '../../utils/blindSpot'
import { blindSpotIncluded, blindSpotOnlyAllows } from '../../utils/blindSpotPlan'

function circle(n: number, r: number): BlindSpotPoint[] {
  return blindSpotAngles(n).map((angle) => ({ angle, r }))
}

describe('blind spot points', () => {
  it('never measures fewer than four directions, and spreads them evenly from the temple', () => {
    expect(clampBlindSpotPoints(2)).toBe(4)
    expect(clampBlindSpotPoints(6.4)).toBe(6)
    expect(clampBlindSpotPoints(Number.NaN)).toBe(8)
    expect(blindSpotAngles(4)).toEqual([0, 90, 180, 270])
    expect(blindSpotAngles(1)).toHaveLength(4)
  })
})

describe('blind spot area', () => {
  it('comes from the drawn curve, close to the true area even with four points', () => {
    const truth = Math.PI * 3 * 3
    expect(Math.abs(blindSpotArea(circle(4, 3))! - truth) / truth).toBeLessThan(0.01)
    expect(Math.abs(blindSpotArea(circle(16, 3))! - truth) / truth).toBeLessThan(0.01)
    // A typical blind spot, 5.5° x 7.5°, from four directions and from sixteen.
    const ellipse = (n: number) => blindSpotAngles(n).map((angle) => {
      const t = (angle * Math.PI) / 180
      return { angle, r: (2.75 * 3.75) / Math.hypot(3.75 * Math.cos(t), 2.75 * Math.sin(t)) }
    })
    const ellipseTruth = Math.PI * 2.75 * 3.75
    expect(Math.abs(blindSpotArea(ellipse(4))! - ellipseTruth) / ellipseTruth).toBeLessThan(0.05)
    expect(Math.abs(blindSpotArea(ellipse(16))! - ellipseTruth) / ellipseTruth).toBeLessThan(0.01)
  })

  it('leaves out directions the patient never saw, and gives up below three', () => {
    const pts: BlindSpotPoint[] = [{ angle: 0, r: 3 }, { angle: 90, r: null }, { angle: 180, r: 3 }, { angle: 270, r: 3 }]
    expect(blindSpotContour(pts).length).toBeGreaterThan(0)
    expect(blindSpotArea([{ angle: 0, r: 3 }, { angle: 180, r: 3 }, { angle: 90, r: null }])).toBeNull()
  })

  it('is centred where the blind spot is, towards the temple', () => {
    const c = blindSpotContour(circle(8, 2))
    const meanX = c.reduce((s, p) => s + p[0], 0) / c.length
    expect(meanX).toBeCloseTo(BLIND_SPOT_CENTRE.x, 0)
  })
})

describe('asymmetry', () => {
  it('says how much bigger the larger one is than the smaller, and which eye', () => {
    expect(blindSpotAsymmetry(31.5, 38.7)).toEqual({ percent: 23, larger: 'left' })
    expect(blindSpotAsymmetry(30, 30)).toEqual({ percent: 0, larger: null })
    expect(blindSpotAsymmetry(null, 30)).toBeNull()
  })
})

describe('on screen', () => {
  it('puts the right eye’s blind spot right of the cross and the left eye’s left of it', () => {
    expect(blindSpotScreenOffset('right', [15.5, 0], 50, 4).dx).toBeGreaterThan(0)
    expect(blindSpotScreenOffset('left', [15.5, 0], 50, 4).dx).toBeLessThan(0)
    // Below the horizontal meridian is further down the screen.
    expect(blindSpotScreenOffset('right', [15.5, -1.5], 50, 4).dy).toBeGreaterThan(0)
    expect(degToMm(15.5, 50)).toBeCloseTo(138.7, 0)
  })

  it('mixes catch trials into the directions', () => {
    const trials = blindSpotTrials(8, 2, () => 0.5)
    expect(trials).toHaveLength(10)
    expect(trials.filter((t) => t.kind === 'catch')).toHaveLength(2)
  })

  it('writes areas with one decimal and no grouping', () => {
    expect(formatBlindSpotArea(34)).toBe('34,0')
    expect(formatBlindSpotArea(null)).toBe('—')
  })
})

describe('who has it', () => {
  it('follows the plan, the add-on, the trial and comped, and stops when locked', () => {
    expect(blindSpotIncluded({ status: 'active', plan_id: 'starter' })).toBe(false)
    expect(blindSpotIncluded({ status: 'active', plan_id: 'starter', blind_spot_addon: true })).toBe(true)
    expect(blindSpotIncluded({ status: 'active', plan_id: 'blind_spot' })).toBe(true)
    expect(blindSpotIncluded({ status: 'trialing', plan_id: 'starter' })).toBe(true)
    expect(blindSpotIncluded({ status: 'locked', plan_id: 'blind_spot' })).toBe(false)
    expect(blindSpotIncluded({ status: 'locked', comped: true })).toBe(true)
  })

  it('keeps a Blind Spot-only account to its own pages', () => {
    expect(blindSpotOnlyAllows('/blind-spot')).toBe(true)
    expect(blindSpotOnlyAllows('/patients/abc')).toBe(true)
    expect(blindSpotOnlyAllows('/patients/import')).toBe(false)
    expect(blindSpotOnlyAllows('/subscription')).toBe(true)
    expect(blindSpotOnlyAllows('/calendar')).toBe(false)
    expect(blindSpotOnlyAllows('/settings/services')).toBe(false)
  })
})

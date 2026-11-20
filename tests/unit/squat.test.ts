import { describe, expect, it } from 'vitest'
import { EXERCISE_CATALOG } from '../../utils/exerciseCatalog'
import { alignmentIndex, angleAt, deviceTilt, EAR_HEIGHT_RATIO, measureAll, measureView, postureBalance, postureCallouts, qAngleDefaults, straighten, type Points, type StoredView } from '../../utils/posture'
import { postureSuggestions, squatSuggestions, suggestedSlugs } from '../../utils/postureSuggestions'
import { measureSquat, measureSquatFront, measureSquatSide, photoPointNames, squatCallouts, squatDefaultPoints, squatHeadline, squatPointsFromLandmarks, squatPxPerCm, squatTrendValue, squatViewsFor } from '../../utils/squat'

// A 170 cm patient photographed so that ear-to-ankle is 1591.2 px: exactly
// 10 px per cm, as in posture.test.ts, so the numbers can be checked by hand.
const H = 170
const EAR_Y = 100
const ANKLE_Y = EAR_Y + EAR_HEIGHT_RATIO * H * 10
const view = (points: Points, facing: 'right' | 'left' | null = null, tilt: number | null = null): StoredView => ({ photo: 'x.jpg', width: 1000, height: 1800, points, facing, tilt })

const turn = (p: Points, deg: number): Points => {
  const a = (deg * Math.PI) / 180
  return Object.fromEntries(Object.entries(p).map(([k, [x, y]]) => [k, [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]]))
}

describe('camera tilt', () => {
  const side: Points = { ear: [540, EAR_Y], shoulder: [520, EAR_Y + 34.64], hip: [505, 900], knee: [503, 1300], ankle: [500, ANKLE_Y] }
  it('turning the points by the tilt and back gives the same measurements', () => {
    const straight = measureView('right', side, H, 'right')
    const tilted = turn(side, 4)
    expect(measureView('right', tilted, H, 'right', 4)).toEqual(straight)
    // Read as if straight, the 4° shows as a lean the patient does not have.
    expect((measureView('right', tilted, H, 'right') as any).hipForward).not.toBe((straight as any).hipForward)
  })
  it('a vertical leaning clockwise by the tilt comes out vertical', () => {
    const top = [Math.sin((5 * Math.PI) / 180) * 100, -Math.cos((5 * Math.PI) / 180) * 100] as [number, number]
    const p = straighten({ a: [0, 0], b: top }, 5)
    expect(Math.abs(p.b![0])).toBeLessThan(1e-9)
  })
  it('reads the device’s roll the same from iOS (gravity) and Android (its reaction)', () => {
    // Turned 5° clockwise as the practitioner sees it: Android reports the
    // reaction to gravity, up the device's y axis, a little to its left.
    const s = Math.sin((5 * Math.PI) / 180) * 9.81
    const c = Math.cos((5 * Math.PI) / 180) * 9.81
    const android = deviceTilt({ x: -s, y: c, z: 0.3 })
    const ios = deviceTilt({ x: s, y: -c, z: -0.3 })
    expect(android).toEqual(ios)
    // The world then leans anticlockwise in the photo.
    expect(android!.tilt).toBe(-5)
    expect(android!.pitch).toBeGreaterThan(0)
  })
  it('gives nothing for a device lying flat or on its side', () => {
    expect(deviceTilt({ x: 0.1, y: 0.2, z: 9.8 })).toBeNull()
    expect(deviceTilt({ x: 9.8, y: 0.3, z: 0.1 })).toBeNull()
    expect(deviceTilt({ x: null, y: 9.8, z: 0 })).toBeNull()
  })
})

describe('posture extras', () => {
  const aligned: Points = { ear: [500, EAR_Y], shoulder: [500, 360], hip: [500, 900], knee: [500, 1300], ankle: [500, ANKLE_Y] }
  const front: Points = { earR: [480, EAR_Y], earL: [520, EAR_Y], shoulderR: [400, 360], shoulderL: [600, 360], hipR: [450, 900], hipL: [550, 900], kneeR: [450, 1300], kneeL: [550, 1300], ankleR: [450, ANKLE_Y], ankleL: [550, ANKLE_Y] }
  it('an upright figure loses no height and its neck carries nothing extra', () => {
    const m = measureView('right', aligned, H, 'right') as any
    expect(m.heightLoss).toBe(0)
    expect(m.neckLoad).toBe(0)
  })
  it('a head 30° forward carries about 12.7 kg extra and loses height', () => {
    const m = measureView('right', { ...aligned, ear: [540, 360 - 69.28] }, H, 'right') as any
    expect(m.neckLoad).toBe(12.7)
    expect(m.heightLoss).toBeGreaterThan(0.5)
  })
  it('scores 100 when aligned in everything, less as things move off', () => {
    const views = { right: view(aligned, 'right'), front: view(front) }
    expect(alignmentIndex(measureAll(views, H))).toBe(100)
    const off = { right: view({ ...aligned, ear: [560, EAR_Y] }, 'right'), front: view({ ...front, shoulderR: [400, 380] }) }
    const i = alignmentIndex(measureAll(off, H))!
    expect(i).toBeLessThan(90)
    expect(i).toBeGreaterThan(50)
    // A front photo alone is not the same index.
    expect(alignmentIndex(measureAll({ front: view(front) }, H))).toBeNull()
  })
  it('puts the weight between the feet, and ahead of the ankle from the side', () => {
    const b = postureBalance({ front: view(front), right: view(aligned, 'right') }, H)
    expect(b.rightShare).toBe(50)
    expect(b.forwardCm).toBe(0)
    // The whole body over the right foot (viewer's left from the front).
    const leaning = Object.fromEntries(Object.entries(front).map(([k, [x, y]]) => [k, [k.startsWith('ankle') ? x : x - 40, y]])) as Points
    expect(postureBalance({ front: view(leaning) }, H).rightShare!).toBeGreaterThan(70)
  })
  it('measures the Q-angle once its points are placed, and only then', () => {
    expect((measureView('front', front, H) as any).qAngleR).toBeUndefined()
    const q = { ...front, ...qAngleDefaults(front), patellaR: [450, 1290] as [number, number], asisR: [430, 850] as [number, number], tubR: [455, 1350] as [number, number] }
    const m = measureView('front', q, H) as any
    expect(m.qAngleR).toBeCloseTo(180 - angleAt([430, 850], [450, 1290], [455, 1350]), 5)
    expect(m.qAngleR).toBeGreaterThan(0)
    expect(photoPointNames('front', q)).toContain('tubL')
    expect(photoPointNames('front', front)).not.toContain('tubL')
  })
  it('writes each number beside its point', () => {
    const c = postureCallouts('right', aligned, H, 'right')
    expect(c.map((x) => x.key)).toEqual(['headAngle', 'shoulder', 'hip', 'knee'])
    // Behind a figure facing right is the viewer's left.
    expect(c.every((x) => x.side === 'left')).toBe(true)
  })
})

describe('squat', () => {
  // From the side, facing right. Standing: everything on the vertical.
  const up: Points = { ear: [500, EAR_Y], shoulder: [500, 360], hip: [500, 900], knee: [500, 1300], ankle: [500, ANKLE_Y], heel: [470, ANKLE_Y + 40], toe: [600, ANKLE_Y + 40] }
  // At the bottom: the shin from the ankle at 45° to a knee level with the
  // hip, the trunk leaning 45° forward from the hip.
  const down: Points = { ear: [520, 820], shoulder: [400, 900], hip: [200, 1100], knee: [700, 1100], ankle: [500, 1300], heel: [470, 1340], toe: [600, 1340] }
  it('scales the bottom photo by the standing one', () => {
    expect(squatPxPerCm(view(up, 'right'), 'side', H)).toBeCloseTo(10, 6)
    expect(squatPxPerCm(undefined, 'side', H)).toBeNull()
  })
  it('measures depth, trunk and shin from the side', () => {
    const m = measureSquatSide(down, null, 'right', 10, up)
    expect(m.kneeAngle).toBe(45)
    expect(m.tibiaLean).toBe(45)
    expect(m.trunkLean).toBe(45)
    expect(m.trunkVsTibia).toBe(0)
    expect(m.hipBelowKnee).toBe(false)
    expect(m.heelLift).toBe(0)
    expect(m.kneePastToe).toBe(10)
  })
  it('counts the heel’s rise against the standing photo', () => {
    const m = measureSquatSide({ ...down, heel: [470, 1320] }, null, 'right', 10, up)
    expect(m.heelLift).toBe(2)
  })
  it('measures a knee caving in from the front, and the pelvis off centre', () => {
    const f: Points = { earR: [480, 700], earL: [520, 700], shoulderR: [400, 800], shoulderL: [600, 800], hipR: [440, 1100], hipL: [560, 1100], kneeR: [470, 1200], kneeL: [620, 1200], ankleR: [400, 1400], ankleL: [600, 1400], toeR: [390, 1440], toeL: [610, 1440] }
    const m = measureSquatFront(f, null, 10)
    expect(m.kneeInR).toBeGreaterThan(10)
    expect(m.kneeInL).toBeLessThan(m.kneeInR)
    expect(m.shiftCm).toBe(0)
    expect(m.kneeWidth).toBe(0.75)
    expect(measureSquatFront({ ...f, hipR: [420, 1100], hipL: [540, 1100] }, null, 10).shiftCm).toBe(2)
  })
  it('measures all four photos together and leads with the bottom ones', () => {
    const front: Points = { earR: [480, EAR_Y], earL: [520, EAR_Y], shoulderR: [400, 360], shoulderL: [600, 360], hipR: [440, 900], hipL: [560, 900], kneeR: [450, 1300], kneeL: [550, 1300], ankleR: [450, ANKLE_Y], ankleL: [550, ANKLE_Y], toeR: [440, ANKLE_Y + 40], toeL: [560, ANKLE_Y + 40] }
    const views = { front_up: view(front), front_down: view({ ...front, kneeR: [480, 1300] }), side_up: view(up, 'right'), side_down: view(down, 'right') }
    const m = measureSquat(views, H)
    const h = squatHeadline(m)
    expect(h.depth).toBe(45)
    expect(h.kneeIn).toBeGreaterThan(0)
    expect(h.shift).toBe(0)
    expect(squatTrendValue(m, 'kneeIn')).toBe(h.kneeIn)
    expect(squatTrendValue(m, 'shift')).toBe(0)
  })
  it('places points from the model on the leg nearer the camera', () => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.2 }))
    for (const i of [12, 24, 26, 28]) lm[i] = { x: 0.4, y: 0.5, visibility: 0.95 }
    lm[30] = { x: 0.38, y: 0.95, visibility: 0.9 } // heel R
    lm[32] = { x: 0.48, y: 0.95, visibility: 0.9 } // toe R
    const r = squatPointsFromLandmarks('side_down', lm, 1000, 1000)
    expect(r.points.toe).toEqual([480, 950])
    expect(r.facing).toBe('right')
  })
  it('has a starting figure for every photo, with every point', () => {
    for (const v of squatViewsFor('both')) {
      const d = squatDefaultPoints(v, 1000, 1800)
      expect(Object.keys(d.points).sort()).toEqual(photoPointNames(v, d.points).slice().sort())
    }
  })
  it('writes its numbers beside its points', () => {
    expect(squatCallouts('side_down', down, 10, 'right', null, up).map((c) => c.key)).toEqual(['trunk', 'hip', 'knee', 'tibia'])
  })
})

describe('exercise suggestions', () => {
  const slugs = new Set(EXERCISE_CATALOG.map((e) => e.slug))
  it('only ever names exercises the starter catalogue has', () => {
    const posture = postureSuggestions({
      right: { earForward: 6, shoulderForward: 3.5, hipForward: 4, kneeForward: 0, headAngle: 30, headWeight: 18 },
      front: { headTilt: 0, shoulderTilt: 3, hipTilt: 3, headShift: 0, shoulderShift: 0, hipShift: 0, kneeAngleR: 8, kneeAngleL: 0 },
    })
    const squat = squatSuggestions({
      front_down: { kneeInR: 12, kneeInL: 2, pelvisTilt: 1, shoulderTilt: 0, shiftCm: 3, kneeWidth: 0.7, rightShare: 45 },
      side_down: { kneeAngle: 120, hipAngle: 80, trunkLean: 50, tibiaLean: 20, trunkVsTibia: 30, hipBelowKnee: false, heelLift: 2, kneePastToe: 5, forwardCm: 2 },
    })
    expect(posture.length).toBe(6)
    expect(squat.length).toBe(5)
    for (const s of suggestedSlugs([...posture, ...squat])) expect(slugs.has(s), s).toBe(true)
  })
  it('suggests nothing for an aligned posture', () => {
    expect(postureSuggestions({ right: { earForward: 0, shoulderForward: 0, hipForward: 0, kneeForward: 0, headAngle: 0, headWeight: 5.4 } })).toEqual([])
  })
})

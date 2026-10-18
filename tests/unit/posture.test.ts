import { describe, expect, it } from 'vitest'
import { defaultPoints, EAR_HEIGHT_RATIO, hansrajHeadWeight, measureAll, measureView, pointsFromLandmarks, postureHeadline, pxPerCm, type Points } from '../../utils/posture'

// A 170 cm patient photographed so that ear-to-ankle is 1591.2 px: exactly
// 10 px per cm, so every number below can be checked by hand.
const H = 170
const EAR_Y = 100
const ANKLE_Y = EAR_Y + EAR_HEIGHT_RATIO * H * 10

describe('pxPerCm', () => {
  it('scales by the patient’s height from ear to ankle', () => {
    expect(pxPerCm('right', { ear: [500, EAR_Y], shoulder: [0, 0], hip: [0, 0], knee: [0, 0], ankle: [500, ANKLE_Y] }, H)).toBeCloseTo(10, 6)
  })
})

describe('a side photo', () => {
  // Facing right: the ear 4 cm ahead of the ankle, the shoulder 2 cm, the
  // ear 40 px ahead of a shoulder 69.3 px below it -- 30 degrees.
  const p: Points = { ear: [540, EAR_Y], shoulder: [520, EAR_Y + 34.64], hip: [505, 900], knee: [503, 1300], ankle: [500, ANKLE_Y] }
  it('measures how far ahead of the ankle each point is, and the head’s angle and estimated load', () => {
    const m = measureView('right', { ...p, ear: [540, EAR_Y], shoulder: [520, EAR_Y + 34.64] }, H, 'right') as any
    expect(m.earForward).toBe(4)
    expect(m.shoulderForward).toBe(2)
    expect(m.hipForward).toBe(0.5)
    expect(m.kneeForward).toBe(0.3)
    expect(m.headAngle).toBe(30)
    expect(m.headWeight).toBe(18.1)
  })
  it('reads the same photo mirrored the same way when it faces left', () => {
    const mirrored = Object.fromEntries(Object.entries(p).map(([k, [x, y]]) => [k, [1000 - x, y]])) as Points
    expect(measureView('left', mirrored, H, 'left')).toEqual(measureView('right', p, H, 'right'))
  })
})

describe('a front photo', () => {
  // The patient's right on the viewer's left. Right shoulder 10 px lower over
  // 200 px; hips level; the head 2 cm towards the patient's right.
  const p: Points = {
    earR: [470, EAR_Y], earL: [490, EAR_Y],
    shoulderR: [400, 300], shoulderL: [600, 290],
    hipR: [450, 900], hipL: [550, 900],
    kneeR: [460, 1300], kneeL: [540, 1300],
    ankleR: [460, ANKLE_Y], ankleL: [540, ANKLE_Y],
  }
  it('gives tilts with the right side lower as positive, and shifts towards the right as positive', () => {
    const m = measureView('front', p, H) as any
    expect(m.shoulderTilt).toBeCloseTo(2.9, 1)
    expect(m.hipTilt).toBe(0)
    expect(m.headShift).toBe(2)
    expect(m.hipShift).toBe(0)
  })
  it('from behind, the patient’s right is on the viewer’s right', () => {
    const back = Object.fromEntries(Object.entries(p).map(([k, [x, y]]) => [k, [1000 - x, y]])) as Points
    expect(measureView('back', back, H)).toEqual(measureView('front', p, H))
  })
})

describe('hansrajHeadWeight', () => {
  it('follows the published points and stays flat outside them', () => {
    expect(hansrajHeadWeight(0)).toBe(5.4)
    expect(hansrajHeadWeight(15)).toBe(12.2)
    expect(hansrajHeadWeight(22.5)).toBe(15.2)
    expect(hansrajHeadWeight(60)).toBe(27.2)
    expect(hansrajHeadWeight(80)).toBe(27.2)
    expect(hansrajHeadWeight(-10)).toBe(5.4)
  })
})

describe('placing the points', () => {
  it('takes the patient’s side landmarks for a side view, and the facing from the nose', () => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 }))
    lm[8] = { x: 0.52, y: 0.1 } // right ear
    lm[0] = { x: 0.58, y: 0.11 } // nose ahead of it
    lm[28] = { x: 0.5, y: 0.95 }
    const { points, facing } = pointsFromLandmarks('right', lm, 1000, 2000)
    expect(points.ear).toEqual([520, 200])
    expect(points.ankle).toEqual([500, 1900])
    expect(facing).toBe('right')
  })
  it('has a standing figure to start from when nobody is found', () => {
    const { points } = defaultPoints('front', 1000, 2000)
    expect(points.shoulderR![0]).toBeLessThan(points.shoulderL![0])
    expect(Object.keys(defaultPoints('back', 1000, 2000).points)).toHaveLength(10)
    expect(Object.keys(defaultPoints('left', 1000, 2000).points)).toEqual(['ear', 'shoulder', 'hip', 'knee', 'ankle'])
  })
})

describe('postureHeadline', () => {
  it('takes the head from the side photo and the tilts from the front', () => {
    const side: Points = { ear: [540, EAR_Y], shoulder: [520, EAR_Y + 34.64], hip: [505, 900], knee: [503, 1300], ankle: [500, ANKLE_Y] }
    const m = measureAll({ right: { photo: 'x', width: 1000, height: 2000, points: side, facing: 'right' } }, H)
    expect(postureHeadline(m)).toEqual({ headForward: 2, headWeight: 18.1, headAngle: 30, shoulderTilt: null, hipTilt: null })
  })
})

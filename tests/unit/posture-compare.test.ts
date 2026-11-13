import { describe, expect, it } from 'vitest'
import { commonViews, compareBar, compareHeadline, comparePosture, compareSentence, ghostPoints, orderByTaken } from '../../utils/postureCompare'
import type { FrontMetrics, SideMetrics } from '../../utils/posture'

const front = (m: Partial<FrontMetrics> = {}): FrontMetrics => ({ headTilt: 0, shoulderTilt: 0, hipTilt: 0, headShift: 0, shoulderShift: 0, hipShift: 0, ...m })
const side = (m: Partial<SideMetrics> = {}): SideMetrics => ({ earForward: 0, shoulderForward: 0, hipForward: 0, kneeForward: 0, headAngle: 0, headWeight: 5.4, ...m })

describe('commonViews', () => {
  it('never pairs a right side with a left one', () => {
    expect(commonViews({ right: side(), front: front() }, { left: side(), back: front() })).toEqual({ side: null, front: null })
    expect(commonViews({ right: side(), left: side(), back: front() }, { left: side(), back: front() })).toEqual({ side: 'left', front: 'back' })
  })
})

describe('comparePosture', () => {
  const before = { right: side({ earForward: 6, shoulderForward: 1, headWeight: 18.1, hipForward: -2 }), front: front({ shoulderTilt: -3, hipTilt: 1, kneeAngleR: 4, kneeAngleL: -1 }) }
  const after = { right: side({ earForward: 3, shoulderForward: 1, headWeight: 12.2, hipForward: 2.2 }), front: front({ shoulderTilt: 1, hipTilt: 2.4, kneeAngleR: 3, kneeAngleL: -1 }) }

  it('reads each measure as distance from aligned, whichever side it leans', () => {
    const c = comparePosture(before, after, 'es')
    const row = (k: string) => c.rows.find((r) => r.key === k)!
    expect(row('headWeight')).toMatchObject({ before: 18.1, after: 12.2, delta: -5.9, verdict: 'better', share: 46 })
    expect(row('headForward')).toMatchObject({ before: 5, after: 2, verdict: 'better', share: 60 })
    // 3° to the left became 1° to the right: better, not "4° worse".
    expect(row('shoulderTilt')).toMatchObject({ before: 3, after: 1, delta: -2, verdict: 'better' })
    expect(row('hipTilt')).toMatchObject({ before: 1, after: 2.4, verdict: 'worse', share: null })
    // 2 cm behind the vertical, then 2.2 ahead of it: the photo, not the person.
    expect(row('hipForward').verdict).toBe('same')
    // A degree at the knee is under what a photo can tell.
    expect(row('knees')).toMatchObject({ before: 4, after: 3, verdict: 'same' })
    expect({ better: c.better, worse: c.worse, same: c.same }).toEqual({ better: 3, worse: 1, same: 8 })
  })

  it('shows the patient the four their chart explains, in their words', () => {
    const c = comparePosture(before, after, 'es', 'patient')
    expect(c.rows.map((r) => r.key)).toEqual(['headWeight', 'headForward', 'shoulderTilt', 'hipTilt'])
    expect(c.rows[0]!.label).toBe('Peso que sostiene tu cuello')
  })

  it('leaves out what one of the two did not measure', () => {
    const c = comparePosture({ right: side() }, { right: side(), front: front() }, 'es')
    expect(c.rows.every((r) => r.group !== 'front')).toBe(true)
    expect(comparePosture({ right: side() }, { left: side() }, 'es').rows).toEqual([])
  })

  it('says it in a line and in a sentence', () => {
    const c = comparePosture(before, after, 'es')
    expect(compareHeadline(c, 'es')).toBe('3 de 12 medidas mejoran')
    expect(compareSentence(c, 'es')).toBe(
      'Lo que más ha mejorado: inclinación de hombros (de 3° a 1°), cabeza por delante del hombro (de 5 cm a 2 cm) y peso efectivo de la cabeza (de 18,1 kg a 12,2 kg). A vigilar: inclinación de pelvis (de 1° a 2,4°). El resto se mantiene parecido.',
    )
    const flat = comparePosture(before, before, 'en')
    expect(compareHeadline(flat, 'en')).toBe('The measurements are much the same')
    expect(compareSentence(flat, 'en')).toBe('The measurements are much the same in both assessments.')
    expect(compareHeadline(comparePosture({ right: side() }, { left: side() }, 'es'), 'es')).toContain('no tienen fotos de la misma vista')
  })
})

describe('compareBar', () => {
  it('places before, now and aligned on one scale with room past the larger', () => {
    const b = compareBar({ before: 18.1, after: 12.2, ideal: 5.4 })
    expect(b.before).toBeCloseTo(1 / 1.15, 5)
    expect(b.after).toBeCloseTo(12.2 / (18.1 * 1.15), 5)
    expect(b.ideal).toBeCloseTo(5.4 / (18.1 * 1.15), 5)
    expect(compareBar({ before: 0, after: 0, ideal: 0 })).toEqual({ before: 0, after: 0, ideal: 0 })
  })
})

describe('ghostPoints', () => {
  const pts = (earX: number, scale = 1, dx = 0) => ({ ear: [dx + earX * scale, 100 * scale], shoulder: [dx + 500 * scale, 300 * scale], hip: [dx + 500 * scale, 900 * scale], knee: [dx + 500 * scale, 1300 * scale], ankle: [dx + 500 * scale, 1700 * scale] }) as Record<string, [number, number]>

  it('puts the earlier figure on the later photo at the same height and ankle', () => {
    // The later photo was taken from twice as close and 40 px to the side.
    const g = ghostPoints('right', { points: pts(560), facing: 'right' }, { points: pts(520, 2, 40), facing: 'right' })!
    expect(g.ankle).toEqual([1040, 3400])
    expect(g.ear).toEqual([1160, 200])
  })

  it('mirrors a side photo that faced the other way', () => {
    const g = ghostPoints('right', { points: pts(560), facing: 'left' }, { points: pts(520), facing: 'right' })!
    expect(g.ear).toEqual([440, 100])
  })

  it('is null without the points to line up by', () => {
    expect(ghostPoints('right', { points: {}, facing: null }, { points: pts(520), facing: 'right' })).toBeNull()
  })
})

describe('orderByTaken', () => {
  it('puts the earlier first however they were picked', () => {
    expect(orderByTaken({ takenAt: '2026-09-08' }, { takenAt: '2026-06-02' }).map((a) => a.takenAt)).toEqual(['2026-06-02', '2026-09-08'])
  })
})

import { describe, expect, it } from 'vitest'
import { postureConclusion, postureEvolution, postureReportSections } from '../../utils/postureReport'
import type { FrontMetrics, SideMetrics } from '../../utils/posture'

const front = (m: Partial<FrontMetrics> = {}): FrontMetrics => ({ headTilt: 0, shoulderTilt: 0, hipTilt: 0, headShift: 0, shoulderShift: 0, hipShift: 0, ...m })
const side = (m: Partial<SideMetrics> = {}): SideMetrics => ({ earForward: 0, shoulderForward: 0, hipForward: 0, kneeForward: 0, headAngle: 0, headWeight: 5.4, ...m })

describe('postureReportSections', () => {
  it('describes a front view in the patient’s own left and right', () => {
    const [s] = postureReportSections({ front: front({ shoulderTilt: 2.4, shoulderShift: -1.2, headTilt: 0.2, headShift: 0.3 }) }, 'es')
    expect(s!.title).toBe('Vista frontal')
    expect(s!.findings[0]).toEqual({ label: 'Cabeza', text: 'centrada · nivelada' })
    expect(postureReportSections({ front: front() }, 'es')[0]!.findings[1]!.text).toBe('centrados · nivelados')
    expect(s!.findings[1]).toEqual({ label: 'Hombros', text: 'desplazados 1,2 cm hacia la izquierda · inclinados 2,4°, más bajo el derecho' })
    expect(s!.totals).toEqual([
      { label: 'Desplazamientos totales', value: '1,5 cm' },
      { label: 'Inclinaciones totales', value: '2,6°' },
    ])
    expect(s!.headWeight).toBeNull()
  })

  it('gives a side view the effective head weight', () => {
    const [s] = postureReportSections({ right: side({ earForward: 4.1, shoulderForward: 1, hipForward: -0.2, kneeForward: -1.5, headAngle: 30, headWeight: 18.1 }) }, 'es')
    expect(s!.findings.map((f) => f.text)).toEqual([
      '4,1 cm por delante de la vertical · 30° por delante del hombro',
      '1 cm por delante de la vertical',
      'sobre la vertical',
      '1,5 cm por detrás de la vertical',
    ])
    expect(s!.headWeight).toMatchObject({ value: '18,1 kg' })
    expect(s!.headWeight!.note).toContain('3,4 veces')
  })

  it('keeps the order the photos are taken in, and only the views there are', () => {
    const views = postureReportSections({ left: side(), front: front(), back: front() }, 'en').map((s) => s.view)
    expect(views).toEqual(['front', 'back', 'left'])
  })
})

describe('postureConclusion', () => {
  it('says the alignment is good when nothing stands out', () => {
    expect(postureConclusion({ front: front({ shoulderTilt: 1 }), right: side({ headWeight: 7 }) }, 'es')).toMatch(/^En estas fotos la alineación es buena/)
  })
  it('names what stands out, and nothing else', () => {
    const text = postureConclusion({ front: front({ shoulderTilt: -2.5, hipTilt: 0.8 }), right: side({ headWeight: 18.1 }) }, 'es')
    expect(text).toContain('unos 18,1 kg')
    expect(text).toContain('el hombro izquierdo queda más bajo (2,5°)')
    expect(text).not.toContain('pelvis')
  })
})

describe('postureEvolution', () => {
  it('compares the headline numbers and marks which way they went', () => {
    const rows = postureEvolution({ front: front({ shoulderTilt: 3 }), right: side({ headWeight: 18.1 }) }, { front: front({ shoulderTilt: -1 }), right: side({ headWeight: 12.2 }) }, 'en')
    expect(rows.find((r) => r.label === 'Effective head weight')).toEqual({ label: 'Effective head weight', then: '18.1 kg', now: '12.2 kg', better: true })
    expect(rows.find((r) => r.label === 'Shoulder tilt')).toMatchObject({ then: '3°', now: '1°', better: true })
  })
  it('leaves out what one of the two did not measure', () => {
    expect(postureEvolution({ right: side() }, { front: front() }, 'es')).toEqual([])
  })
})

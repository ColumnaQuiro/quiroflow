import { describe, expect, it } from 'vitest'
import { postureConclusion, postureEvolutionTable, postureProgressSentence, postureReportSections } from '../../utils/postureReport'
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

  it('says which way each knee points, and leaves it out of assessments that never had it', () => {
    const [s] = postureReportSections({ front: front({ kneeAngleR: 4.2, kneeAngleL: -1.1 }) }, 'es')
    expect(s!.findings[3]).toEqual({ label: 'Rodillas', text: 'derecha 4,2° hacia dentro · izquierda recta' })
    expect(postureReportSections({ front: front({ kneeAngleR: 1, kneeAngleL: -0.5 }) }, 'es')[0]!.findings[3]!.text).toBe('rectas')
    expect(postureReportSections({ front: front() }, 'es')[0]!.findings).toHaveLength(3)
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

describe('postureEvolutionTable', () => {
  const at = (takenAt: string, headWeight: number, shoulderTilt: number) => ({ takenAt, metrics: { front: front({ shoulderTilt }), right: side({ headWeight }) } })
  it('shows the first, the one before and this one, as distance from aligned', () => {
    const { columns, rows } = postureEvolutionTable([at('2026-08-01', 15, 2), at('2026-06-01', 18.1, 3), at('2026-10-01', 12.2, -1), at('2026-07-01', 16, 2.5)], 'en')
    expect(columns).toEqual(['2026-06-01', '2026-08-01', '2026-10-01'])
    expect(rows.find((r) => r.key === 'headWeight')).toEqual({ key: 'headWeight', label: 'Effective head weight', values: ['18.1 kg', '15 kg', '12.2 kg'], better: true })
    // A tilt that changed side is plotted by its size: 3° then 1° is better.
    expect(rows.find((r) => r.key === 'shoulderTilt')).toMatchObject({ values: ['3°', '2°', '1°'], better: true })
  })
  it('leaves out what the first or this one did not measure', () => {
    expect(postureEvolutionTable([{ takenAt: '2026-06-01', metrics: { right: side() } }, { takenAt: '2026-07-01', metrics: { front: front() } }], 'es').rows).toEqual([])
  })
})

describe('postureProgressSentence', () => {
  it('names the head weight, the head and whatever levelled', () => {
    const text = postureProgressSentence([
      { takenAt: '2026-06-01', metrics: { front: front({ shoulderTilt: 3.4, hipTilt: 2.2 }), right: side({ headWeight: 21.1, earForward: 6.8 }) } },
      { takenAt: '2026-10-01', metrics: { front: front({ shoulderTilt: 1.8, hipTilt: 0.9 }), right: side({ headWeight: 12.2, earForward: 3.2 }) } },
    ], 'es')
    expect(text).toBe('Desde la primera valoración, el cuello sostiene 8,9 kg menos, la cabeza está 3,6 cm más alineada sobre el hombro y hombros y pelvis están más nivelados. Seguiremos midiendo en las próximas revisiones.')
  })
  it('says so when little changed', () => {
    expect(postureProgressSentence([{ takenAt: 'a', metrics: { right: side() } }, { takenAt: 'b', metrics: { right: side() } }], 'en')).toMatch(/^The measurements are much as they were/)
  })
})

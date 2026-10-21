import { measureAll, postureHeadline, type FrontMetrics, type PostureView, type StoredViews, type ViewMetrics } from './posture'

// One posture number across every assessment: what the Progreso chart and
// the report's evolution page plot. Pure, so the screen (an SVG in
// components/posture/Section.vue) and the PDF (server/utils/posturePdf.ts)
// draw the same values on the same scale.
//
// Every number is plotted as its distance from aligned, so lower is always
// better and the green line sits at the same place for all of them: a tilt
// is plotted without its side (a shoulder that drops 2° to the left after
// 2° to the right has not improved), and the knees as whichever bends more.

export type TrendKey = 'headWeight' | 'headForward' | 'shoulderTilt' | 'hipTilt' | 'knees'

export interface TrendMetric {
  key: TrendKey
  label: { es: string; en: string }
  short: { es: string; en: string }
  unit: 'kg' | 'cm' | '°'
  /** Where aligned sits: the head's weight upright, else 0. */
  ideal: number
  idealLabel: { es: string; en: string }
  help: { es: string; en: string }
}

export const TREND_METRICS: TrendMetric[] = [
  {
    key: 'headWeight',
    label: { es: 'Peso efectivo de la cabeza', en: 'Effective head weight' },
    short: { es: 'Peso de la cabeza', en: 'Head weight' },
    unit: 'kg',
    ideal: 5.4,
    idealLabel: { es: 'Erguida: unos 5,4 kg', en: 'Upright: about 5.4 kg' },
    help: {
      es: 'Lo que el cuello sostiene según cuánto se adelanta la cabeza. Erguida pesa unos 5 kg; a 30° de inclinación, unos 18.',
      en: 'What the neck holds, by how far the head tips forward. Upright it weighs about 5 kg; at 30°, about 18.',
    },
  },
  {
    key: 'headForward',
    label: { es: 'Cabeza por delante del hombro', en: 'Head ahead of the shoulder' },
    short: { es: 'Cabeza adelantada', en: 'Head forward' },
    unit: 'cm',
    ideal: 0,
    idealLabel: { es: '0 cm = oreja sobre el hombro', en: '0 cm = ear over the shoulder' },
    help: {
      es: 'Distancia horizontal de la oreja al hombro en la foto lateral. Es la cifra que más explica el peso de la cabeza.',
      en: 'How far the ear sits ahead of the shoulder in the side photo. It is what drives the head weight.',
    },
  },
  {
    key: 'shoulderTilt',
    label: { es: 'Inclinación de hombros', en: 'Shoulder tilt' },
    short: { es: 'Hombros', en: 'Shoulders' },
    unit: '°',
    ideal: 0,
    idealLabel: { es: '0° = nivelados', en: '0° = level' },
    help: {
      es: 'Diferencia de altura entre los dos hombros en la foto frontal, sea cual sea el lado. Un grado y medio es habitual en cualquiera.',
      en: 'The height difference between the shoulders in the front photo, whichever side. A degree and a half is common in anyone.',
    },
  },
  {
    key: 'hipTilt',
    label: { es: 'Inclinación de pelvis', en: 'Pelvic tilt' },
    short: { es: 'Pelvis', en: 'Pelvis' },
    unit: '°',
    ideal: 0,
    idealLabel: { es: '0° = nivelada', en: '0° = level' },
    help: {
      es: 'Diferencia de altura entre las dos caderas en la foto frontal, sea cual sea el lado.',
      en: 'The height difference between the hips in the front photo, whichever side.',
    },
  },
  {
    key: 'knees',
    label: { es: 'Rodillas, la más desviada', en: 'Knees, the one that bends more' },
    short: { es: 'Rodillas', en: 'Knees' },
    unit: '°',
    ideal: 0,
    idealLabel: { es: '0° = recta', en: '0° = straight' },
    help: {
      es: 'Cuánto se dobla la rodilla que más se aparta de la línea cadera–tobillo, hacia dentro o hacia fuera. Menos de 2° se lee como recta.',
      en: 'How far the knee that bends more is off the hip–ankle line, in or out. Under 2° reads as straight.',
    },
  },
]

/** The metric's value in one assessment, as distance from aligned; null when that assessment did not measure it. */
export function trendValue(metrics: Partial<Record<PostureView, ViewMetrics>>, key: TrendKey): number | null {
  const h = postureHeadline(metrics)
  const abs = (n: number | null) => (n === null ? null : Math.abs(n))
  switch (key) {
    case 'headWeight':
      return h.headWeight
    case 'headForward':
      return h.headForward
    case 'shoulderTilt':
      return abs(h.shoulderTilt)
    case 'hipTilt':
      return abs(h.hipTilt)
    case 'knees': {
      const f = (metrics.front ?? metrics.back) as FrontMetrics | undefined
      if (f?.kneeAngleR === undefined || f.kneeAngleL === undefined) return null
      return Math.max(Math.abs(f.kneeAngleR), Math.abs(f.kneeAngleL))
    }
  }
}

export interface TrendAssessment { takenAt: string; heightCm: number; views: StoredViews; metrics: Partial<Record<PostureView, ViewMetrics>> }

/**
 * Each assessment's measurements, worked out again from its points, so one
 * saved before a measurement existed (the knees, 21 Oct 2026) still has a
 * value. Falls back to what was stored when there is no height to measure by.
 */
export function remeasure(a: TrendAssessment): Partial<Record<PostureView, ViewMetrics>> {
  return a.heightCm > 0 ? measureAll(a.views, a.heightCm) : a.metrics
}

export interface TrendPoint { takenAt: string; value: number }

/** The assessments that measured `key`, oldest first. */
export function trendSeries(list: { takenAt: string; metrics: Partial<Record<PostureView, ViewMetrics>> }[], key: TrendKey): TrendPoint[] {
  return [...list]
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt))
    .flatMap((a) => {
      const v = trendValue(a.metrics, key)
      return v === null ? [] : [{ takenAt: a.takenAt, value: Math.round(v * 10) / 10 }]
    })
}

/** The top of the chart: above every value and the ideal, rounded up to a step that reads well. */
export function trendMax(values: number[], ideal: number): number {
  const top = Math.max(ideal, ...values, 1) * 1.15
  const step = top > 20 ? 5 : top > 8 ? 2 : top > 4 ? 1 : 0.5
  return Math.ceil(top / step) * step
}

export interface TrendBox { width: number; height: number; left: number; right: number; top: number; bottom: number }

/** Where each point and the ideal fall inside a box, in its own units (SVG pixels or PDF points). */
export function trendLayout(points: TrendPoint[], ideal: number, box: TrendBox) {
  const max = trendMax(points.map((p) => p.value), ideal)
  const n = points.length
  const innerW = box.width - box.left - box.right
  const innerH = box.height - box.top - box.bottom
  const x = (i: number) => box.left + (n <= 1 ? innerW / 2 : (i * innerW) / (n - 1))
  const y = (v: number) => box.top + ((max - Math.max(0, v)) / max) * innerH
  return {
    max,
    points: points.map((p, i) => ({ ...p, x: x(i), y: y(p.value) })),
    idealY: y(ideal),
    baseY: box.top + innerH,
    ticks: [0, max / 2, max].map((v) => ({ value: Math.round(v * 10) / 10, y: y(v) })),
  }
}

export interface TrendSummary { delta: number; better: boolean | null; share: number | null }

/** First to latest: by how much, whether that is closer to aligned, and what share of the way there. */
export function trendSummary(points: TrendPoint[], ideal: number): TrendSummary | null {
  if (points.length < 2) return null
  const first = points[0]!.value
  const last = points[points.length - 1]!.value
  const before = Math.abs(first - ideal)
  const after = Math.abs(last - ideal)
  const delta = Math.round((last - first) * 10) / 10 || 0
  const better = Math.abs(after - before) < 0.1 ? null : after < before
  const share = better && before > 0 ? Math.min(100, Math.round(((before - after) / before) * 100)) : null
  return { delta, better, share }
}

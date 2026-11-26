/**
 * Blind Spot (punto ciego): the geometry of the test and of its result.
 *
 * Shared by the test (pages/patients/blind-spot/[id].vue), the results tab
 * (components/blindspot/) and the PDF (server/utils/blindSpotPdf.ts), so a
 * test, the screen showing it and the report sent to the patient compute one
 * area with one rule. Relative imports only: the mobile app scans utils/.
 *
 * Every measure is in degrees of visual angle, in the eye's own frame:
 * x towards the temple, y up, from the point the patient is looking at.
 * Which way "towards the temple" is on the screen depends on the eye, and is
 * decided once, in blindSpotScreenPoint().
 */

/** Where the physiological blind spot sits: ~15.5° to the temple, ~1.5° below. */
export const BLIND_SPOT_CENTRE = { x: 15.5, y: -1.5 } as const

/**
 * A typical blind spot is about 5.5° wide and 7.5° tall: the dashed reference
 * ellipse on every map. A reference for the eye, not a normal range -- the
 * report compares the two eyes and the visits, never one eye with this.
 */
export const BLIND_SPOT_REFERENCE = { rx: 2.75, ry: 3.75 } as const

/** Fewer than this and there is no shape to speak of. Each clinician picks any number from here up. */
export const BLIND_SPOT_MIN_POINTS = 4
export const BLIND_SPOT_MAX_POINTS = 72
export const BLIND_SPOT_DEFAULT_POINTS = 8

/** How far out a dot travels before the trial counts as never seen. */
export const BLIND_SPOT_MAX_RADIUS = 12

export type BlindSpotEye = 'right' | 'left'

export interface BlindSpotPoint {
  /** Degrees around the expected centre: 0 towards the temple, counter-clockwise. */
  angle: number
  /** How far out the patient first saw the dot, in degrees; null when never seen. */
  r: number | null
}

export interface BlindSpotEyeResult {
  points: BlindSpotPoint[]
  catch_trials: number
  false_positives: number
}

export interface BlindSpotTestRow {
  id: string
  patient_id: string
  session_id: string
  phase: 'single' | 'pre' | 'post'
  right_eye: BlindSpotEyeResult
  left_eye: BlindSpotEyeResult
  right_area: number | null
  left_area: number | null
  points_per_eye: number
  distance_cm: number
  px_per_mm: number
  note: string | null
  tested_at: string
  created_by: string | null
}

export function clampBlindSpotPoints(n: number): number {
  if (!Number.isFinite(n)) return BLIND_SPOT_DEFAULT_POINTS
  return Math.min(BLIND_SPOT_MAX_POINTS, Math.max(BLIND_SPOT_MIN_POINTS, Math.round(n)))
}

/** n directions evenly round the centre, starting towards the temple. */
export function blindSpotAngles(n: number): number[] {
  const count = clampBlindSpotPoints(n)
  return Array.from({ length: count }, (_, i) => Math.round((i * 360 * 1000) / count) / 1000)
}

/** A measured point in the eye's frame (degrees, x to the temple, y up). */
export function blindSpotPointXY(p: { angle: number; r: number }): [number, number] {
  const a = (p.angle * Math.PI) / 180
  return [BLIND_SPOT_CENTRE.x + Math.cos(a) * p.r, BLIND_SPOT_CENTRE.y + Math.sin(a) * p.r]
}

/** The points the patient saw, in order round the centre. Never-seen ones are left out. */
export function seenPoints(points: BlindSpotPoint[]): Array<{ angle: number; r: number }> {
  return points
    .filter((p): p is { angle: number; r: number } => typeof p.r === 'number' && Number.isFinite(p.r) && p.r > 0)
    .slice()
    .sort((a, b) => a.angle - b.angle)
}

/**
 * The radius in every direction, from the directions measured: a
 * trigonometric (Fourier) interpolation of r(angle) round the centre, which
 * passes through every measured point. It is what lets a clinician measure
 * only four directions -- four points on a circle give the circle exactly,
 * and four on a typical blind spot give its area to within ~4% -- where
 * joining the points (or a spline through them) cuts the corners and reads
 * 13% small.
 *
 * A direction the patient never saw takes its radius from its neighbours
 * either side, so one missed trial does not dent the shape.
 */
function radiusFunction(points: BlindSpotPoint[]): ((angleRad: number) => number) | null {
  const all = points.slice().sort((a, b) => a.angle - b.angle)
  const n = all.length
  const seen = all.map((p, i) => ({ i, r: typeof p.r === 'number' && Number.isFinite(p.r) && p.r > 0 ? p.r : null })).filter((p) => p.r !== null) as Array<{ i: number; r: number }>
  if (seen.length < 3) return null

  const r = all.map((p, i) => {
    if (typeof p.r === 'number' && Number.isFinite(p.r) && p.r > 0) return p.r
    // Linear, round the circle, between the nearest seen directions.
    const before = [...seen].reverse().find((s) => s.i < i) ?? seen[seen.length - 1]!
    const after = seen.find((s) => s.i > i) ?? seen[0]!
    const span = (after.i - before.i + n) % n || n
    const step = (i - before.i + n) % n
    return before.r + ((after.r - before.r) * step) / span
  })
  const theta = all.map((p) => (p.angle * Math.PI) / 180)

  const m = Math.floor(n / 2)
  const a: number[] = []
  const b: number[] = []
  for (let k = 0; k <= m; k++) {
    let sa = 0
    let sb = 0
    for (let j = 0; j < n; j++) {
      sa += r[j]! * Math.cos(k * theta[j]!)
      sb += r[j]! * Math.sin(k * theta[j]!)
    }
    // The constant and, for an even count, the highest harmonic are counted once.
    const w = k === 0 || (n % 2 === 0 && k === m) ? 1 / n : 2 / n
    a.push(sa * w)
    b.push(sb * w)
  }
  return (t: number) => {
    let v = a[0]!
    for (let k = 1; k <= m; k++) v += a[k]! * Math.cos(k * t) + b[k]! * Math.sin(k * t)
    return Math.max(0, v)
  }
}

/**
 * The closed curve every map draws and the area is taken from, so the
 * number and the drawing cannot disagree. Points in the eye's frame.
 */
export function blindSpotContour(points: BlindSpotPoint[], samples = 144): Array<[number, number]> {
  const radius = radiusFunction(points)
  if (!radius) return []
  return Array.from({ length: samples }, (_, i) => {
    const t = (i / samples) * 2 * Math.PI
    const rr = radius(t)
    return [BLIND_SPOT_CENTRE.x + Math.cos(t) * rr, BLIND_SPOT_CENTRE.y + Math.sin(t) * rr] as [number, number]
  })
}

/** Area inside the contour, in square degrees; null with fewer than three points seen. */
export function blindSpotArea(points: BlindSpotPoint[]): number | null {
  const c = blindSpotContour(points)
  if (c.length < 3) return null
  let twice = 0
  for (let i = 0; i < c.length; i++) {
    const [x1, y1] = c[i]!
    const [x2, y2] = c[(i + 1) % c.length]!
    twice += x1 * y2 - x2 * y1
  }
  return Math.round((Math.abs(twice) / 2) * 100) / 100
}

export interface BlindSpotAsymmetry {
  /** How much bigger the larger blind spot is than the smaller, in percent. */
  percent: number
  /** Which eye has the larger one; null when they are equal. */
  larger: BlindSpotEye | null
}

export function blindSpotAsymmetry(rightArea: number | null, leftArea: number | null): BlindSpotAsymmetry | null {
  if (rightArea == null || leftArea == null || rightArea <= 0 || leftArea <= 0) return null
  const big = Math.max(rightArea, leftArea)
  const small = Math.min(rightArea, leftArea)
  const percent = Math.round(((big - small) / small) * 100)
  return { percent, larger: percent === 0 ? null : rightArea > leftArea ? 'right' : 'left' }
}

/** Visual angle to millimetres on the screen, at a viewing distance. */
export function degToMm(deg: number, distanceCm: number): number {
  return Math.tan((deg * Math.PI) / 180) * distanceCm * 10
}

/**
 * Where a point of the eye's frame lands on the screen, in CSS px, relative to
 * the fixation cross. The right eye's temple is to the right of the screen and
 * the left eye's to the left, so x flips with the eye; screen y grows down.
 */
export function blindSpotScreenOffset(eye: BlindSpotEye, xy: [number, number], distanceCm: number, pxPerMm: number): { dx: number; dy: number } {
  const sign = eye === 'right' ? 1 : -1
  return {
    dx: sign * degToMm(xy[0], distanceCm) * pxPerMm,
    dy: -degToMm(xy[1], distanceCm) * pxPerMm,
  }
}

/** How much screen the test needs to the temple side of the cross, in px. */
export function blindSpotRequiredWidthPx(distanceCm: number, pxPerMm: number): number {
  return degToMm(BLIND_SPOT_CENTRE.x + BLIND_SPOT_MAX_RADIUS + 1, distanceCm) * pxPerMm
}

export type BlindSpotTrial = { kind: 'direction'; angle: number } | { kind: 'catch' }

/**
 * The trials for one eye: one per direction, plus catch trials -- a dot shown
 * still, inside the blind spot, where a patient who is really looking at the
 * cross cannot see it. A response to one is a false positive: guessing, or
 * the eye wandering. Shuffled, so the next direction cannot be anticipated.
 */
export function blindSpotTrials(points: number, catchTrials = 2, random: () => number = Math.random): BlindSpotTrial[] {
  const trials: BlindSpotTrial[] = [
    ...blindSpotAngles(points).map((angle) => ({ kind: 'direction' as const, angle })),
    ...Array.from({ length: Math.max(0, catchTrials) }, () => ({ kind: 'catch' as const })),
  ]
  for (let i = trials.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[trials[i], trials[j]] = [trials[j]!, trials[i]!]
  }
  return trials
}

/**
 * An SVG path for a map, given how to place a point of the eye's frame.
 * Taken from the same contour as the area.
 */
export function blindSpotSvgPath(points: BlindSpotPoint[], place: (xy: [number, number]) => [number, number]): string {
  const c = blindSpotContour(points, 96)
  if (c.length < 3) return ''
  return `${c.map((xy, i) => {
    const [x, y] = place(xy)
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')} Z`
}

/** "34,0" -- one decimal, Spanish or English separator. */
export function formatBlindSpotArea(area: number | null | undefined, lang: 'es' | 'en' = 'es'): string {
  if (area == null) return '—'
  return area.toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })
}

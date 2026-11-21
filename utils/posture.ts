// Posture assessments (posture_assessments): which points each photo carries,
// how they are first placed from the pose model's landmarks, and what is
// measured from them. Pure, so the capture screen, the record and the tests
// read the same numbers. Shared with mobile/, so it imports nothing.
//
// Everything here is an estimate from a photo, for documenting and
// explaining -- never a diagnosis -- and the screens say so.
//
// Coordinates are pixels of the photo as stored (x right, y DOWN). "Right"
// and "left" in point names are the PATIENT's: in a front photo their right
// is on the viewer's left, in a back photo on the viewer's right.

export type PostureView = 'front' | 'right' | 'back' | 'left'
export type Pt = [number, number]
export type Points = Record<string, Pt>

export const POSTURE_VIEWS: PostureView[] = ['front', 'right', 'back', 'left']
export const VIEW_LABELS: Record<PostureView, string> = { front: 'Frente', right: 'Lado derecho', back: 'Espalda', left: 'Lado izquierdo' }

const PAIRED = ['earR', 'earL', 'shoulderR', 'shoulderL', 'hipR', 'hipL', 'kneeR', 'kneeL', 'ankleR', 'ankleL']
const SIDE = ['ear', 'shoulder', 'hip', 'knee', 'ankle']
export const VIEW_POINTS: Record<PostureView, string[]> = { front: PAIRED, back: PAIRED, right: SIDE, left: SIDE }
export const POINT_LABELS: Record<string, string> = {
  ear: 'Oreja', shoulder: 'Hombro', hip: 'Cadera', knee: 'Rodilla', ankle: 'Tobillo', heel: 'Talón', toe: 'Punta del pie',
  earR: 'Oreja D', earL: 'Oreja I', shoulderR: 'Hombro D', shoulderL: 'Hombro I', hipR: 'Cadera D', hipL: 'Cadera I', kneeR: 'Rodilla D', kneeL: 'Rodilla I', ankleR: 'Tobillo D', ankleL: 'Tobillo I', toeR: 'Pie D', toeL: 'Pie I',
  asisR: 'EIAS D', asisL: 'EIAS I', patellaR: 'Rótula D', patellaL: 'Rótula I', tubR: 'Tuberosidad D', tubL: 'Tuberosidad I',
}

// The Q-angle, on the front photo only and only when the practitioner asks
// for it: the anterior superior iliac spine, the middle of the kneecap and the
// tibial tuberosity of each leg. The pose model gives none of the three, so
// they start where they usually sit relative to its hip, knee and ankle
// (qAngleDefaults) and are dragged onto the body.
export const Q_POINTS = ['asisR', 'asisL', 'patellaR', 'patellaL', 'tubR', 'tubL']
export const hasQAngle = (p: Points) => Q_POINTS.every((k) => !!p[k])

/** The points one posture photo carries: its own, and the Q-angle's when they were added to a front photo. */
export function posturePointNames(view: PostureView, p: Points): string[] {
  return view === 'front' && hasQAngle(p) ? [...VIEW_POINTS[view], ...Q_POINTS] : VIEW_POINTS[view]
}

/** Where the Q-angle's points start on a front photo: the spine a little above and inside the hip point, the kneecap on the knee, the tuberosity just below it. */
export function qAngleDefaults(p: Points): Points {
  const out: Points = {}
  for (const s of ['R', 'L'] as const) {
    const hip = p[`hip${s}`]!
    const knee = p[`knee${s}`]!
    const ankle = p[`ankle${s}`]!
    const other = p[`hip${s === 'R' ? 'L' : 'R'}`]!
    const thigh = Math.hypot(knee[0] - hip[0], knee[1] - hip[1])
    out[`asis${s}`] = [Math.round(hip[0] + (other[0] - hip[0]) * 0.12), Math.round(hip[1] - thigh * 0.12)]
    out[`patella${s}`] = [Math.round(knee[0]), Math.round(knee[1] - thigh * 0.03)]
    out[`tub${s}`] = [Math.round(knee[0] + (ankle[0] - knee[0]) * 0.15), Math.round(knee[1] + (ankle[1] - knee[1]) * 0.15)]
  }
  return out
}

// MediaPipe Pose landmark indices (patient's left / right).
const MP: Record<string, number> = { nose: 0, earL: 7, earR: 8, shoulderL: 11, shoulderR: 12, hipL: 23, hipR: 24, kneeL: 25, kneeR: 26, ankleL: 27, ankleR: 28, heelL: 29, heelR: 30, toeL: 31, toeR: 32 }
export const POSE_LANDMARK_INDEX: Readonly<Record<string, number>> = MP

export interface Landmark { x: number; y: number; visibility?: number }

/**
 * The view's points from the pose model's landmarks (normalised 0-1), and
 * which way a side photo faces: the nose ahead of the ear is the front.
 */
export function pointsFromLandmarks(view: PostureView, landmarks: Landmark[], width: number, height: number): { points: Points; facing: 'right' | 'left' | null } {
  const at = (i: number): Pt => [Math.round(landmarks[i]!.x * width), Math.round(landmarks[i]!.y * height)]
  if (view === 'front' || view === 'back') {
    return { points: Object.fromEntries(PAIRED.map((k) => [k, at(MP[k]!)])) as Points, facing: null }
  }
  const s = view === 'right' ? 'R' : 'L'
  const points = Object.fromEntries(SIDE.map((k) => [k, at(MP[`${k}${s}`]!)])) as Points
  const nose = landmarks[MP.nose!]
  const facing = nose ? (nose.x * width >= points.ear![0] ? 'right' : 'left') : view === 'right' ? 'right' : 'left'
  return { points, facing }
}

/** Where to start when the model finds nobody: a standing figure, to drag into place. */
export function defaultPoints(view: PostureView, width: number, height: number): { points: Points; facing: 'right' | 'left' | null } {
  const cx = width / 2
  const y = (f: number): number => Math.round(height * f)
  if (view === 'front' || view === 'back') {
    // The patient's right is on the viewer's left from the front, on the right from behind.
    const r = view === 'front' ? -1 : 1
    const pair = (name: string, fy: number, dx: number): [string, Pt][] => [
      [`${name}R`, [Math.round(cx + r * dx * width), y(fy)]],
      [`${name}L`, [Math.round(cx - r * dx * width), y(fy)]],
    ]
    return {
      points: Object.fromEntries([...pair('ear', 0.12, 0.04), ...pair('shoulder', 0.22, 0.1), ...pair('hip', 0.5, 0.07), ...pair('knee', 0.72, 0.05), ...pair('ankle', 0.92, 0.05)]) as Points,
      facing: null,
    }
  }
  const facing = view === 'right' ? 'right' : 'left'
  return { points: { ear: [Math.round(cx), y(0.12)], shoulder: [Math.round(cx), y(0.22)], hip: [Math.round(cx), y(0.5)], knee: [Math.round(cx), y(0.72)], ankle: [Math.round(cx), y(0.92)] }, facing }
}

// The ear (tragion) sits at about 93.6 % of standing height: from the
// patient's height and how far apart ear and ankle are in the photo, we get
// pixels per centimetre. Good to a centimetre or two, which is what a
// before/after comparison needs.
export const EAR_HEIGHT_RATIO = 0.936

/**
 * Estimated load of the head on the neck by how far it tips forward, after
 * Hansraj (Surg Technol Int, 2014): about 5 kg upright, 12 at 15°, 18 at
 * 30°, 22 at 45°, 27 at 60°. Linear between those, flat beyond.
 */
const HANSRAJ: [number, number][] = [[0, 5.4], [15, 12.2], [30, 18.1], [45, 22.2], [60, 27.2]]
export function hansrajHeadWeight(angleDeg: number): number {
  const a = Math.max(0, Math.min(60, angleDeg))
  for (let i = 1; i < HANSRAJ.length; i++) {
    const [a1, w1] = HANSRAJ[i]!
    const [a0, w0] = HANSRAJ[i - 1]!
    if (a <= a1) return Math.round((w0 + ((a - a0) / (a1 - a0)) * (w1 - w0)) * 10) / 10
  }
  return HANSRAJ[HANSRAJ.length - 1]![1]
}

export interface FrontMetrics {
  /** Degrees; positive when the patient's RIGHT side is lower. */
  headTilt: number
  shoulderTilt: number
  hipTilt: number
  /** cm off the vertical from between the ankles; positive towards the patient's right. */
  headShift: number
  shoulderShift: number
  hipShift: number
  /**
   * Degrees each knee sits off the straight line from hip to ankle: positive
   * when it points in, towards the other knee, negative when it points out.
   * Not the clinical Q-angle (that needs the kneecap and tibial tuberosity,
   * which a photo's points do not give). Absent on assessments saved before
   * 21 Oct 2026; measureView works it out from their points.
   */
  kneeAngleR?: number
  kneeAngleL?: number
  /**
   * The Q-angle of each leg, degrees: between the line from the iliac spine
   * to the kneecap and the line from the kneecap to the tibial tuberosity.
   * Only when those points were placed (Q_POINTS), on the front photo.
   */
  qAngleR?: number
  qAngleL?: number
}
export interface SideMetrics {
  /** cm ahead of the vertical from the ankle; negative is behind it. */
  earForward: number
  shoulderForward: number
  hipForward: number
  kneeForward: number
  /** Degrees the ear sits ahead of the shoulder, from vertical. */
  headAngle: number
  /** kg, estimated (hansrajHeadWeight). */
  headWeight: number
  /**
   * kg the neck holds beyond the head's upright weight: headWeight less
   * about 5.4. Absent on assessments saved before 20 Nov 2026; measureView
   * works it out from their points.
   */
  neckLoad?: number
  /**
   * cm of standing height the posture takes away, estimated: for each
   * segment from ear to ankle, how much longer it is than the height it
   * spans. Same absence as neckLoad.
   */
  heightLoss?: number
}
export type ViewMetrics = FrontMetrics | SideMetrics

// `|| 0` turns -0 into 0, so a level line reads "0" and compares equal.
const round1 = (n: number) => Math.round(n * 10) / 10 || 0
const deg = (rad: number) => (rad * 180) / Math.PI
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

/**
 * The points as they would sit had the camera been held straight. `tilt` is
 * how many degrees a true vertical leans clockwise in the photo (a camera
 * turned anticlockwise by that much took it); the points are turned back by
 * as much. Every measurement is relative between points, so turning about
 * the photo's corner is as good as about its centre.
 */
export function straighten(p: Points, tilt: number | null | undefined): Points {
  if (!tilt) return p
  const a = (-tilt * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return Object.fromEntries(Object.entries(p).map(([k, [x, y]]) => [k, [x * c - y * s, x * s + y * c] as Pt]))
}

/**
 * The camera's tilt from the device's own sensor (DeviceMotionEvent's
 * accelerationIncludingGravity, in device axes), as `straighten` reads it:
 * degrees a true vertical leans clockwise in a portrait photo taken now.
 * iOS reports gravity and Android its reaction, the same axes with opposite
 * signs, so the signs are taken from whichever way `y` points. `pitch` is
 * how far the device leans towards or away from the patient, which no
 * turning of the photo undoes. Null when the device is not upright enough
 * for a portrait photo (flat on a table, or on its side).
 */
export function deviceTilt(g: { x: number | null; y: number | null; z: number | null }): { tilt: number; pitch: number } | null {
  if (g.x === null || g.y === null || g.z === null) return null
  const ay = Math.abs(g.y)
  if (ay < 1 || ay < Math.abs(g.x) || ay < Math.abs(g.z)) return null
  const s = Math.sign(g.y)
  return { tilt: round1(deg(Math.atan2(g.x * s, ay))), pitch: round1(deg(Math.atan2(Math.abs(g.z), ay))) }
}

/** The angle at `b` between the lines to `a` and to `c`, 0-180 degrees. */
export function angleAt(a: Pt, b: Pt, c: Pt): number {
  const v1 = Math.atan2(a[1] - b[1], a[0] - b[0])
  const v2 = Math.atan2(c[1] - b[1], c[0] - b[0])
  let d = Math.abs(deg(v1 - v2))
  if (d > 180) d = 360 - d
  return round1(d)
}

/** Degrees the line from `low` up to `high` leans off vertical, + when it leans `ahead` (+1 is +x). */
export function leanFromVertical(low: Pt, high: Pt, ahead: 1 | -1): number {
  return round1(deg(Math.atan2((high[0] - low[0]) * ahead, low[1] - high[1])))
}

/** See FrontMetrics.kneeAngleR: the bend at the knee, + when it points towards the other knee. */
export function kneeLineAngle(hip: Pt, knee: Pt, ankle: Pt, otherKnee: Pt): number {
  const thigh = Math.atan2(knee[0] - hip[0], knee[1] - hip[1])
  const shin = Math.atan2(ankle[0] - knee[0], ankle[1] - knee[1])
  const bend = Math.abs(deg(thigh - shin))
  // Where the straight hip-ankle line passes at the knee's height.
  const t = (knee[1] - hip[1]) / ((ankle[1] - hip[1]) || 1)
  const lineX = hip[0] + t * (ankle[0] - hip[0])
  const inward = Math.sign(knee[0] - lineX) === Math.sign(otherKnee[0] - lineX)
  return round1(inward ? bend : -bend)
}

/** Pixels per cm in this photo, from the patient's height. */
export function pxPerCm(view: PostureView, p: Points, heightCm: number): number {
  const ear = view === 'front' || view === 'back' ? mid(p.earR!, p.earL!) : p.ear!
  const ankle = view === 'front' || view === 'back' ? mid(p.ankleR!, p.ankleL!) : p.ankle!
  const px = Math.abs(ankle[1] - ear[1])
  return px > 0 && heightCm > 0 ? px / (EAR_HEIGHT_RATIO * heightCm) : 0
}

export function measureView(view: PostureView, points: Points, heightCm: number, facing: 'right' | 'left' | null = null, tilt: number | null = null): ViewMetrics {
  const p = straighten(points, tilt)
  const k = pxPerCm(view, p, heightCm) || 1
  if (view === 'front' || view === 'back') {
    // Positive tilt: the right-side point is lower (larger y).
    const tilt = (r: Pt, l: Pt) => round1(deg(Math.atan2(r[1] - l[1], Math.abs(r[0] - l[0]) || 1)))
    // Towards the patient's right is -x from the front, +x from behind.
    const toRight = view === 'front' ? -1 : 1
    const base = mid(p.ankleR!, p.ankleL!)[0]
    const shift = (a: Pt, b: Pt) => round1(((mid(a, b)[0] - base) * toRight) / k)
    return {
      headTilt: tilt(p.earR!, p.earL!),
      shoulderTilt: tilt(p.shoulderR!, p.shoulderL!),
      hipTilt: tilt(p.hipR!, p.hipL!),
      headShift: shift(p.earR!, p.earL!),
      shoulderShift: shift(p.shoulderR!, p.shoulderL!),
      hipShift: shift(p.hipR!, p.hipL!),
      kneeAngleR: kneeLineAngle(p.hipR!, p.kneeR!, p.ankleR!, p.kneeL!),
      kneeAngleL: kneeLineAngle(p.hipL!, p.kneeL!, p.ankleL!, p.kneeR!),
      ...(view === 'front' && hasQAngle(p)
        ? { qAngleR: round1(180 - angleAt(p.asisR!, p.patellaR!, p.tubR!)), qAngleL: round1(180 - angleAt(p.asisL!, p.patellaL!, p.tubL!)) }
        : {}),
    }
  }
  const ahead = (facing ?? (view === 'right' ? 'right' : 'left')) === 'right' ? 1 : -1
  const fwd = (pt: Pt) => round1(((pt[0] - p.ankle![0]) * ahead) / k)
  const headAngle = round1(deg(Math.atan2((p.ear![0] - p.shoulder![0]) * ahead, p.shoulder![1] - p.ear![1])))
  const headWeight = hansrajHeadWeight(headAngle)
  const chain = [p.ear!, p.shoulder!, p.hip!, p.knee!, p.ankle!]
  let lost = 0
  for (let i = 1; i < chain.length; i++) {
    const [a, b] = [chain[i - 1]!, chain[i]!]
    lost += Math.hypot(b[0] - a[0], b[1] - a[1]) - Math.abs(b[1] - a[1])
  }
  return {
    earForward: fwd(p.ear!),
    shoulderForward: fwd(p.shoulder!),
    hipForward: fwd(p.hip!),
    kneeForward: fwd(p.knee!),
    headAngle,
    headWeight,
    neckLoad: round1(Math.max(0, headWeight - HANSRAJ[0]![1])),
    heightLoss: round1(lost / k),
  }
}

/**
 * The vertical through a point (the ankle, or between the ankles), from the
 * top of the photo to the bottom, as it really runs in a photo taken `tilt`
 * degrees off straight (see `straighten`): leaning clockwise by that much.
 */
export function plumbLine(x: number, y: number, height: number, tilt: number | null | undefined): { x1: number; y1: number; x2: number; y2: number } {
  const lean = Math.tan(((tilt ?? 0) * Math.PI) / 180)
  return { x1: x + y * lean, y1: 0, x2: x - (height - y) * lean, y2: height }
}

/**
 * The squared grid behind a posture photo: 24 rows to the photo's height, and
 * one column line on the vertical so the rest step out from it evenly. Drawn
 * DARKEN over the photo (Overlay.vue, posturePdf.ts) -- it shows on the white
 * around a cut-out person and gives way to anything darker than itself, which
 * is the person, so it reads as behind them rather than across them.
 */
export const POSTURE_GRID_COLOR = '#C9D3DE'
export function postureGrid(width: number, height: number, plumbX: number): { xs: number[]; ys: number[] } {
  const step = height / 24
  const xs: number[] = []
  const ys: number[] = []
  if (!(step > 0)) return { xs, ys }
  for (let y = step; y < height - 0.5; y += step) ys.push(Math.round(y * 10) / 10)
  for (let x = (((plumbX % step) + step) % step); x < width; x += step) xs.push(Math.round(x * 10) / 10)
  return { xs, ys }
}

/**
 * Whether the pose model's outline (one 0-1 value per pixel, row by row) is
 * believable as one standing person, and so can put them on white
 * (Capture.vue). Not when it covers almost nothing (the person is tiny, or
 * the model is unsure) nor almost the whole frame (they fill the photo, or
 * the outline swallowed the room): then the photo stays as taken, and the
 * screen says which, so the next photo can be taken differently. `share` is
 * the part of the frame counted as person, rounded to the percent.
 */
export type CutoutVerdict = 'ok' | 'too-small' | 'too-large' | 'bad-size'
export const CUTOUT_MIN_SHARE = 0.02
export const CUTOUT_MAX_SHARE = 0.9
export function cutoutVerdict(mask: { width: number; height: number; data: ArrayLike<number> }): { verdict: CutoutVerdict; share: number | null } {
  const n = mask.width * mask.height
  if (!(n > 0) || mask.data.length < n) return { verdict: 'bad-size', share: null }
  let person = 0
  for (let i = 0; i < n; i++) if (mask.data[i]! > 0.5) person++
  const share = Math.round((person / n) * 100) / 100
  if (person < n * CUTOUT_MIN_SHARE) return { verdict: 'too-small', share }
  if (person > n * CUTOUT_MAX_SHARE) return { verdict: 'too-large', share }
  return { verdict: 'ok', share }
}

/**
 * One photo of an assessment as stored. `tilt`: degrees the camera was off
 * straight (see `straighten`), from the device's sensor or set by hand;
 * absent is straight, as every photo saved before 20 Nov 2026 was taken to be.
 */
export interface StoredView { photo: string; width: number; height: number; points: Points; facing: 'right' | 'left' | null; tilt?: number | null }
export type StoredViews = Partial<Record<PostureView, StoredView>>

/** Every view's measurements, as stored on the assessment. */
export function measureAll(views: StoredViews, heightCm: number): Partial<Record<PostureView, ViewMetrics>> {
  const out: Partial<Record<PostureView, ViewMetrics>> = {}
  for (const v of POSTURE_VIEWS) {
    const s = views[v]
    if (s) out[v] = measureView(v, s.points, heightCm, s.facing, s.tilt ?? null)
  }
  return out
}

// Share of body weight in each segment and where along it that weight sits,
// from standard anthropometric tables (Winter, Biomechanics and Motor Control
// of Human Movement): head and neck 8.1 %, trunk 49.7 % with the arms' 10 %
// hanging beside it, thighs 10 % each at 43 % of the way down from the hip,
// shanks 4.65 % at 43 % from the knee, feet 1.45 % at the ankle. Averages for
// adults, which is what makes the result an estimate.
const SEG = { head: 8.1, trunk: 59.7, thigh: 10, shank: 4.65, foot: 1.45, along: 0.433 }

/**
 * Where the body's weight falls along the photo's x axis, in pixels: the
 * segments' centres weighted by their share of the body. Front and back
 * photos weigh each leg on its own side; side photos have one of each.
 * Works on any photo with ear, shoulder, hip, knee and ankle points --
 * a squat's as much as a standing one's.
 */
export function centreOfMassX(paired: boolean, p: Points): number | null {
  const at = (a: Pt | undefined, b: Pt | undefined, f: number) => (a && b ? a[0] + (b[0] - a[0]) * f : null)
  const parts: [number | null, number][] = []
  if (paired) {
    if (!p.earR || !p.earL || !p.shoulderR || !p.shoulderL || !p.hipR || !p.hipL) return null
    parts.push([mid(p.earR, p.earL)[0], SEG.head], [mid(mid(p.shoulderR, p.shoulderL), mid(p.hipR, p.hipL))[0], SEG.trunk])
    for (const s of ['R', 'L']) {
      parts.push([at(p[`hip${s}`], p[`knee${s}`], SEG.along), SEG.thigh], [at(p[`knee${s}`], p[`ankle${s}`], SEG.along), SEG.shank], [p[`ankle${s}`]?.[0] ?? null, SEG.foot])
    }
  } else {
    if (!p.ear || !p.shoulder || !p.hip) return null
    parts.push([p.ear[0], SEG.head], [mid(p.shoulder, p.hip)[0], SEG.trunk], [at(p.hip, p.knee, SEG.along), SEG.thigh * 2], [at(p.knee, p.ankle, SEG.along), SEG.shank * 2], [p.ankle?.[0] ?? null, SEG.foot * 2])
  }
  if (parts.some(([x]) => x === null)) return null
  const total = parts.reduce((s, [, w]) => s + w, 0)
  return parts.reduce((s, [x, w]) => s + x! * w, 0) / total
}

/**
 * Where the body's weight falls over the feet, estimated from the points:
 * `rightShare`, the percentage over the patient's right foot (from the front
 * or back photo, by where that point sits between the ankles), and
 * `forwardCm`, how far ahead of the ankle it falls (from the side photo).
 * Each null without its photo.
 */
export function postureBalance(views: StoredViews, heightCm: number): { rightShare: number | null; forwardCm: number | null } {
  let rightShare: number | null = null
  let forwardCm: number | null = null
  const fv = views.front ? 'front' : views.back ? 'back' : null
  if (fv) {
    const p = straighten(views[fv]!.points, views[fv]!.tilt)
    const x = centreOfMassX(true, p)
    const span = p.ankleR![0] - p.ankleL![0]
    if (x !== null && Math.abs(span) > 1) rightShare = Math.round(Math.max(0, Math.min(1, (x - p.ankleL![0]) / span)) * 100)
  }
  const sv = views.right ? 'right' : views.left ? 'left' : null
  if (sv && heightCm > 0) {
    const s = views[sv]!
    const p = straighten(s.points, s.tilt)
    const x = centreOfMassX(false, p)
    const k = pxPerCm(sv, p, heightCm)
    const ahead = (s.facing ?? (sv === 'right' ? 'right' : 'left')) === 'right' ? 1 : -1
    if (x !== null && k > 0) forwardCm = round1(((x - p.ankle![0]) * ahead) / k)
  }
  return { rightShare, forwardCm }
}

// How far from aligned each number has to be to count fully against the
// alignment index, and how much it counts. Together they make 100; a number
// counts in proportion up to its `full`. Sized so that the deviations a
// photo commonly shows in someone without complaints -- a degree of tilt, a
// centimetre off centre -- cost a few points, not tens.
const ALIGNMENT: { full: number; weight: number; value: (s: SideMetrics | undefined, f: FrontMetrics | undefined) => number | null }[] = [
  { full: 6, weight: 20, value: (s) => (s ? s.earForward - s.shoulderForward : null) },
  { full: 6, weight: 10, value: (s) => s?.shoulderForward ?? null },
  { full: 6, weight: 10, value: (s) => s?.hipForward ?? null },
  { full: 6, weight: 5, value: (s) => s?.kneeForward ?? null },
  { full: 5, weight: 5, value: (_, f) => f?.headTilt ?? null },
  { full: 5, weight: 10, value: (_, f) => f?.shoulderTilt ?? null },
  { full: 5, weight: 10, value: (_, f) => f?.hipTilt ?? null },
  { full: 4, weight: 5, value: (_, f) => f?.headShift ?? null },
  { full: 4, weight: 10, value: (_, f) => f?.shoulderShift ?? null },
  { full: 4, weight: 10, value: (_, f) => f?.hipShift ?? null },
  { full: 10, weight: 5, value: (_, f) => (f?.kneeAngleR === undefined || f.kneeAngleL === undefined ? null : Math.max(Math.abs(f.kneeAngleR), Math.abs(f.kneeAngleL))) },
]

/**
 * One number for the whole posture, 0-100: 100 is aligned in everything
 * measured, and each measure takes points off in proportion to how far it is
 * from aligned (ALIGNMENT). Needs a side photo and a front or back one, so
 * that two assessments' indices are made of the same things. QuiroFlow's
 * own summary, to follow over time -- not a clinical scale.
 */
export function alignmentIndex(metrics: Partial<Record<PostureView, ViewMetrics>>): number | null {
  const side = (metrics.right ?? metrics.left) as SideMetrics | undefined
  const front = (metrics.front ?? metrics.back) as FrontMetrics | undefined
  if (!side || !front) return null
  let lost = 0
  let possible = 0
  for (const a of ALIGNMENT) {
    const v = a.value(side, front)
    if (v === null || v === undefined) continue
    possible += a.weight
    lost += a.weight * Math.min(1, Math.abs(v) / a.full)
  }
  return possible ? Math.round(100 - (lost / possible) * 100) : null
}

/** A number written on the photo beside the point it belongs to (Overlay.vue). */
export interface PhotoCallout { key: string; at: Pt; value: number; unit: '°' | 'cm' | 'kg'; side: 'left' | 'right'; label: { es: string; en: string } }

/**
 * What a posture photo says about itself, placed beside its points: tilts on
 * the outer side of the pair, each knee beside itself, and on a side photo
 * each distance from the vertical behind the body, where it covers nothing.
 */
export function postureCallouts(view: PostureView, points: Points, heightCm: number, facing: 'right' | 'left' | null, tilt: number | null = null): PhotoCallout[] {
  const m = measureView(view, points, heightCm, facing, tilt)
  const p = points
  if (view === 'front' || view === 'back') {
    const f = m as FrontMetrics
    const outer = (a: Pt, b: Pt): { at: Pt; side: 'left' | 'right' } => (a[0] < b[0] ? { at: a, side: 'left' } : { at: b, side: 'left' })
    const out: PhotoCallout[] = [
      { key: 'head', ...outer(p.earR!, p.earL!), value: Math.abs(f.headTilt), unit: '°', label: { es: 'Cabeza', en: 'Head' } },
      { key: 'shoulders', ...outer(p.shoulderR!, p.shoulderL!), value: Math.abs(f.shoulderTilt), unit: '°', label: { es: 'Hombros', en: 'Shoulders' } },
      { key: 'pelvis', ...outer(p.hipR!, p.hipL!), value: Math.abs(f.hipTilt), unit: '°', label: { es: 'Pelvis', en: 'Pelvis' } },
    ]
    const kneeSide = (k: Pt, other: Pt): 'left' | 'right' => (k[0] < other[0] ? 'left' : 'right')
    if (f.kneeAngleR !== undefined) out.push({ key: 'kneeR', at: p.kneeR!, side: kneeSide(p.kneeR!, p.kneeL!), value: f.kneeAngleR, unit: '°', label: { es: 'Rodilla D', en: 'Knee R' } })
    if (f.kneeAngleL !== undefined) out.push({ key: 'kneeL', at: p.kneeL!, side: kneeSide(p.kneeL!, p.kneeR!), value: f.kneeAngleL, unit: '°', label: { es: 'Rodilla I', en: 'Knee L' } })
    if (f.qAngleR !== undefined) out.push({ key: 'qR', at: p.patellaR!, side: kneeSide(p.kneeR!, p.kneeL!), value: f.qAngleR, unit: '°', label: { es: 'Q D', en: 'Q R' } })
    if (f.qAngleL !== undefined) out.push({ key: 'qL', at: p.patellaL!, side: kneeSide(p.kneeL!, p.kneeR!), value: f.qAngleL, unit: '°', label: { es: 'Q I', en: 'Q L' } })
    return out
  }
  const s = m as SideMetrics
  const behind: 'left' | 'right' = (facing ?? (view === 'right' ? 'right' : 'left')) === 'right' ? 'left' : 'right'
  return [
    { key: 'headAngle', at: p.ear!, side: behind, value: s.headAngle, unit: '°', label: { es: 'Cabeza', en: 'Head' } },
    { key: 'shoulder', at: p.shoulder!, side: behind, value: s.shoulderForward, unit: 'cm', label: { es: 'Hombro', en: 'Shoulder' } },
    { key: 'hip', at: p.hip!, side: behind, value: s.hipForward, unit: 'cm', label: { es: 'Cadera', en: 'Hip' } },
    { key: 'knee', at: p.knee!, side: behind, value: s.kneeForward, unit: 'cm', label: { es: 'Rodilla', en: 'Knee' } },
  ]
}

/** The few numbers the record and the patient see first: from the right side, else the left; tilts from the front, else the back. */
export function postureHeadline(metrics: Partial<Record<PostureView, ViewMetrics>>): { headForward: number | null; headWeight: number | null; headAngle: number | null; shoulderTilt: number | null; hipTilt: number | null } {
  const side = (metrics.right ?? metrics.left) as SideMetrics | undefined
  const front = (metrics.front ?? metrics.back) as FrontMetrics | undefined
  return {
    headForward: side ? round1(side.earForward - side.shoulderForward) : null,
    headWeight: side?.headWeight ?? null,
    headAngle: side?.headAngle ?? null,
    shoulderTilt: front?.shoulderTilt ?? null,
    hipTilt: front?.hipTilt ?? null,
  }
}

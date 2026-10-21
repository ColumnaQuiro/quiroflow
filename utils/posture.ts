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
  ear: 'Oreja', shoulder: 'Hombro', hip: 'Cadera', knee: 'Rodilla', ankle: 'Tobillo',
  earR: 'Oreja D', earL: 'Oreja I', shoulderR: 'Hombro D', shoulderL: 'Hombro I', hipR: 'Cadera D', hipL: 'Cadera I', kneeR: 'Rodilla D', kneeL: 'Rodilla I', ankleR: 'Tobillo D', ankleL: 'Tobillo I',
}

// MediaPipe Pose landmark indices (patient's left / right).
const MP: Record<string, number> = { nose: 0, earL: 7, earR: 8, shoulderL: 11, shoulderR: 12, hipL: 23, hipR: 24, kneeL: 25, kneeR: 26, ankleL: 27, ankleR: 28 }

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
}
export type ViewMetrics = FrontMetrics | SideMetrics

// `|| 0` turns -0 into 0, so a level line reads "0" and compares equal.
const round1 = (n: number) => Math.round(n * 10) / 10 || 0
const deg = (rad: number) => (rad * 180) / Math.PI
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

/** See FrontMetrics.kneeAngleR: the bend at the knee, + when it points towards the other knee. */
function kneeAngle(hip: Pt, knee: Pt, ankle: Pt, otherKnee: Pt): number {
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

export function measureView(view: PostureView, p: Points, heightCm: number, facing: 'right' | 'left' | null = null): ViewMetrics {
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
      kneeAngleR: kneeAngle(p.hipR!, p.kneeR!, p.ankleR!, p.kneeL!),
      kneeAngleL: kneeAngle(p.hipL!, p.kneeL!, p.ankleL!, p.kneeR!),
    }
  }
  const ahead = (facing ?? (view === 'right' ? 'right' : 'left')) === 'right' ? 1 : -1
  const fwd = (pt: Pt) => round1(((pt[0] - p.ankle![0]) * ahead) / k)
  const headAngle = round1(deg(Math.atan2((p.ear![0] - p.shoulder![0]) * ahead, p.shoulder![1] - p.ear![1])))
  return {
    earForward: fwd(p.ear!),
    shoulderForward: fwd(p.shoulder!),
    hipForward: fwd(p.hip!),
    kneeForward: fwd(p.knee!),
    headAngle,
    headWeight: hansrajHeadWeight(headAngle),
  }
}

export interface StoredView { photo: string; width: number; height: number; points: Points; facing: 'right' | 'left' | null }
export type StoredViews = Partial<Record<PostureView, StoredView>>

/** Every view's measurements, as stored on the assessment. */
export function measureAll(views: StoredViews, heightCm: number): Partial<Record<PostureView, ViewMetrics>> {
  const out: Partial<Record<PostureView, ViewMetrics>> = {}
  for (const v of POSTURE_VIEWS) {
    const s = views[v]
    if (s) out[v] = measureView(v, s.points, heightCm, s.facing)
  }
  return out
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

import {
  angleAt,
  centreOfMassX,
  EAR_HEIGHT_RATIO,
  kneeLineAngle,
  leanFromVertical,
  POSE_LANDMARK_INDEX,
  posturePointNames,
  straighten,
  type Landmark,
  type PhotoCallout,
  type Points,
  type PostureView,
  type Pt,
  type StoredView,
} from './posture'

// Squat assessments: posture_assessments rows of kind 'squat'. Two photos per
// angle -- standing ("arriba") and at the lowest point ("abajo") -- from the
// front, the side or both, the points placed by the same pose model as a
// posture assessment and dragged into place the same way, and what is
// measured from them. Pure, so the capture screen, the record and the tests
// read the same numbers. Shared with mobile/, so it imports nothing but its
// neighbours.
//
// As with posture, everything here is an estimate from a photo, to document
// and to follow over time -- never a diagnosis, and no "normal" either: the
// screens show numbers and how they move, nothing more.
//
// Coordinates are the photo's own pixels (x right, y DOWN); R and L in point
// names are the PATIENT's.

export type SquatView = 'front_up' | 'front_down' | 'side_up' | 'side_down'
export type SquatAngles = 'both' | 'front' | 'side'
export type SquatViews = Partial<Record<SquatView, StoredView>>
/** Any photo an assessment holds, posture or squat: what the shared overlay draws. */
export type PhotoView = PostureView | SquatView

export const SQUAT_VIEWS: SquatView[] = ['front_up', 'front_down', 'side_up', 'side_down']
export const SQUAT_VIEW_LABELS: Record<SquatView, { es: string; en: string }> = {
  front_up: { es: 'Frente · arriba', en: 'Front · standing' },
  front_down: { es: 'Frente · abajo', en: 'Front · bottom' },
  side_up: { es: 'Lado · arriba', en: 'Side · standing' },
  side_down: { es: 'Lado · abajo', en: 'Side · bottom' },
}
export const SQUAT_ANGLE_LABELS: Record<SquatAngles, { es: string; en: string }> = {
  both: { es: 'Frente y lado (4 fotos)', en: 'Front and side (4 photos)' },
  front: { es: 'Solo frente (2 fotos)', en: 'Front only (2 photos)' },
  side: { es: 'Solo lado (2 fotos)', en: 'Side only (2 photos)' },
}

export function squatViewsFor(angles: SquatAngles): SquatView[] {
  return angles === 'front' ? ['front_up', 'front_down'] : angles === 'side' ? ['side_up', 'side_down'] : SQUAT_VIEWS
}
export const isSquatView = (v: string): v is SquatView => (SQUAT_VIEWS as string[]).includes(v)
export const squatPlane = (v: SquatView): 'front' | 'side' => (v.startsWith('front') ? 'front' : 'side')
/** Front and back photos carry a point per side; side photos one of each. */
export const isPairedView = (v: PhotoView) => v === 'front' || v === 'back' || v === 'front_up' || v === 'front_down'

const FRONT = ['earR', 'earL', 'shoulderR', 'shoulderL', 'hipR', 'hipL', 'kneeR', 'kneeL', 'ankleR', 'ankleL', 'toeR', 'toeL']
const SIDE = ['ear', 'shoulder', 'hip', 'knee', 'ankle', 'heel', 'toe']
export const SQUAT_POINTS: Record<SquatView, string[]> = { front_up: FRONT, front_down: FRONT, side_up: SIDE, side_down: SIDE }

/** The points a photo carries, whichever kind of assessment it belongs to. */
export function photoPointNames(view: PhotoView, p: Points): string[] {
  return isSquatView(view) ? SQUAT_POINTS[view] : posturePointNames(view, p)
}

/** Which way a side photo faces: the toes ahead of the heel, which holds when the head does not (it drops in a squat). */
function facingOf(p: Points): 'right' | 'left' {
  return p.toe && p.heel ? (p.toe[0] >= p.heel[0] ? 'right' : 'left') : 'right'
}

/**
 * The photo's points from the pose model's landmarks (0-1). From the side,
 * whichever leg is nearer the camera: the model sees both, and the far one is
 * the guess.
 */
export function squatPointsFromLandmarks(view: SquatView, landmarks: Landmark[], width: number, height: number): { points: Points; facing: 'right' | 'left' | null } {
  const at = (i: number): Pt => [Math.round(landmarks[i]!.x * width), Math.round(landmarks[i]!.y * height)]
  if (squatPlane(view) === 'front') return { points: Object.fromEntries(FRONT.map((k) => [k, at(POSE_LANDMARK_INDEX[k]!)])) as Points, facing: null }
  const seen = (s: 'R' | 'L') => ['shoulder', 'hip', 'knee', 'ankle'].reduce((n, k) => n + (landmarks[POSE_LANDMARK_INDEX[`${k}${s}`]!]?.visibility ?? 0), 0)
  const s = seen('R') >= seen('L') ? 'R' : 'L'
  const points = Object.fromEntries(SIDE.map((k) => [k, at(POSE_LANDMARK_INDEX[`${k}${s}`]!)])) as Points
  return { points, facing: facingOf(points) }
}

/** Where to start when the model finds nobody: standing, or crouched at the bottom, to drag into place. */
export function squatDefaultPoints(view: SquatView, width: number, height: number): { points: Points; facing: 'right' | 'left' | null } {
  const cx = width / 2
  const X = (f: number) => Math.round(cx + f * width)
  const Y = (f: number) => Math.round(height * f)
  const down = view.endsWith('down')
  if (squatPlane(view) === 'front') {
    // The patient's right is on the viewer's left.
    const pair = (name: string, fy: number, dx: number): [string, Pt][] => [[`${name}R`, [X(-dx), Y(fy)]], [`${name}L`, [X(dx), Y(fy)]]]
    const rows: [string, number, number][] = down
      ? [['ear', 0.3, 0.04], ['shoulder', 0.4, 0.1], ['hip', 0.64, 0.08], ['knee', 0.7, 0.12], ['ankle', 0.92, 0.07], ['toe', 0.96, 0.09]]
      : [['ear', 0.12, 0.04], ['shoulder', 0.22, 0.1], ['hip', 0.5, 0.07], ['knee', 0.72, 0.06], ['ankle', 0.92, 0.06], ['toe', 0.96, 0.08]]
    return { points: Object.fromEntries(rows.flatMap(([n, fy, dx]) => pair(n, fy, dx))) as Points, facing: null }
  }
  const points: Points = down
    ? { ear: [X(0.06), Y(0.3)], shoulder: [X(0.02), Y(0.38)], hip: [X(-0.14), Y(0.66)], knee: [X(0.1), Y(0.68)], ankle: [X(0), Y(0.92)], heel: [X(-0.03), Y(0.95)], toe: [X(0.08), Y(0.95)] }
    : { ear: [X(0), Y(0.12)], shoulder: [X(0), Y(0.22)], hip: [X(0), Y(0.5)], knee: [X(0), Y(0.72)], ankle: [X(0), Y(0.92)], heel: [X(-0.03), Y(0.95)], toe: [X(0.08), Y(0.95)] }
  return { points, facing: 'right' }
}

export interface SquatFrontMetrics {
  /** Degrees each knee is off the line from hip to ankle: + towards the other knee (in), - away from it. */
  kneeInR: number
  kneeInL: number
  /** Degrees; + when the patient's RIGHT hip is lower. */
  pelvisTilt: number
  shoulderTilt: number
  /** cm the pelvis sits off the middle of the ankles; + towards the patient's right. Null without a standing photo to scale by. */
  shiftCm: number | null
  /** Distance between the knees over the distance between the ankles. */
  kneeWidth: number
  /** % of the body's weight over the right foot, estimated (centreOfMassX). */
  rightShare: number | null
}
export interface SquatSideMetrics {
  /** The angle at the knee between thigh and shin: 180 is straight, smaller is deeper. */
  kneeAngle: number
  /** The angle at the hip between trunk and thigh. */
  hipAngle: number
  /** Degrees the trunk (hip to shoulder) leans forward of vertical. */
  trunkLean: number
  /** Degrees the shin (ankle to knee) leans forward of vertical. */
  tibiaLean: number
  /** trunkLean - tibiaLean: 0 when trunk and shin are parallel. */
  trunkVsTibia: number
  /** Whether the hip point is below the knee point: below parallel. */
  hipBelowKnee: boolean
  /** cm the heel has risen against the standing photo; null without one to scale by. */
  heelLift: number | null
  /** cm the knee is ahead of the tip of the foot (negative: behind it). */
  kneePastToe: number | null
  /** cm the body's weight falls ahead of the middle of the foot (negative: towards the heel). */
  forwardCm: number | null
}
export type SquatMetrics = Partial<{ front_up: SquatFrontMetrics; front_down: SquatFrontMetrics; side_up: SquatSideMetrics; side_down: SquatSideMetrics }>

const round1 = (n: number) => Math.round(n * 10) / 10 || 0
const round2 = (n: number) => Math.round(n * 100) / 100 || 0
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

/**
 * Pixels per cm, from the standing photo of the same angle: ear to ankle is
 * about 93.6 % of standing height (EAR_HEIGHT_RATIO). The bottom photo is
 * taken from the same spot, so it borrows the standing one's scale.
 */
export function squatPxPerCm(standing: StoredView | undefined, plane: 'front' | 'side', heightCm: number): number | null {
  if (!standing || !(heightCm > 0)) return null
  const p = straighten(standing.points, standing.tilt)
  const ear = plane === 'front' ? (p.earR && p.earL ? mid(p.earR, p.earL) : null) : p.ear
  const ankle = plane === 'front' ? (p.ankleR && p.ankleL ? mid(p.ankleR, p.ankleL) : null) : p.ankle
  if (!ear || !ankle) return null
  const px = Math.abs(ankle[1] - ear[1])
  return px > 0 ? px / (EAR_HEIGHT_RATIO * heightCm) : null
}

export function measureSquatFront(points: Points, tilt: number | null | undefined, k: number | null): SquatFrontMetrics {
  const p = straighten(points, tilt)
  const tiltOf = (r: Pt, l: Pt) => round1((Math.atan2(r[1] - l[1], Math.abs(r[0] - l[0]) || 1) * 180) / Math.PI)
  const ankles = mid(p.ankleR!, p.ankleL!)
  const hips = mid(p.hipR!, p.hipL!)
  const span = p.ankleR![0] - p.ankleL![0]
  const com = centreOfMassX(true, p)
  return {
    kneeInR: kneeLineAngle(p.hipR!, p.kneeR!, p.ankleR!, p.kneeL!),
    kneeInL: kneeLineAngle(p.hipL!, p.kneeL!, p.ankleL!, p.kneeR!),
    pelvisTilt: tiltOf(p.hipR!, p.hipL!),
    shoulderTilt: tiltOf(p.shoulderR!, p.shoulderL!),
    // The patient's right is the viewer's left: -x.
    shiftCm: k ? round1(-(hips[0] - ankles[0]) / k) : null,
    kneeWidth: round2(Math.abs(p.kneeR![0] - p.kneeL![0]) / (Math.abs(span) || 1)),
    rightShare: com !== null && Math.abs(span) > 1 ? Math.round(Math.max(0, Math.min(1, (com - p.ankleL![0]) / span)) * 100) : null,
  }
}

export function measureSquatSide(points: Points, tilt: number | null | undefined, facing: 'right' | 'left' | null, k: number | null, standing: Points | null = null): SquatSideMetrics {
  const p = straighten(points, tilt)
  const ahead: 1 | -1 = (facing ?? facingOf(p)) === 'right' ? 1 : -1
  const trunkLean = leanFromVertical(p.hip!, p.shoulder!, ahead)
  const tibiaLean = leanFromVertical(p.ankle!, p.knee!, ahead)
  // A heel's height over its toe, so a floor that is not quite level in the
  // photo counts the same standing and at the bottom.
  const rise = (q: Points) => (q.toe && q.heel ? q.toe[1] - q.heel[1] : 0)
  const com = centreOfMassX(false, p)
  const midfoot = p.heel && p.toe ? mid(p.heel, p.toe) : p.ankle!
  return {
    kneeAngle: angleAt(p.hip!, p.knee!, p.ankle!),
    hipAngle: angleAt(p.shoulder!, p.hip!, p.knee!),
    trunkLean,
    tibiaLean,
    trunkVsTibia: round1(trunkLean - tibiaLean),
    hipBelowKnee: p.hip![1] > p.knee![1],
    heelLift: k && p.heel && p.toe ? round1(Math.max(0, rise(p) - (standing ? rise(standing) : 0)) / k) : null,
    kneePastToe: k && p.toe ? round1(((p.knee![0] - p.toe[0]) * ahead) / k) : null,
    forwardCm: k && com !== null ? round1(((com - midfoot[0]) * ahead) / k) : null,
  }
}

/** Every photo's measurements, as stored on the assessment. */
export function measureSquat(views: SquatViews, heightCm: number): SquatMetrics {
  const out: SquatMetrics = {}
  const kFront = squatPxPerCm(views.front_up, 'front', heightCm)
  const kSide = squatPxPerCm(views.side_up, 'side', heightCm)
  if (views.front_up) out.front_up = measureSquatFront(views.front_up.points, views.front_up.tilt, kFront)
  if (views.front_down) out.front_down = measureSquatFront(views.front_down.points, views.front_down.tilt, kFront)
  const standing = views.side_up ? straighten(views.side_up.points, views.side_up.tilt) : null
  if (views.side_up) out.side_up = measureSquatSide(views.side_up.points, views.side_up.tilt, views.side_up.facing, kSide, null)
  if (views.side_down) out.side_down = measureSquatSide(views.side_down.points, views.side_down.tilt, views.side_down.facing, kSide, standing)
  return out
}

/** The numbers the record leads with: all from the bottom photos, where the squat is. */
export interface SquatHeadline {
  kneeIn: number | null
  kneeInR: number | null
  kneeInL: number | null
  depth: number | null
  hipBelowKnee: boolean | null
  trunkLean: number | null
  trunkVsTibia: number | null
  shift: number | null
  heelLift: number | null
  rightShare: number | null
}
export function squatHeadline(m: SquatMetrics): SquatHeadline {
  const f = m.front_down
  const s = m.side_down
  return {
    kneeIn: f ? Math.max(f.kneeInR, f.kneeInL) : null,
    kneeInR: f?.kneeInR ?? null,
    kneeInL: f?.kneeInL ?? null,
    depth: s?.kneeAngle ?? null,
    hipBelowKnee: s?.hipBelowKnee ?? null,
    trunkLean: s?.trunkLean ?? null,
    trunkVsTibia: s?.trunkVsTibia ?? null,
    shift: f?.shiftCm ?? null,
    heelLift: s?.heelLift ?? null,
    rightShare: f?.rightShare ?? null,
  }
}

export type SquatTrendKey = 'kneeIn' | 'depth' | 'trunkVsTibia' | 'shift' | 'heelLift'
export interface SquatTrendMetric { key: SquatTrendKey; label: { es: string; en: string }; unit: '°' | 'cm'; idealLabel: { es: string; en: string } | null; help: { es: string; en: string } }

/**
 * What the record can follow from one squat to the next, each plotted as its
 * distance from 0, so lower is always the way the squat is going well: the
 * knee that goes in more, the knee angle (deeper is smaller), trunk against
 * shin, the pelvis off centre and the heel's rise.
 */
export const SQUAT_TREND_METRICS: SquatTrendMetric[] = [
  { key: 'kneeIn', unit: '°', label: { es: 'Rodilla hacia dentro, la que más', en: 'Knee caving in, the one that does more' }, idealLabel: { es: '0° = sobre la línea cadera–tobillo', en: '0° = on the hip–ankle line' }, help: { es: 'De frente, en el punto más bajo: cuánto se va hacia dentro la rodilla que más lo hace, respecto a la línea de la cadera al tobillo.', en: 'From the front, at the bottom: how far the knee that caves in more is off the line from hip to ankle.' } },
  { key: 'depth', unit: '°', label: { es: 'Ángulo de rodilla abajo', en: 'Knee angle at the bottom' }, idealLabel: null, help: { es: 'De lado, en el punto más bajo: el ángulo entre muslo y pierna. Cuanto más pequeño, más profunda la sentadilla.', en: 'From the side, at the bottom: the angle between thigh and shin. The smaller, the deeper the squat.' } },
  { key: 'trunkVsTibia', unit: '°', label: { es: 'Tronco frente a tibia', en: 'Trunk against shin' }, idealLabel: { es: '0° = paralelos', en: '0° = parallel' }, help: { es: 'De lado, abajo: cuánto más se inclina el tronco que la pierna. En 0 van paralelos.', en: 'From the side, at the bottom: how much more the trunk leans than the shin. At 0 they are parallel.' } },
  { key: 'shift', unit: 'cm', label: { es: 'Desplazamiento lateral de la pelvis', en: 'Pelvis shifted sideways' }, idealLabel: { es: '0 cm = centrada', en: '0 cm = centred' }, help: { es: 'De frente, abajo: cuánto se aparta la pelvis del centro entre los tobillos, sea al lado que sea.', en: 'From the front, at the bottom: how far the pelvis is off the middle between the ankles, either side.' } },
  { key: 'heelLift', unit: 'cm', label: { es: 'Talón levantado', en: 'Heel lift' }, idealLabel: { es: '0 cm = apoyado', en: '0 cm = down' }, help: { es: 'De lado: cuánto sube el talón al bajar, respecto a la foto de pie.', en: 'From the side: how far the heel rises going down, against the standing photo.' } },
]

export function squatTrendValue(m: SquatMetrics, key: SquatTrendKey): number | null {
  const h = squatHeadline(m)
  const abs = (n: number | null) => (n === null ? null : Math.abs(n))
  switch (key) {
    case 'kneeIn':
      return h.kneeIn === null ? null : Math.max(0, h.kneeIn)
    case 'depth':
      return h.depth
    case 'trunkVsTibia':
      return abs(h.trunkVsTibia)
    case 'shift':
      return abs(h.shift)
    case 'heelLift':
      return h.heelLift
  }
}

/** The callouts of utils/posture.ts postureCallouts, for a squat photo. */
export function squatCallouts(view: SquatView, points: Points, k: number | null, facing: 'right' | 'left' | null, tilt: number | null = null, standing: Points | null = null): PhotoCallout[] {
  const p = points
  if (squatPlane(view) === 'front') {
    const f = measureSquatFront(points, tilt, k)
    const side = (a: Pt, b: Pt): 'left' | 'right' => (a[0] < b[0] ? 'left' : 'right')
    const leftHip = p.hipR![0] < p.hipL![0] ? p.hipR! : p.hipL!
    const out: PhotoCallout[] = [
      { key: 'kneeR', at: p.kneeR!, side: side(p.kneeR!, p.kneeL!), value: f.kneeInR, unit: '°', label: { es: 'Rodilla D', en: 'Knee R' } },
      { key: 'kneeL', at: p.kneeL!, side: side(p.kneeL!, p.kneeR!), value: f.kneeInL, unit: '°', label: { es: 'Rodilla I', en: 'Knee L' } },
      { key: 'pelvis', at: leftHip, side: 'left', value: Math.abs(f.pelvisTilt), unit: '°', label: { es: 'Pelvis', en: 'Pelvis' } },
    ]
    if (f.shiftCm !== null) out.push({ key: 'shift', at: mid(p.hipR!, p.hipL!), side: 'right', value: Math.abs(f.shiftCm), unit: 'cm', label: { es: 'Desplaz.', en: 'Shift' } })
    return out
  }
  const s = measureSquatSide(points, tilt, facing, k, standing)
  const behind: 'left' | 'right' = (facing ?? facingOf(p)) === 'right' ? 'left' : 'right'
  const ahead: 'left' | 'right' = behind === 'left' ? 'right' : 'left'
  const out: PhotoCallout[] = [
    { key: 'trunk', at: p.shoulder!, side: behind, value: s.trunkLean, unit: '°', label: { es: 'Tronco', en: 'Trunk' } },
    { key: 'hip', at: p.hip!, side: behind, value: s.hipAngle, unit: '°', label: { es: 'Cadera', en: 'Hip' } },
    { key: 'knee', at: p.knee!, side: ahead, value: s.kneeAngle, unit: '°', label: { es: 'Rodilla', en: 'Knee' } },
    { key: 'tibia', at: p.ankle!, side: ahead, value: s.tibiaLean, unit: '°', label: { es: 'Tibia', en: 'Shin' } },
  ]
  if (s.heelLift !== null && s.heelLift > 0) out.push({ key: 'heel', at: p.heel!, side: behind, value: s.heelLift, unit: 'cm', label: { es: 'Talón', en: 'Heel' } })
  return out
}

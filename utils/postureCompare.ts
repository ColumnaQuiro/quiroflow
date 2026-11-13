import type { FrontMetrics, Points, PostureView, Pt, SideMetrics, StoredView, ViewMetrics } from './posture'

// Two posture assessments of the same person, measure by measure: what each
// number was, what it is now, and whether that is closer to aligned. Pure, so
// the record (components/posture/Compare.vue), the patient's Progreso and the
// comparison PDF (server/utils/postureComparePdf.ts) say the same thing.
// Shared with mobile/, so it imports nothing but its neighbours.
//
// As in utils/postureTrend.ts, every number is its distance from aligned, so
// lower is always better: a tilt is compared without its side (2° to the left
// after 2° to the right has not improved), the knees as whichever bends more.
//
// Nothing is stored: a comparison is two assessments read together, so it
// follows them -- the patient can compare the ones shared with them, and one
// that is deleted or anonymised takes its comparisons with it.

export type CompareKey =
  | 'headWeight' | 'headForward' | 'shoulderForward' | 'hipForward' | 'kneeForward'
  | 'headTilt' | 'shoulderTilt' | 'hipTilt' | 'headShift' | 'shoulderShift' | 'hipShift' | 'knees'
export type CompareGroup = 'head' | 'side' | 'front'
export type CompareAudience = 'staff' | 'patient'
export type CompareLang = 'es' | 'en'
export type Verdict = 'better' | 'worse' | 'same'
type Metrics = Partial<Record<PostureView, ViewMetrics>>

export interface CompareMetric {
  key: CompareKey
  group: CompareGroup
  label: { es: string; en: string }
  /** The same thing in the patient's words. */
  plain: { es: string; en: string }
  unit: 'kg' | 'cm' | '°'
  /** Where aligned sits: the head's weight upright, else 0. */
  ideal: number
  /** A change smaller than this is the photo, not the person. */
  noise: number
}

export const COMPARE_GROUPS: Record<CompareGroup, { es: string; en: string }> = {
  head: { es: 'Cabeza y cuello', en: 'Head and neck' },
  side: { es: 'De lado, respecto a la vertical', en: 'From the side, against the vertical' },
  front: { es: 'De frente', en: 'From the front' },
}

// The noise floors are the report's own (utils/postureReport.ts): half a
// degree or half a centimetre reads as level, and the knee points are the
// least sure of all.
export const COMPARE_METRICS: CompareMetric[] = [
  { key: 'headWeight', group: 'head', unit: 'kg', ideal: 5.4, noise: 0.5, label: { es: 'Peso efectivo de la cabeza', en: 'Effective head weight' }, plain: { es: 'Peso que sostiene tu cuello', en: 'What your neck holds' } },
  { key: 'headForward', group: 'head', unit: 'cm', ideal: 0, noise: 0.5, label: { es: 'Cabeza por delante del hombro', en: 'Head ahead of the shoulder' }, plain: { es: 'Cabeza por delante del hombro', en: 'Head ahead of the shoulder' } },
  { key: 'shoulderForward', group: 'side', unit: 'cm', ideal: 0, noise: 0.5, label: { es: 'Hombro fuera de la vertical', en: 'Shoulder off the vertical' }, plain: { es: 'Hombro respecto a la vertical', en: 'Shoulder against the vertical' } },
  { key: 'hipForward', group: 'side', unit: 'cm', ideal: 0, noise: 0.5, label: { es: 'Cadera fuera de la vertical', en: 'Hip off the vertical' }, plain: { es: 'Cadera respecto a la vertical', en: 'Hip against the vertical' } },
  { key: 'kneeForward', group: 'side', unit: 'cm', ideal: 0, noise: 0.5, label: { es: 'Rodilla fuera de la vertical', en: 'Knee off the vertical' }, plain: { es: 'Rodilla respecto a la vertical', en: 'Knee against the vertical' } },
  { key: 'headTilt', group: 'front', unit: '°', ideal: 0, noise: 0.5, label: { es: 'Inclinación de la cabeza', en: 'Head tilt' }, plain: { es: 'Inclinación de la cabeza', en: 'Head tilt' } },
  { key: 'shoulderTilt', group: 'front', unit: '°', ideal: 0, noise: 0.5, label: { es: 'Inclinación de hombros', en: 'Shoulder tilt' }, plain: { es: 'Diferencia entre hombros', en: 'Difference between shoulders' } },
  { key: 'hipTilt', group: 'front', unit: '°', ideal: 0, noise: 0.5, label: { es: 'Inclinación de pelvis', en: 'Pelvic tilt' }, plain: { es: 'Diferencia entre caderas', en: 'Difference between hips' } },
  { key: 'headShift', group: 'front', unit: 'cm', ideal: 0, noise: 0.5, label: { es: 'Cabeza descentrada', en: 'Head off centre' }, plain: { es: 'Cabeza descentrada', en: 'Head off centre' } },
  { key: 'shoulderShift', group: 'front', unit: 'cm', ideal: 0, noise: 0.5, label: { es: 'Hombros descentrados', en: 'Shoulders off centre' }, plain: { es: 'Hombros descentrados', en: 'Shoulders off centre' } },
  { key: 'hipShift', group: 'front', unit: 'cm', ideal: 0, noise: 0.5, label: { es: 'Pelvis descentrada', en: 'Pelvis off centre' }, plain: { es: 'Pelvis descentrada', en: 'Pelvis off centre' } },
  { key: 'knees', group: 'front', unit: '°', ideal: 0, noise: 2, label: { es: 'Rodillas, la más desviada', en: 'Knees, the one that bends more' }, plain: { es: 'Rodillas', en: 'Knees' } },
]

// What the patient is shown: the four their chart already explains
// (components/patient/PostureProgress.vue). The rest stay with the clinic.
export const PATIENT_COMPARE_KEYS: CompareKey[] = ['headWeight', 'headForward', 'shoulderTilt', 'hipTilt']

const round1 = (n: number) => Math.round(n * 10) / 10 || 0

/**
 * Which side photo and which front-or-back photo both assessments have, so a
 * right side is never compared with a left one. Null when they share none.
 */
export function commonViews(before: Metrics, after: Metrics): { side: PostureView | null; front: PostureView | null } {
  const both = (first: PostureView, second: PostureView) => (before[first] && after[first] ? first : before[second] && after[second] ? second : null)
  return { side: both('right', 'left'), front: both('front', 'back') }
}

/** One measure in one assessment, as distance from aligned; null when that view was not taken. */
export function compareValue(metrics: Metrics, key: CompareKey, views: { side: PostureView | null; front: PostureView | null }): number | null {
  const s = (views.side ? metrics[views.side] : undefined) as SideMetrics | undefined
  const f = (views.front ? metrics[views.front] : undefined) as FrontMetrics | undefined
  switch (key) {
    case 'headWeight':
      return s ? s.headWeight : null
    case 'headForward':
      return s ? round1(s.earForward - s.shoulderForward) : null
    case 'shoulderForward':
    case 'hipForward':
    case 'kneeForward':
      return s ? Math.abs(s[key]) : null
    case 'knees':
      return f?.kneeAngleR === undefined || f.kneeAngleL === undefined ? null : Math.max(Math.abs(f.kneeAngleR), Math.abs(f.kneeAngleL))
    default:
      return f ? Math.abs(f[key]) : null
  }
}

export interface CompareRow {
  key: CompareKey
  group: CompareGroup
  label: string
  unit: 'kg' | 'cm' | '°'
  ideal: number
  before: number
  after: number
  /** after - before, as measured; negative is usually good. */
  delta: number
  verdict: Verdict
  /** How much of the way to aligned was covered, 0-100; only when better. */
  share: number | null
}

export interface PostureComparison {
  rows: CompareRow[]
  better: number
  worse: number
  same: number
  views: { side: PostureView | null; front: PostureView | null }
}

/** Every measure both assessments have, in the order of COMPARE_METRICS. */
export function comparePosture(before: Metrics, after: Metrics, lang: CompareLang, audience: CompareAudience = 'staff'): PostureComparison {
  const views = commonViews(before, after)
  const rows = COMPARE_METRICS.filter((m) => audience === 'staff' || PATIENT_COMPARE_KEYS.includes(m.key)).flatMap((m): CompareRow[] => {
    const b = compareValue(before, m.key, views)
    const a = compareValue(after, m.key, views)
    if (b === null || a === null) return []
    const was = Math.abs(b - m.ideal)
    const is = Math.abs(a - m.ideal)
    const verdict: Verdict = Math.abs(is - was) < m.noise ? 'same' : is < was ? 'better' : 'worse'
    return [{
      key: m.key,
      group: m.group,
      label: (audience === 'patient' ? m.plain : m.label)[lang],
      unit: m.unit,
      ideal: m.ideal,
      before: round1(b),
      after: round1(a),
      delta: round1(a - b),
      verdict,
      share: verdict === 'better' && was > 0 ? Math.min(100, Math.round(((was - is) / was) * 100)) : null,
    }]
  })
  const count = (v: Verdict) => rows.filter((r) => r.verdict === v).length
  return { rows, better: count('better'), worse: count('worse'), same: count('same'), views }
}

/**
 * Where "before", "now" and "aligned" sit along one row's bar, as fractions
 * of its length: 0 is the left end, and the scale leaves room past the larger
 * of the two so its dot is never on the edge.
 */
export function compareBar(row: Pick<CompareRow, 'before' | 'after' | 'ideal'>): { before: number; after: number; ideal: number } {
  const max = Math.max(row.before, row.after, row.ideal, 0.1) * 1.15
  const at = (v: number) => Math.max(0, Math.min(1, v / max))
  return { before: at(row.before), after: at(row.after), ideal: at(row.ideal) }
}

const fmt = (n: number, lang: CompareLang) => round1(n).toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB', { maximumFractionDigits: 1 })
export const withCompareUnit = (n: number, unit: string, lang: CompareLang) => `${fmt(n, lang)}${unit === '°' ? '°' : ` ${unit}`}`

/** "5 de 7 medidas mejoran", or what there is to say when none does. */
export function compareHeadline(c: PostureComparison, lang: CompareLang): string {
  const n = c.rows.length
  const es = lang === 'es'
  if (!n) return es ? 'Estas dos valoraciones no tienen fotos de la misma vista que comparar.' : 'These two assessments share no view to compare.'
  if (c.better) return es ? `${c.better} de ${n} ${n === 1 ? 'medida mejora' : c.better === 1 ? 'medidas mejora' : 'medidas mejoran'}` : `${c.better} of ${n} ${n === 1 ? 'measurement' : 'measurements'} improved`
  if (c.worse) return es ? `${c.worse} de ${n} ${n === 1 ? 'medida' : 'medidas'} a vigilar` : `${c.worse} of ${n} ${n === 1 ? 'measurement' : 'measurements'} to watch`
  return es ? 'Las medidas se mantienen parecidas' : 'The measurements are much the same'
}

/** What a summary names: the three that improved most (by share of the way to aligned), up to three to watch, and how many held. */
export function compareHighlights(c: PostureComparison): { better: CompareRow[]; worse: CompareRow[]; same: number } {
  return {
    better: c.rows.filter((r) => r.verdict === 'better').sort((a, b) => (b.share ?? 0) - (a.share ?? 0)).slice(0, 3),
    worse: c.rows.filter((r) => r.verdict === 'worse').slice(0, 3),
    same: c.same,
  }
}

/**
 * What changed, in two or three sentences: the measures that improved most
 * (by share of the way to aligned), the ones to watch, and that the rest
 * held. Describes what the photos show and names no condition. The PDF's
 * wording, in the patient's language; the screens say the same through t()
 * (components/posture/Compare.vue), which also covers Portuguese and German.
 */
export function compareSentence(c: PostureComparison, lang: CompareLang): string {
  const es = lang === 'es'
  if (!c.rows.length) return compareHeadline(c, lang)
  const item = (r: CompareRow) => (es ? `${r.label.toLowerCase()} (de ${withCompareUnit(r.before, r.unit, lang)} a ${withCompareUnit(r.after, r.unit, lang)})` : `${r.label.toLowerCase()} (from ${withCompareUnit(r.before, r.unit, lang)} to ${withCompareUnit(r.after, r.unit, lang)})`)
  const list = (rows: CompareRow[]) => {
    const parts = rows.map(item)
    return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')}${es ? ' y ' : ' and '}${parts[parts.length - 1]}`
  }
  const { better, worse } = compareHighlights(c)
  const out: string[] = []
  if (better.length) out.push(es ? `Lo que más ha mejorado: ${list(better)}.` : `What improved most: ${list(better)}.`)
  if (worse.length) out.push(es ? `A vigilar: ${list(worse)}.` : `To watch: ${list(worse)}.`)
  if (!better.length && !worse.length) out.push(es ? 'Las medidas se mantienen parecidas entre las dos valoraciones.' : 'The measurements are much the same in both assessments.')
  else if (c.same) out.push(es ? (c.same === 1 ? 'La otra medida se mantiene parecida.' : 'El resto se mantiene parecido.') : c.same === 1 ? 'The other measurement is much the same.' : 'The rest is much the same.')
  return out.join(' ')
}

const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
const anchor = (view: PostureView, p: Points): { ear: Pt; ankle: Pt } | null => {
  const paired = view === 'front' || view === 'back'
  const ear = paired ? p.earR && p.earL && mid(p.earR, p.earL) : p.ear
  const ankle = paired ? p.ankleR && p.ankleL && mid(p.ankleR, p.ankleL) : p.ankle
  return ear && ankle ? { ear, ankle } : null
}

/**
 * The earlier assessment's points, placed on the later one's photo: scaled so
 * both figures are the same height from ankle to ear, moved so the ankles
 * coincide, and mirrored when the two side photos face opposite ways. What is
 * left is the difference in posture, not in where the camera stood. Null when
 * either lacks the points to line up by.
 */
export function ghostPoints(view: PostureView, before: Pick<StoredView, 'points' | 'facing'>, after: Pick<StoredView, 'points' | 'facing'>): Points | null {
  const b = anchor(view, before.points)
  const a = anchor(view, after.points)
  if (!b || !a) return null
  const tall = Math.abs(b.ankle[1] - b.ear[1])
  if (!tall) return null
  const k = Math.abs(a.ankle[1] - a.ear[1]) / tall
  const flip = (view === 'right' || view === 'left') && !!before.facing && !!after.facing && before.facing !== after.facing ? -1 : 1
  return Object.fromEntries(
    Object.entries(before.points).map(([name, p]) => [name, [Math.round(a.ankle[0] + (p[0] - b.ankle[0]) * k * flip), Math.round(a.ankle[1] + (p[1] - b.ankle[1]) * k)] as Pt]),
  )
}

/** The two in the order they were taken, whichever way they were picked. */
export function orderByTaken<T extends { takenAt: string }>(a: T, b: T): [T, T] {
  return a.takenAt.localeCompare(b.takenAt) <= 0 ? [a, b] : [b, a]
}

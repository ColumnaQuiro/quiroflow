import type { FrontMetrics, PostureView, SideMetrics, ViewMetrics } from './posture'
import { squatHeadline, type SquatMetrics } from './squat'

// Home exercises worth sending, from what a posture or squat assessment
// measured: each finding past a threshold names a few exercises from
// QuiroFlow's starter catalogue (utils/exerciseCatalog.ts, by slug). Offered
// to the practitioner on the record, who ticks what to give
// (components/posture/Suggestions.vue) -- never sent on their own.
//
// The thresholds decide only when a suggestion is worth showing: they are
// not a line between normal and not, and the screen does not say they are.
// Each sits above what a photo commonly shows in anyone (a degree or two of
// tilt, a centimetre or two off the vertical).

export interface ExerciseSuggestion {
  key: string
  finding: { es: string; en: string }
  /** What was measured, for the line under the finding. */
  value: number
  unit: '°' | 'cm'
  slugs: string[]
}

export function postureSuggestions(metrics: Partial<Record<PostureView, ViewMetrics>>): ExerciseSuggestion[] {
  const s = (metrics.right ?? metrics.left) as SideMetrics | undefined
  const f = (metrics.front ?? metrics.back) as FrontMetrics | undefined
  const out: ExerciseSuggestion[] = []
  if (s) {
    const head = Math.round((s.earForward - s.shoulderForward) * 10) / 10
    if (head >= 2.5) out.push({ key: 'head', finding: { es: 'Cabeza por delante del hombro', en: 'Head ahead of the shoulder' }, value: head, unit: 'cm', slugs: ['chin-tuck', 'thoracic-extension', 'doorway-pec-stretch'] })
    if (s.shoulderForward >= 3) out.push({ key: 'shoulders', finding: { es: 'Hombro por delante de la vertical', en: 'Shoulder ahead of the vertical' }, value: s.shoulderForward, unit: 'cm', slugs: ['scapular-retraction', 'wall-angels', 'doorway-pec-stretch'] })
    if (s.hipForward >= 3) out.push({ key: 'hipForward', finding: { es: 'Cadera por delante de la vertical', en: 'Hip ahead of the vertical' }, value: s.hipForward, unit: 'cm', slugs: ['hip-flexor-stretch', 'glute-bridge', 'dead-bug'] })
  }
  if (f) {
    if (Math.abs(f.shoulderTilt) >= 2) out.push({ key: 'shoulderTilt', finding: { es: 'Hombros a distinta altura', en: 'Shoulders at different heights' }, value: Math.abs(f.shoulderTilt), unit: '°', slugs: ['standing-side-bend', 'scapular-retraction'] })
    const pelvis = Math.max(Math.abs(f.hipTilt), 0)
    if (pelvis >= 2 || Math.abs(f.hipShift) >= 2) {
      out.push(pelvis >= 2
        ? { key: 'pelvis', finding: { es: 'Pelvis inclinada', en: 'Pelvis tilted' }, value: pelvis, unit: '°', slugs: ['side-lying-hip-abduction', 'clamshell', 'side-plank'] }
        : { key: 'pelvis', finding: { es: 'Pelvis desplazada a un lado', en: 'Pelvis shifted to one side' }, value: Math.abs(f.hipShift), unit: 'cm', slugs: ['side-lying-hip-abduction', 'clamshell', 'side-plank'] })
    }
    const knee = f.kneeAngleR === undefined || f.kneeAngleL === undefined ? null : Math.max(f.kneeAngleR, f.kneeAngleL)
    if (knee !== null && knee >= 5) out.push({ key: 'knees', finding: { es: 'Rodilla hacia dentro', en: 'Knee pointing in' }, value: knee, unit: '°', slugs: ['clamshell', 'lateral-band-walk', 'glute-bridge'] })
  }
  return out
}

export function squatSuggestions(m: SquatMetrics): ExerciseSuggestion[] {
  const h = squatHeadline(m)
  const out: ExerciseSuggestion[] = []
  if (h.kneeIn !== null && h.kneeIn >= 8) out.push({ key: 'kneeIn', finding: { es: 'Rodilla hacia dentro al bajar', en: 'Knee caving in going down' }, value: h.kneeIn, unit: '°', slugs: ['clamshell', 'lateral-band-walk', 'glute-bridge', 'single-leg-balance'] })
  if (h.shift !== null && Math.abs(h.shift) >= 2) out.push({ key: 'shift', finding: { es: 'Se desplaza hacia un lado al bajar', en: 'Shifts to one side going down' }, value: Math.abs(h.shift), unit: 'cm', slugs: ['side-lying-hip-abduction', 'single-leg-balance', 'step-up'] })
  if (h.heelLift !== null && h.heelLift >= 1) out.push({ key: 'heel', finding: { es: 'El talón se levanta', en: 'The heel lifts' }, value: h.heelLift, unit: 'cm', slugs: ['calf-stretch', 'calf-raise'] })
  if (h.trunkVsTibia !== null && h.trunkVsTibia >= 15) out.push({ key: 'trunk', finding: { es: 'Tronco mucho más inclinado que la pierna', en: 'Trunk leaning far more than the shin' }, value: h.trunkVsTibia, unit: '°', slugs: ['calf-stretch', 'hip-flexor-stretch', 'dead-bug'] })
  if (h.depth !== null && h.depth > 110) out.push({ key: 'depth', finding: { es: 'Baja poco (ángulo de rodilla abajo)', en: 'Shallow squat (knee angle at the bottom)' }, value: h.depth, unit: '°', slugs: ['sit-to-stand', 'calf-stretch', 'hip-flexor-stretch'] })
  return out
}

/** Every slug the suggestions name, once each, in the order they first appear. */
export function suggestedSlugs(list: ExerciseSuggestion[]): string[] {
  return [...new Set(list.flatMap((s) => s.slugs))]
}

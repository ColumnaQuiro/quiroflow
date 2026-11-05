// Exercises by visit (the exercise_schedules migration): a schedule is a
// list of steps, each given to the patient when they reach a visit of their
// care -- "from visit 1 these, from visit 6 these". The same shape is a
// clinic's template (exercise_schedules.steps) and one patient's copy
// (patient_exercise_schedules.steps), where the database also stamps
// applied_at on a step once it has been given.
//
// Visits are the ones attended (completed or checked in) since the
// schedule's counts_from date. Giving the steps is the database's job
// (apply_patient_exercise_schedule); this file only shapes, checks and
// describes them for the screens.

export interface ScheduleItem {
  exercise_id: string
  sets: number | null
  reps: string | null
  frequency: string | null
  notes: string | null
  progressive: boolean
}

export interface ScheduleStep {
  id: string
  from_visit: number
  label: string | null
  /** Add to what the schedule gave before, instead of replacing it. */
  keep_previous: boolean
  items: ScheduleItem[]
  /** Patient copies only: when this step was given. */
  applied_at?: string | null
}

export const MAX_SCHEDULE_STEPS = 12
export const MAX_STEP_ITEMS = 30

/**
 * A random id for a new step (the database checks it is a uuid). The staff
 * app runs in Android WebViews old enough to lack randomUUID (the same ones
 * that needed Array.at polyfilled, #911), so a v4 uuid is built by hand there.
 */
export function newScheduleStepId(): string {
  const c = globalThis.crypto
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  const b = c.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Steps as stored, read defensively: anything malformed is dropped. */
export function readSteps(raw: unknown): ScheduleStep[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({
      id: String(s.id ?? ''),
      from_visit: Number(s.from_visit) || 1,
      label: typeof s.label === 'string' && s.label.trim() ? s.label : null,
      keep_previous: s.keep_previous === true,
      items: (Array.isArray(s.items) ? s.items : [])
        .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object' && typeof (i as { exercise_id?: unknown }).exercise_id === 'string')
        .map((i) => ({
          exercise_id: i.exercise_id as string,
          sets: typeof i.sets === 'number' ? i.sets : null,
          reps: typeof i.reps === 'string' ? i.reps : null,
          frequency: typeof i.frequency === 'string' ? i.frequency : null,
          notes: typeof i.notes === 'string' ? i.notes : null,
          progressive: i.progressive === true,
        })),
      applied_at: typeof s.applied_at === 'string' ? s.applied_at : null,
    }))
}

export type StepsProblem =
  | { kind: 'none' }
  | { kind: 'visit'; step: number }
  | { kind: 'empty'; step: number }
  | { kind: 'sets'; step: number }
  | { kind: 'repeated'; step: number }
  | { kind: 'too_many' }

/**
 * Steps ready to save -- sorted by visit, labels trimmed, numbers dropped
 * from progressive doses -- or the first thing wrong with them. Steps are
 * numbered from 1 in the order they were given, as the editor shows them.
 */
export function cleanSteps(steps: ScheduleStep[]): { steps: ScheduleStep[] } | { problem: StepsProblem } {
  if (!steps.length) return { problem: { kind: 'none' } }
  if (steps.length > MAX_SCHEDULE_STEPS) return { problem: { kind: 'too_many' } }
  const out: ScheduleStep[] = []
  for (const [idx, s] of steps.entries()) {
    const step = idx + 1
    if (!Number.isInteger(s.from_visit) || s.from_visit < 1 || s.from_visit > 999) return { problem: { kind: 'visit', step } }
    const items = s.items.filter((i) => i.exercise_id)
    if (!items.length || items.length > MAX_STEP_ITEMS) return { problem: { kind: 'empty', step } }
    if (new Set(items.map((i) => i.exercise_id)).size !== items.length) return { problem: { kind: 'repeated', step } }
    if (items.some((i) => !i.progressive && i.sets !== null && !(Number.isInteger(i.sets) && i.sets >= 1 && i.sets <= 99))) return { problem: { kind: 'sets', step } }
    out.push({
      id: s.id || newScheduleStepId(),
      from_visit: s.from_visit,
      label: s.label?.trim().slice(0, 40) || null,
      keep_previous: s.keep_previous,
      items: items.map((i) => ({
        exercise_id: i.exercise_id,
        sets: i.progressive ? null : i.sets,
        reps: i.progressive ? null : i.reps?.trim() || null,
        frequency: i.frequency?.trim() || null,
        notes: i.notes?.trim() || null,
        progressive: i.progressive,
      })),
      ...(s.applied_at ? { applied_at: s.applied_at } : {}),
    })
  }
  return { steps: sortSteps(out) }
}

/** By visit; steps on the same visit keep their order. */
export function sortSteps<T extends { from_visit: number }>(steps: T[]): T[] {
  return steps.map((s, i) => ({ s, i })).sort((a, b) => a.s.from_visit - b.s.from_visit || a.i - b.i).map((x) => x.s)
}

/** A step copied for a new schedule: a fresh id, and never already given. */
export function copySteps(steps: ScheduleStep[]): ScheduleStep[] {
  return steps.map((s) => ({ ...s, id: newScheduleStepId(), applied_at: null, items: s.items.map((i) => ({ ...i })) }))
}

/** Where a patient's schedule stands: the step they are on and the next one. */
export function scheduleProgress(steps: ScheduleStep[], attended: number | null) {
  const sorted = sortSteps(steps)
  const given = sorted.filter((s) => s.applied_at)
  const pending = sorted.filter((s) => !s.applied_at)
  return {
    current: given[given.length - 1] ?? null,
    next: pending[0] ?? null,
    /** Visits still to go before the next step; null when unknown or none left. */
    visitsToNext: pending[0] && attended !== null ? Math.max(0, pending[0].from_visit - attended) : null,
  }
}

/** "Visit 6" or "Visit 6 · Week 2", in the viewer's language. */
export function scheduleStepTitle(step: Pick<ScheduleStep, 'from_visit' | 'label'>, t: (en: string, es: string) => string): string {
  const visit = t(`From visit ${step.from_visit}`, `Desde la visita ${step.from_visit}`)
  return step.label ? `${visit} · ${step.label}` : visit
}

/** What a problem from cleanSteps says to the person editing. */
export function stepsProblemMessage(p: StepsProblem, t: (en: string, es: string) => string): string {
  switch (p.kind) {
    case 'none':
      return t('Add at least one step.', 'Añade al menos un paso.')
    case 'too_many':
      return t(`At most ${MAX_SCHEDULE_STEPS} steps.`, `Como mucho ${MAX_SCHEDULE_STEPS} pasos.`)
    case 'visit':
      return t(`Step ${p.step}: the visit has to be a whole number from 1.`, `Paso ${p.step}: la visita tiene que ser un número entero desde 1.`)
    case 'empty':
      return t(`Step ${p.step}: add at least one exercise.`, `Paso ${p.step}: añade al menos un ejercicio.`)
    case 'repeated':
      return t(`Step ${p.step}: an exercise is in it twice.`, `Paso ${p.step}: hay un ejercicio repetido.`)
    case 'sets':
      return t(`Step ${p.step}: sets must be a whole number.`, `Paso ${p.step}: las series deben ser un número entero.`)
  }
}

// ---- the editor's drafts: numbers as typed, parsed on the way out ----------

export interface DraftScheduleItem {
  exercise_id: string
  sets: string
  reps: string
  frequency: string
  notes: string
  progressive: boolean
}

export interface DraftScheduleStep {
  id: string
  from_visit: string
  label: string
  keep_previous: boolean
  items: DraftScheduleItem[]
  applied_at: string | null
}

export function blankScheduleItem(): DraftScheduleItem {
  return { exercise_id: '', sets: '', reps: '', frequency: '', notes: '', progressive: false }
}

export function toDraftSteps(steps: ScheduleStep[]): DraftScheduleStep[] {
  return sortSteps(steps).map((s) => ({
    id: s.id,
    from_visit: String(s.from_visit),
    label: s.label ?? '',
    keep_previous: s.keep_previous,
    items: s.items.map((i) => ({ exercise_id: i.exercise_id, sets: i.sets ? String(i.sets) : '', reps: i.reps ?? '', frequency: i.frequency ?? '', notes: i.notes ?? '', progressive: i.progressive })),
    applied_at: s.applied_at ?? null,
  }))
}

/** Back to steps; anything mistyped becomes a value cleanSteps refuses. */
export function fromDraftSteps(drafts: DraftScheduleStep[]): ScheduleStep[] {
  const num = (v: string) => (v.trim() ? Number(v.trim()) : null)
  return drafts.map((d) => ({
    id: d.id,
    from_visit: num(d.from_visit) ?? Number.NaN,
    label: d.label,
    keep_previous: d.keep_previous,
    items: d.items.map((i) => ({ exercise_id: i.exercise_id, sets: num(i.sets), reps: i.reps, frequency: i.frequency, notes: i.notes, progressive: i.progressive })),
    applied_at: d.applied_at,
  }))
}

/** A new step a few visits after the last one, or at visit 1. */
export function nextDraftStep(drafts: DraftScheduleStep[]): DraftScheduleStep {
  const last = Math.max(0, ...drafts.map((d) => Number(d.from_visit) || 0))
  return { id: newScheduleStepId(), from_visit: String(last ? last + 4 : 1), label: '', keep_previous: false, items: [blankScheduleItem()], applied_at: null }
}

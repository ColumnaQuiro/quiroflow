import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyExerciseAssigned } from '~/server/utils/exerciseReminders'
import { firePatientTrigger } from '~/server/utils/automationTriggers'
import { triggerTypeMatches } from '~/utils/automationTriggerMatch'

// What the bulk exercise and patient-type functions hand back, and the two
// things the server does with it once the database has done its part: the
// patients' "Nuevos ejercicios para casa" push, and the automations that
// start on a type being given or taken away.

/** Exercises created, one entry per patient (give_exercise_items). */
export interface ExerciseGroup {
  patient_id: string
  ids: string[]
}

export interface TypeChange {
  patient_id: string
  type_id: string
}

export const exerciseCount = (groups: ExerciseGroup[] | null | undefined) => (groups ?? []).reduce((n, g) => n + (g.ids?.length ?? 0), 0)

/** One push per patient for everything they were just given; a few at a time. */
export async function notifyExerciseGroups(service: SupabaseClient<any>, groups: ExerciseGroup[] | null | undefined): Promise<void> {
  const queue = (groups ?? []).filter((g) => g.ids?.length)
  const worker = async () => {
    for (let g = queue.shift(); g; g = queue.shift()) await notifyExerciseAssigned(service as never, g.ids)
  }
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker))
}

/**
 * The automations that start on a type given ("patient.type_added") or taken
 * away ("patient.type_removed"), for each change. Best-effort, as every
 * trigger is: the change has already happened. `skipRuleId` keeps an
 * automation whose own step changed the type from starting itself.
 */
export async function fireTypeTriggers(
  service: SupabaseClient<any>,
  accountId: string,
  changes: { added?: TypeChange[] | null; removed?: TypeChange[] | null },
  origin: string,
  opts: { skipRuleId?: string } = {},
): Promise<number> {
  const added = changes.added ?? []
  const removed = changes.removed ?? []
  if (!added.length && !removed.length) return 0
  // Nothing to do for most clinics: no rule starts on a type at all.
  const { count } = await service
    .from('automation_rules')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('enabled', true)
    .in('trigger_event', ['patient.type_added', 'patient.type_removed'])
  if (!count) return 0
  let fired = 0
  for (const [event, list] of [['patient.type_added', added], ['patient.type_removed', removed]] as const) {
    for (const c of list) {
      fired += await firePatientTrigger(service, accountId, c.patient_id, event, origin, { matches: (f) => triggerTypeMatches(f, c.type_id), skipRuleId: opts.skipRuleId })
    }
  }
  return fired
}

import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database, Json } from '~/types/database.types'
import { exerciseCount, fireTypeTriggers, notifyExerciseGroups, type ExerciseGroup, type TypeChange } from '~/server/utils/exerciseBulk'

// Gives and takes away patient types -- on one record, or on many from the
// Patients list or the Exercises section. set_patient_types does the writes
// as the caller (patients_edit, patient scope), including what a type brings:
// its programme and its schedule by visit. Then the patients who were given
// exercises get their push, and the automations that start on a type run.
interface Body {
  patientIds?: string[] | null
  filters?: Record<string, unknown> | null
  clinicId?: string | null
  add?: string[]
  remove?: string[]
  /** Removing a type ends the exercises it brought (default). */
  endTypeExercises?: boolean
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  const add = Array.isArray(body?.add) ? body.add.filter((x) => typeof x === 'string') : []
  const remove = Array.isArray(body?.remove) ? body.remove.filter((x) => typeof x === 'string') : []
  if (!add.length && !remove.length) throw createError({ statusCode: 400, statusMessage: 'No type to add or remove' })
  if (!Array.isArray(body?.patientIds) && !body?.filters) throw createError({ statusCode: 400, statusMessage: 'Which patients?' })

  const { supabase, teamMember } = await requirePermission(event, 'patients_edit')
  const { data, error } = await supabase.rpc('set_patient_types', {
    p_account_id: teamMember.account_id,
    p_patient_ids: Array.isArray(body.patientIds) ? body.patientIds : (null as unknown as string[]),
    p_filters: (body.filters ?? null) as Json,
    p_clinic_id: (body.clinicId ?? null) as string,
    p_add: add,
    p_remove: remove,
    p_end_type_exercises: body.endTypeExercises !== false,
  })
  if (error) throw createError({ statusCode: 400, statusMessage: error.message })

  const result = data as unknown as { patients: number; added: TypeChange[]; removed: TypeChange[]; exercises: ExerciseGroup[] }
  const service = serverSupabaseServiceRole<Database>(event)
  await notifyExerciseGroups(service, result.exercises)
  await fireTypeTriggers(service, teamMember.account_id, { added: result.added, removed: result.removed }, getRequestURL(event).origin)
  return {
    patients: result.patients,
    added: (result.added ?? []).length,
    removed: (result.removed ?? []).length,
    exercises: exerciseCount(result.exercises),
  }
})

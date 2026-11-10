import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { exerciseCount, notifyExerciseGroups, type ExerciseGroup } from '~/server/utils/exerciseBulk'

// "Update the N patients who have it", after what a type brings has changed:
// sync_patient_type, as the caller (exercises_manage), then the push for
// whoever was given something new.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ typeId?: string }>(event)
  if (typeof body?.typeId !== 'string') throw createError({ statusCode: 400, statusMessage: 'typeId required' })

  const { supabase } = await requirePermission(event, 'exercises_manage')
  const { data, error } = await supabase.rpc('sync_patient_type', { p_type_id: body.typeId })
  if (error) throw createError({ statusCode: 400, statusMessage: error.message })

  const result = data as unknown as { patients: number; added: ExerciseGroup[]; ended: number }
  await notifyExerciseGroups(serverSupabaseServiceRole<Database>(event), result.added)
  return { patients: result.patients, exercises: exerciseCount(result.added), ended: result.ended ?? 0 }
})

import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database, Json } from '~/types/database.types'
import { exerciseCount, notifyExerciseGroups, type ExerciseGroup } from '~/server/utils/exerciseBulk'

// "Assign exercises" for many patients at once, from the Exercises section
// or a selection on the Patients list: the patients picked, or everyone the
// list's filters match. Loose exercises or a programme (items), or a
// schedule by visit (scheduleId). The writes are assign_exercises_to_patients,
// run as the caller -- patient scope, two-factor and the audit trail apply
// as they do on a patient's record -- and then each patient who got
// something is told once.
interface Item {
  exercise_id: string
  sets?: number | null
  reps?: string | null
  frequency?: string | null
  notes?: string | null
  progressive?: boolean
}
interface Body {
  patientIds?: string[] | null
  filters?: Record<string, unknown> | null
  clinicId?: string | null
  items?: Item[]
  scheduleId?: string | null
  notify?: boolean
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  const items = Array.isArray(body?.items) ? body.items.filter((i) => typeof i?.exercise_id === 'string') : []
  if (!body?.scheduleId && items.length === 0) throw createError({ statusCode: 400, statusMessage: 'Nothing to assign' })
  if (items.length > 50) throw createError({ statusCode: 400, statusMessage: 'Too many exercises at once' })
  if (!Array.isArray(body?.patientIds) && !body?.filters) throw createError({ statusCode: 400, statusMessage: 'Which patients?' })

  const { supabase, teamMember } = await requirePermission(event, 'exercises_manage')
  const { data, error } = await supabase.rpc('assign_exercises_to_patients', {
    p_account_id: teamMember.account_id,
    p_patient_ids: Array.isArray(body.patientIds) ? body.patientIds : (null as unknown as string[]),
    p_filters: (body.filters ?? null) as Json,
    p_clinic_id: (body.clinicId ?? null) as string,
    p_items: items as unknown as Json,
    p_schedule_id: (body.scheduleId ?? null) as string,
  })
  if (error) throw createError({ statusCode: 400, statusMessage: error.message })

  const result = data as unknown as { patients: number; added: ExerciseGroup[]; started: number; skipped: number }
  if (body.notify !== false) await notifyExerciseGroups(serverSupabaseServiceRole<Database>(event), result.added)
  return {
    patients: result.patients,
    patientsGiven: (result.added ?? []).length,
    exercises: exerciseCount(result.added),
    started: result.started ?? 0,
    skipped: result.skipped ?? 0,
  }
})

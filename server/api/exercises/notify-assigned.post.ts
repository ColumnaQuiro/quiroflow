import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { notifyExerciseAssigned } from '~/server/utils/exerciseReminders'

// After a practitioner assigns a home exercise (useStaffExercises.assign):
// the patient's "Nuevo ejercicio para casa" push. The assignment itself is a
// plain insert under RLS; this only tells the patient. The read below runs as
// the staff member, so it only finds an assignment they could see -- nobody
// can push to a patient outside their account or their patient scope.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ patientExerciseId?: string }>(event)
  if (!body?.patientExerciseId) throw createError({ statusCode: 400, statusMessage: 'patientExerciseId is required' })

  const { supabase } = await requireTeamMember(event)
  const { data } = await supabase.from('patient_exercises').select('id').eq('id', body.patientExerciseId).maybeSingle()
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  await notifyExerciseAssigned(serverSupabaseServiceRole<Database>(event), body.patientExerciseId)
  return { ok: true }
})

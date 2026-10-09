import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { notifyExerciseAssigned } from '~/server/utils/exerciseReminders'

// After a practitioner assigns a home exercise (useStaffExercises.assign):
// the patient's "Nuevo ejercicio para casa" push. The assignment itself is a
// plain insert under RLS; this only tells the patient. The read below runs as
// the staff member, so it only finds an assignment they could see -- nobody
// can push to a patient outside their account or their patient scope.
//
// A programme sends several ids (patientExerciseIds) for one push; a single
// assignment sends patientExerciseId, which is what the deployed web app and
// the released staff app already do.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ patientExerciseId?: string; patientExerciseIds?: string[] }>(event)
  const ids = [...new Set(body?.patientExerciseIds?.length ? body.patientExerciseIds : body?.patientExerciseId ? [body.patientExerciseId] : [])]
  if (!ids.length || ids.length > 50 || ids.some((id) => typeof id !== 'string')) throw createError({ statusCode: 400, statusMessage: 'patientExerciseId(s) required' })

  const { supabase } = await requireTeamMember(event)
  const { data } = await supabase.from('patient_exercises').select('id, patient_id').in('id', ids)
  // Every one has to be visible to this member, or none is sent; and all one
  // patient's, since the push lists them to that patient.
  const rows = (data ?? []) as { id: string; patient_id: string }[]
  if (rows.length !== ids.length) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (new Set(rows.map((r) => r.patient_id)).size !== 1) throw createError({ statusCode: 400, statusMessage: 'One patient at a time' })

  await notifyExerciseAssigned(serverSupabaseServiceRole<Database>(event), ids)
  return { ok: true }
})

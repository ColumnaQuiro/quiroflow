import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { sendPushToPatients } from '~/server/utils/pushNotifications'

// "Enviar al paciente" on a comparison of two posture assessments
// (components/posture/Section.vue): the pair and what the practitioner says
// about it become a posture_comparisons row, which is what puts it in the
// patient's app (Progreso) -- and a push tells them it is there.
//
// One row per pair. Sending the same two again updates the comment and
// shares it again rather than adding a second card; the push is only repeated
// when the patient could not see it before (a first send, or one that had
// been withdrawn), so correcting a typo does not buzz their phone.
//
// The row is written as the staff member, so its policies decide whether
// they may (visit_notes_access, and both assessments this patient's in this
// account); the push then goes out on the service role.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ beforeId?: unknown; afterId?: unknown; note?: unknown }>(event)
  if (typeof body?.beforeId !== 'string' || typeof body.afterId !== 'string' || body.beforeId === body.afterId) throw createError({ statusCode: 400, statusMessage: 'Two assessments are needed' })
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : ''

  const { supabase, teamMember } = await requirePermission(event, 'visit_notes_access')
  const { data: rows } = await supabase.from('posture_assessments').select('id, patient_id, taken_at').in('id', [body.beforeId, body.afterId]).eq('account_id', teamMember.account_id).order('taken_at')
  const [before, after] = rows ?? []
  if (!before || !after || before.patient_id !== after.patient_id) throw createError({ statusCode: 404, statusMessage: 'Assessment not found' })
  const patientId = after.patient_id
  await requirePatientAccess(event, patientId)

  // Earlier first, whichever way round they were sent.
  const { data: existing } = await supabase.from('posture_comparisons').select('id, shared_with_patient').eq('before_assessment_id', before.id).eq('after_assessment_id', after.id).maybeSingle()
  const values = { note: note || null, shared_with_patient: true, updated_at: new Date().toISOString() }
  const write = existing
    ? supabase.from('posture_comparisons').update(values).eq('id', existing.id).select('id').single()
    : supabase.from('posture_comparisons').insert({ ...values, account_id: teamMember.account_id, patient_id: patientId, before_assessment_id: before.id, after_assessment_id: after.id, created_by: teamMember.id }).select('id').single()
  const { data: saved, error } = await write
  if (error || !saved) throw createError({ statusCode: error?.code === '42501' ? 403 : 400, statusMessage: error?.message ?? 'Could not send the comparison' })

  let notified = false
  if (!existing?.shared_with_patient) {
    try {
      const push = await sendPushToPatients(serverSupabaseServiceRole<Database>(event), teamMember.account_id, [patientId], {
        title: 'Nueva comparativa de tu postura',
        body: note ? note.slice(0, 140) : 'Tu clínica te ha enviado una comparativa de tu postura. Ábrela en Progreso.',
        data: { type: 'posture_comparison', comparisonId: saved.id },
      })
      notified = push.delivered > 0
    } catch (e) {
      // The comparison is in their app either way; the push is the courtesy.
      console.error('[posture-comparison] push failed', saved.id, e)
    }
  }
  return { id: saved.id, notified }
})

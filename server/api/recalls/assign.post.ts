import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { pushRecallAssignment } from '~/server/utils/staffPush'

// Who on the team follows up a lapsed patient (recall_assignments,
// 20261022185125): one row from its picker on Recalls, or a selection at
// once. teamMemberId null is "nobody", which is a choice too -- it overrides
// the clinic's default assignee for this lapse.
//
// Written as the caller, so the table's policies decide -- recalls_access, a
// patient they may see, a colleague of the same account -- and the audit
// trail names them. A server route rather than an upsert from the page only
// so the colleague can be told, which needs the service role to find their
// devices; not when they assigned themselves.
const MAX_PATIENTS = 1000

export default defineEventHandler(async (event) => {
  const body = await readBody<{ patientIds?: unknown; teamMemberId?: unknown }>(event)
  const patientIds = Array.isArray(body?.patientIds) ? [...new Set(body.patientIds.filter((id): id is string => typeof id === 'string' && id.length > 0))] : []
  if (patientIds.length === 0) throw createError({ statusCode: 400, statusMessage: 'patientIds is required' })
  if (patientIds.length > MAX_PATIENTS) throw createError({ statusCode: 400, statusMessage: `At most ${MAX_PATIENTS} patients at once` })
  const teamMemberId = typeof body?.teamMemberId === 'string' && body.teamMemberId ? body.teamMemberId : null

  const { supabase, teamMember } = await requirePermission(event, 'recalls_access')

  const assignedAt = new Date().toISOString()
  const rows = patientIds.map((patientId) => ({
    account_id: teamMember.account_id,
    patient_id: patientId,
    team_member_id: teamMemberId,
    assigned_by: teamMember.id,
    assigned_at: assignedAt,
  }))
  const { error } = await supabase.from('recall_assignments').upsert(rows, { onConflict: 'patient_id' })
  if (error) throw createError({ statusCode: 400, statusMessage: error.message })

  if (teamMemberId && teamMemberId !== teamMember.id) {
    await pushRecallAssignment(serverSupabaseServiceRole<Database>(event), { teamMemberId, actorTeamMemberId: teamMember.id, patientIds })
  }
  return { assigned: patientIds.length }
})

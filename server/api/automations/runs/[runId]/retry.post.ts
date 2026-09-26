import { retrySequenceRun } from '~/server/utils/automationEngine'
import { runControlAccess } from '~/server/utils/automationRunControls'

// "Retry this step" on a run that failed: resumes at the step that failed --
// the cursor never moved past it -- so nothing already sent goes out again.
// Patients and leads alike; a lead's run still stops first if the lead has
// booked, converted or lost Growth in the meantime.
export default defineEventHandler(async (event) => {
  const { service, teamMember, run, origin } = await runControlAccess(event)
  const retried = await retrySequenceRun(service, run.id, teamMember.account_id, teamMember.id, origin)
  if (!retried) {
    throw createError({ statusCode: 409, statusMessage: 'Only a failed run can be retried. It may already have been retried, or be running.' })
  }
  const { data } = await service.from('automation_sequence_runs').select('status, last_error').eq('id', run.id).maybeSingle()
  return { id: run.id, status: data?.status ?? 'running', lastError: data?.last_error ?? null }
})

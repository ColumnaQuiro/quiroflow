import { runControlAccess, skipRun } from '~/server/utils/automationRunControls'

// "Skip to the next step" (server/utils/automationRunControls.ts).
export default defineEventHandler(async (event) => {
  const { service, teamMember, run, origin } = await runControlAccess(event)
  await skipRun(service, run, teamMember.id, origin)
  const { data } = await service.from('automation_sequence_runs').select('status, last_error').eq('id', run.id).maybeSingle()
  return { id: run.id, status: data?.status ?? 'running', lastError: data?.last_error ?? null }
})

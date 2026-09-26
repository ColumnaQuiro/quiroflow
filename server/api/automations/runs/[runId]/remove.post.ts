import { runControlAccess, takeOutRun } from '~/server/utils/automationRunControls'

// "Take out" (server/utils/automationRunControls.ts).
export default defineEventHandler(async (event) => {
  const { service, teamMember, run } = await runControlAccess(event)
  await takeOutRun(service, run, teamMember.id)
  return { id: run.id, status: 'cancelled' }
})

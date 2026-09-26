import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { requireGrowth } from '~/server/utils/requireGrowth'
import { retrySequenceRun } from '~/server/utils/automationEngine'

// Retry a failed run, from the step that failed.
//
// Permission and entitlement come from requireGrowth, as a person. The write
// itself goes through the service role, the same as the cron: runs and their
// history are read-only to staff under RLS, deliberately, so that nothing a
// person does edits where someone is in a drip except through this one
// narrow door -- which only moves a 'failed' run back to 'running' in the
// caller's own account.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing run id' })

  const { teamMember } = await requireGrowth(event)
  const service = serverSupabaseServiceRole<Database>(event)

  const retried = await retrySequenceRun(service, id, teamMember.account_id, teamMember.id, getRequestURL(event).origin)
  if (!retried) {
    throw createError({ statusCode: 409, statusMessage: 'Only a failed run can be retried. It may already have been retried, or be running.' })
  }

  const { data: run } = await service
    .from('automation_sequence_runs')
    .select('status, last_error')
    .eq('id', id)
    .maybeSingle()

  return { id, status: run?.status ?? 'running', lastError: run?.last_error ?? null }
})

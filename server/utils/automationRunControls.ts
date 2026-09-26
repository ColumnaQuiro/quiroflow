import type { H3Event } from 'h3'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { RUN_COLUMNS, STOP_REASON_TEXT, logRunEvent, type SequenceRun } from '~/server/utils/leadSequences'
import { advanceRun } from '~/server/utils/automationEngine'
import { chainOf, type DraftStep } from '~/utils/automationTree'

// The three things a person can do to someone inside an automation, from the
// People tab: retry the step that failed, skip to the next one, take them out.
//
// Permission is checked as the person (communication_config); the write goes
// through the service role, because runs are read-only to staff under RLS on
// purpose -- these are the narrow doors, each scoped to the caller's account.

export async function runControlAccess(event: H3Event) {
  const runId = getRouterParam(event, 'runId')
  if (!runId) throw createError({ statusCode: 400, statusMessage: 'Missing run id' })
  const { teamMember } = await requirePermission(event, 'communication_config')
  const service = serverSupabaseServiceRole<Database>(event)
  const { data: run } = await service
    .from('automation_sequence_runs')
    .select(`${RUN_COLUMNS}, status`)
    .eq('id', runId)
    .eq('account_id', teamMember.account_id)
    .maybeSingle()
  if (!run) throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  return { service, teamMember, run: run as unknown as SequenceRun & { status: string }, origin: getRequestURL(event).origin }
}

/**
 * "Skip to the next step": whatever this person is waiting on or stuck at, go
 * past it now. The next step of the same chain -- a wait's or a branch's own
 * outlets are skipped with it -- or the end, if there is nothing after it.
 * Runs straight away, like Retry: the person pressing it is watching.
 */
export async function skipRun(service: any, run: SequenceRun & { status: string }, actorTeamMemberId: string, origin: string) {
  if (run.status !== 'running' && run.status !== 'failed') {
    throw createError({ statusCode: 409, statusMessage: 'Only someone still in the automation can be moved on.' })
  }
  const { data: rows } = await service.from('automation_actions').select('id, action_type, position, config, parent_id, branch').eq('rule_id', run.rule_id)
  const steps = ((rows ?? []) as DraftStep[]).map((s) => ({ ...s, parent_id: s.parent_id ?? null, branch: s.branch ?? null }))
  const root = chainOf(steps, null, null)
  const current =
    (run.current_action_id ? steps.find((s) => s.id === run.current_action_id) : null) ?? root.find((s) => s.position >= run.next_position) ?? null
  if (!current) throw createError({ statusCode: 409, statusMessage: 'This person is not on any step.' })

  const next = chainOf(steps, current.parent_id, current.branch).find((s) => s.position > current.position) ?? null
  await logRunEvent(service, run, { outcome: 'skipped', action: current as never, detail: 'Skipped by a person on the team.', actorTeamMemberId })

  if (!next) {
    await service
      .from('automation_sequence_runs')
      .update({ status: 'done', current_action_id: null, waiting_for: null, wait_deadline: null, attempts: 0, last_error: null, ...(current.parent_id === null ? { next_position: current.position + 1 } : {}) })
      .eq('id', run.id)
    await logRunEvent(service, run, { outcome: 'finished' })
    return
  }

  const { data: moved } = await service
    .from('automation_sequence_runs')
    .update({
      status: 'running',
      current_action_id: next.id,
      waiting_for: null,
      wait_deadline: null,
      attempts: 0,
      last_error: null,
      resume_at: new Date().toISOString(),
      ...(next.parent_id === null ? { next_position: next.position } : {}),
    })
    .eq('id', run.id)
    .in('status', ['running', 'failed'])
    .select(RUN_COLUMNS)
    .maybeSingle()
  if (moved) await advanceRun(service, moved as SequenceRun, origin)
}

/** "Take out": ends the run now. Nothing more is sent; what was sent stays. */
export async function takeOutRun(service: any, run: SequenceRun & { status: string }, actorTeamMemberId: string) {
  if (run.status !== 'running' && run.status !== 'failed') {
    throw createError({ statusCode: 409, statusMessage: 'This person has already left the automation.' })
  }
  // What stopRun does, plus who pressed the button.
  await service.from('automation_sequence_runs').update({ status: 'cancelled', stopped_reason: 'taken_out' }).eq('id', run.id)
  await logRunEvent(service, run, { outcome: 'stopped', detail: STOP_REASON_TEXT.taken_out, actorTeamMemberId })
}

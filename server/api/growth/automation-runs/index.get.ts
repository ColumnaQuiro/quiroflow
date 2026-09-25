import { requireGrowth } from '~/server/utils/requireGrowth'
import { STOP_REASON_TEXT, stepLabel, type StopReason } from '~/server/utils/leadSequences'

// Executions: every run of a lead automation, newest first.
//
// The list answers "did it work, and if not, why" without opening anything:
// status, who it was for, which step it is on, and the last error in words.
// The history of a single run is [id].get.ts.

const STATUSES = ['running', 'done', 'cancelled', 'failed'] as const
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireGrowth(event)
  const accountId = teamMember.account_id
  const query = getQuery(event)

  const status = STATUSES.find((s) => s === query.status) ?? null
  const ruleId = typeof query.ruleId === 'string' && query.ruleId ? query.ruleId : null
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  // Cursor on started_at, so "Load more" is stable while new runs arrive.
  const before = typeof query.before === 'string' && query.before ? query.before : null

  let runsQuery = supabase
    .from('automation_sequence_runs')
    .select('id, rule_id, lead_id, status, stopped_reason, next_position, attempts, last_error, resume_at, started_at, updated_at, leads(full_name, phone, email), automation_rules(name)')
    .eq('account_id', accountId)
    .order('started_at', { ascending: false })
    .limit(limit + 1)
  if (status) runsQuery = runsQuery.eq('status', status)
  if (ruleId) runsQuery = runsQuery.eq('rule_id', ruleId)
  if (before) runsQuery = runsQuery.lt('started_at', before)

  // The counts are always account-wide for the chosen workflow, whatever
  // status filter is on: they label the filter chips, and a chip reading "0"
  // because it is the one filtered out would be wrong.
  const count = (s: (typeof STATUSES)[number]) => {
    let q = supabase.from('automation_sequence_runs').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('status', s)
    if (ruleId) q = q.eq('rule_id', ruleId)
    return q
  }

  const [{ data: rows, error }, running, done, cancelled, failed] = await Promise.all([
    runsQuery,
    count('running'),
    count('done'),
    count('cancelled'),
    count('failed'),
  ])
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const page = (rows ?? []).slice(0, limit)
  const ruleIds = [...new Set(page.map((r) => r.rule_id))]
  const { data: actions } = ruleIds.length
    ? await supabase.from('automation_actions').select('rule_id, action_type, position, config').in('rule_id', ruleIds).order('position')
    : { data: [] }

  const actionsByRule = new Map<string, { action_type: string; position: number; config: Record<string, any> }[]>()
  for (const a of actions ?? []) actionsByRule.set(a.rule_id, [...(actionsByRule.get(a.rule_id) ?? []), a as never])

  const runs = page.map((r) => {
    const ruleActions = actionsByRule.get(r.rule_id) ?? []
    const current = ruleActions.find((a) => a.position >= r.next_position) ?? null
    const lead = r.leads as unknown as { full_name: string; phone: string | null; email: string | null } | null
    const rule = r.automation_rules as unknown as { name: string } | null
    return {
      id: r.id,
      ruleId: r.rule_id,
      ruleName: rule?.name ?? '—',
      leadId: r.lead_id,
      leadName: lead?.full_name ?? '—',
      leadContact: lead?.phone ?? lead?.email ?? null,
      status: r.status,
      stoppedReason: r.stopped_reason ? (STOP_REASON_TEXT[r.stopped_reason as StopReason] ?? r.stopped_reason) : null,
      // Which step it is on (running/failed), in words. Nothing for a run
      // that has finished or stopped: there is no current step.
      currentStep: (r.status === 'running' || r.status === 'failed') && current ? stepLabel(current) : null,
      attempts: r.attempts,
      lastError: r.last_error,
      resumeAt: r.status === 'running' ? r.resume_at : null,
      startedAt: r.started_at,
      updatedAt: r.updated_at,
    }
  })

  return {
    runs,
    nextBefore: (rows ?? []).length > limit ? page[page.length - 1]!.started_at : null,
    counts: {
      running: running.count ?? 0,
      done: done.count ?? 0,
      cancelled: cancelled.count ?? 0,
      failed: failed.count ?? 0,
    },
  }
})

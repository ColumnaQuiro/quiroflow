import { stepLabel } from '~/server/utils/leadSequences'

// People: who is in this automation, where, since when and what comes next --
// patients and leads alike, one row per run. Filtered by where they are
// (in progress, finished, left, failed) and optionally by the step they are
// on. The history of one run is /api/automations/runs/:id.
//
// Readable by any member under RLS; the page behind it needs
// communication_config, and so does this.

const TABS = {
  running: ['running'],
  done: ['done'],
  exited: ['cancelled'],
  failed: ['failed'],
} as const
type Tab = keyof typeof TABS
const LIMIT = 100

export default defineEventHandler(async (event) => {
  const ruleId = getRouterParam(event, 'id')
  if (!ruleId) throw createError({ statusCode: 400, statusMessage: 'Missing automation id' })
  const { supabase, teamMember } = await requirePermission(event, 'communication_config')
  const query = getQuery(event)
  const tab: Tab = (Object.keys(TABS) as Tab[]).find((k) => k === query.tab) ?? 'running'
  const stepId = typeof query.step === 'string' && query.step ? query.step : null
  const before = typeof query.before === 'string' && query.before ? query.before : null

  const { data: rule } = await supabase.from('automation_rules').select('id').eq('id', ruleId).eq('account_id', teamMember.account_id).maybeSingle()
  if (!rule) throw createError({ statusCode: 404, statusMessage: 'Automation not found' })

  let rows = supabase
    .from('automation_sequence_runs')
    .select('id, lead_id, patient_id, status, stopped_reason, current_action_id, next_position, waiting_for, wait_deadline, attempts, last_error, resume_at, started_at, updated_at, leads(full_name), patients(first_name, last_name)')
    .eq('rule_id', ruleId)
    .in('status', [...TABS[tab]])
    .order('started_at', { ascending: false })
    .limit(LIMIT + 1)
  if (stepId) rows = rows.eq('current_action_id', stepId)
  if (before) rows = rows.lt('started_at', before)

  const count = (statuses: readonly string[]) =>
    supabase.from('automation_sequence_runs').select('id', { count: 'exact', head: true }).eq('rule_id', ruleId).in('status', [...statuses])

  const [{ data, error }, running, done, exited, failed, { data: steps }] = await Promise.all([
    rows,
    count(TABS.running),
    count(TABS.done),
    count(TABS.exited),
    count(TABS.failed),
    supabase.from('automation_actions').select('id, action_type, position, config, parent_id').eq('rule_id', ruleId),
  ])
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const page = (data ?? []).slice(0, LIMIT)
  const byId = new Map((steps ?? []).map((s) => [s.id, s]))
  const root = (steps ?? []).filter((s) => !s.parent_id).sort((a, b) => a.position - b.position)

  return {
    runs: page.map((r) => {
      // Where they are: the step the run points at, or -- for a run from
      // before the engine -- the root-chain step at its cursor.
      const step = (r.current_action_id ? byId.get(r.current_action_id) : null) ?? root.find((s) => s.position >= r.next_position) ?? null
      const patient = r.patients as unknown as { first_name: string; last_name: string | null } | null
      const lead = r.leads as unknown as { full_name: string } | null
      return {
        id: r.id,
        subject: r.patient_id
          ? { kind: 'patient' as const, id: r.patient_id, name: patient ? `${patient.first_name} ${patient.last_name ?? ''}`.trim() : '—' }
          : { kind: 'lead' as const, id: r.lead_id, name: lead?.full_name ?? '—' },
        status: r.status,
        stoppedReason: r.stopped_reason,
        stepId: r.status === 'running' || r.status === 'failed' ? (step?.id ?? null) : null,
        stepLabel: (r.status === 'running' || r.status === 'failed') && step ? stepLabel(step as never) : null,
        stepType: (r.status === 'running' || r.status === 'failed') && step ? step.action_type : null,
        waitingFor: r.waiting_for,
        waitDeadline: r.wait_deadline,
        resumeAt: r.status === 'running' ? r.resume_at : null,
        attempts: r.attempts,
        lastError: r.last_error,
        startedAt: r.started_at,
        updatedAt: r.updated_at,
      }
    }),
    nextBefore: (data ?? []).length > LIMIT ? page[page.length - 1]!.started_at : null,
    counts: { running: running.count ?? 0, done: done.count ?? 0, exited: exited.count ?? 0, failed: failed.count ?? 0 },
  }
})

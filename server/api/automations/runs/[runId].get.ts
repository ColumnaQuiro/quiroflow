// One person's journey through an automation: the run and every history row
// -- entered, waited, branched, sent or failed and why, retried by whom.
export default defineEventHandler(async (event) => {
  const runId = getRouterParam(event, 'runId')
  if (!runId) throw createError({ statusCode: 400, statusMessage: 'Missing run id' })
  const { supabase, teamMember } = await requirePermission(event, 'communication_config')

  const { data: run, error } = await supabase
    .from('automation_sequence_runs')
    .select('id, rule_id, lead_id, patient_id, status, stopped_reason, current_action_id, waiting_for, wait_deadline, attempts, last_error, resume_at, started_at, leads(full_name, phone, email), patients(first_name, last_name, email), automation_rules(name, dry_run)')
    .eq('id', runId)
    .eq('account_id', teamMember.account_id)
    .maybeSingle()
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!run) throw createError({ statusCode: 404, statusMessage: 'Run not found' })

  const { data: events } = await supabase
    .from('automation_run_events')
    .select('id, action_id, action_type, step_label, outcome, detail, actor_team_member_id, created_at')
    .eq('run_id', runId)
    .order('created_at')

  const actorIds = [...new Set((events ?? []).map((e) => e.actor_team_member_id).filter(Boolean))] as string[]
  const { data: actors } = actorIds.length ? await supabase.from('team_members').select('id, full_name').in('id', actorIds) : { data: [] }
  const actorName = new Map((actors ?? []).map((a) => [a.id, a.full_name]))

  const patient = run.patients as unknown as { first_name: string; last_name: string | null; email: string | null } | null
  const lead = run.leads as unknown as { full_name: string; phone: string | null; email: string | null } | null
  const rule = run.automation_rules as unknown as { name: string; dry_run: boolean } | null

  return {
    run: {
      id: run.id,
      ruleId: run.rule_id,
      ruleName: rule?.name ?? '—',
      dryRun: rule?.dry_run ?? false,
      subject: run.patient_id
        ? { kind: 'patient' as const, id: run.patient_id, name: patient ? `${patient.first_name} ${patient.last_name ?? ''}`.trim() : '—', contact: patient?.email ?? null }
        : { kind: 'lead' as const, id: run.lead_id, name: lead?.full_name ?? '—', contact: lead?.phone ?? lead?.email ?? null },
      status: run.status,
      stoppedReason: run.stopped_reason,
      currentStepId: run.current_action_id,
      waitingFor: run.waiting_for,
      waitDeadline: run.wait_deadline,
      attempts: run.attempts,
      lastError: run.last_error,
      resumeAt: run.status === 'running' ? run.resume_at : null,
      startedAt: run.started_at,
    },
    events: (events ?? []).map((e) => ({
      id: e.id,
      stepId: e.action_id,
      actionType: e.action_type,
      stepLabel: e.step_label,
      outcome: e.outcome,
      detail: e.detail,
      actor: e.actor_team_member_id ? (actorName.get(e.actor_team_member_id) ?? null) : null,
      at: e.created_at,
    })),
  }
})

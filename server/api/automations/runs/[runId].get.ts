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
    .select('id, action_id, position, action_type, step_label, outcome, detail, actor_team_member_id, created_at')
    .eq('run_id', runId)
    .order('created_at')

  const actorIds = [...new Set((events ?? []).map((e) => e.actor_team_member_id).filter(Boolean))] as string[]
  const { data: actors } = actorIds.length ? await supabase.from('team_members').select('id, full_name').in('id', actorIds) : { data: [] }
  const actorName = new Map((actors ?? []).map((a) => [a.id, a.full_name]))

  // What each step sent this person: WhatsApp and email rows of this rule's
  // steps, from when they entered. Rows written before messages carried their
  // step (automation_action_id) are matched by template name instead -- the
  // lead drips that ran before that are exactly the ones people look back at.
  const { data: steps } = await supabase.from('automation_actions').select('id, action_type, config').eq('rule_id', run.rule_id)
  const stepIds = (steps ?? []).map((s) => s.id)
  const templateStep = new Map<string, string>()
  for (const s of steps ?? []) {
    const name = (s.config as { template_name?: string } | null)?.template_name
    if (s.action_type === 'whatsapp_template' && name && !templateStep.has(name)) templateStep.set(name, s.id)
  }
  const since = new Date(new Date(run.started_at).getTime() - 2 * 60_000).toISOString()
  const who = run.patient_id ? { col: 'patient_id', id: run.patient_id } : { col: 'lead_id', id: run.lead_id as string }
  const [{ data: wa }, { data: mail }] = stepIds.length
    ? await Promise.all([
        supabase
          .from('whatsapp_messages')
          .select('id, automation_action_id, template_name, status, error_message, body_preview, created_at, updated_at')
          .eq(who.col, who.id)
          .eq('direction', 'outbound')
          .gte('created_at', since)
          .or(`automation_action_id.in.(${stepIds.join(',')}),and(automation_action_id.is.null,template_name.in.(${[...templateStep.keys()].map((n) => `"${n}"`).join(',') || '""'}))`)
          .order('created_at'),
        supabase
          .from('email_messages')
          .select('id, automation_action_id, subject, sent_at, delivered_at, first_opened_at, first_clicked_at, bounced_at, failed_at, failure_reason, dry_run')
          .eq(who.col, who.id)
          .eq('rule_id', run.rule_id)
          .gte('sent_at', since)
          .order('sent_at'),
      ])
    : [{ data: [] }, { data: [] }]

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
    messages: [
      ...(wa ?? []).map((m) => ({
        id: m.id,
        stepId: m.automation_action_id ?? (m.template_name ? templateStep.get(m.template_name) ?? null : null),
        channel: 'whatsapp' as const,
        status: m.status,
        templateName: m.template_name,
        subject: null,
        body: m.body_preview,
        error: m.error_message,
        at: m.created_at,
        // Delivery and read receipts update the row; its last change is when the latest one came.
        deliveredAt: m.status === 'delivered' || m.status === 'read' ? m.updated_at : null,
        openedAt: m.status === 'read' ? m.updated_at : null,
      })),
      ...(mail ?? []).map((m) => ({
        id: m.id,
        stepId: m.automation_action_id,
        channel: 'email' as const,
        status: m.dry_run ? 'dry_run' : m.bounced_at ? 'bounced' : m.failed_at ? 'failed' : m.first_clicked_at ? 'clicked' : m.first_opened_at ? 'opened' : m.delivered_at ? 'delivered' : 'sent',
        templateName: null,
        subject: m.subject,
        body: null,
        error: m.failure_reason,
        at: m.sent_at,
        deliveredAt: m.delivered_at,
        openedAt: m.first_opened_at,
        clickedAt: m.first_clicked_at,
      })),
    ],
    events: (events ?? []).map((e) => ({
      id: e.id,
      stepId: e.action_id,
      position: e.position,
      actionType: e.action_type,
      stepLabel: e.step_label,
      outcome: e.outcome,
      detail: e.detail,
      actor: e.actor_team_member_id ? (actorName.get(e.actor_team_member_id) ?? null) : null,
      at: e.created_at,
    })),
  }
})

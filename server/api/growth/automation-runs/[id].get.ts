import { requireGrowth } from '~/server/utils/requireGrowth'
import { STOP_REASON_TEXT, type StopReason } from '~/server/utils/leadSequences'

// One run of an automation (a lead's or a patient's), with its full history: every step sent,
// skipped or failed and why, every wait, deferral and retry, in order.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing run id' })

  const { supabase, teamMember } = await requireGrowth(event)

  // account_id filtered here as well as by RLS, so a foreign id is a clean 404.
  const { data: run, error } = await supabase
    .from('automation_sequence_runs')
    .select('id, rule_id, lead_id, patient_id, status, stopped_reason, next_position, attempts, last_error, resume_at, started_at, updated_at, leads(full_name, phone, email), patients(first_name, last_name, email), automation_rules(name, dry_run)')
    .eq('id', id)
    .eq('account_id', teamMember.account_id)
    .maybeSingle()
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!run) throw createError({ statusCode: 404, statusMessage: 'Run not found' })

  const { data: events } = await supabase
    .from('automation_run_events')
    .select('id, position, action_type, step_label, outcome, detail, actor_team_member_id, created_at')
    .eq('run_id', id)
    .order('created_at')

  const actorIds = [...new Set((events ?? []).map((e) => e.actor_team_member_id).filter(Boolean))] as string[]
  const { data: actors } = actorIds.length
    ? await supabase.from('team_members').select('id, full_name').in('id', actorIds)
    : { data: [] }
  const actorName = new Map((actors ?? []).map((a) => [a.id, a.full_name]))

  const patient = run.patients as unknown as { first_name: string; last_name: string | null; email: string | null } | null
  const lead = (run.leads as unknown as { full_name: string; phone: string | null; email: string | null } | null)
    ?? (patient ? { full_name: `${patient.first_name} ${patient.last_name ?? ''}`.trim(), phone: null, email: patient.email } : null)
  const rule = run.automation_rules as unknown as { name: string; dry_run: boolean } | null

  return {
    run: {
      id: run.id,
      ruleId: run.rule_id,
      ruleName: rule?.name ?? '—',
      dryRun: rule?.dry_run ?? false,
      leadId: run.lead_id,
      patientId: run.patient_id,
      leadName: lead?.full_name ?? '—',
      leadPhone: lead?.phone ?? null,
      leadEmail: lead?.email ?? null,
      status: run.status,
      stoppedReason: run.stopped_reason ? (STOP_REASON_TEXT[run.stopped_reason as StopReason] ?? run.stopped_reason) : null,
      attempts: run.attempts,
      lastError: run.last_error,
      resumeAt: run.status === 'running' ? run.resume_at : null,
      startedAt: run.started_at,
      updatedAt: run.updated_at,
    },
    events: (events ?? []).map((e) => ({
      id: e.id,
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

import { canReadWhatsApp } from '~/server/utils/automationStats'

// Historial: the most recent things this automation did, newest first -- the
// run history (entered, waited, branched, tagged, failed…) together with the
// messages it recorded, so a rule that sends straight away (and so has no
// runs) has a history too. WhatsApp rows only for someone with Inbox access,
// the same rule the Inbox applies.
const LIMIT = 150

export default defineEventHandler(async (event) => {
  const ruleId = getRouterParam(event, 'id')
  if (!ruleId) throw createError({ statusCode: 400, statusMessage: 'Missing automation id' })
  const { supabase, teamMember } = await requirePermission(event, 'communication_config')
  const accountId = teamMember.account_id

  const { data: rule } = await supabase.from('automation_rules').select('id').eq('id', ruleId).eq('account_id', accountId).maybeSingle()
  if (!rule) throw createError({ statusCode: 404, statusMessage: 'Automation not found' })

  const readWhatsApp = await canReadWhatsApp(supabase, teamMember)
  const [{ data: events }, { data: wa }, { data: email }] = await Promise.all([
    supabase
      .from('automation_run_events')
      .select('id, run_id, action_id, step_label, outcome, detail, created_at, automation_sequence_runs!inner(rule_id, patient_id, lead_id, patients(first_name, last_name), leads(full_name))')
      .eq('automation_sequence_runs.rule_id', ruleId)
      .order('created_at', { ascending: false })
      .limit(LIMIT),
    readWhatsApp
      ? supabase
          .from('whatsapp_messages')
          .select('id, automation_action_id, template_name, status, error_message, created_at, patient_id, lead_id, patients(first_name, last_name), leads(full_name)')
          .eq('account_id', accountId)
          .eq('rule_id', ruleId)
          .order('created_at', { ascending: false })
          .limit(LIMIT)
      : Promise.resolve({ data: [] as any[] }),
    supabase
      .from('email_messages')
      .select('id, automation_action_id, subject, dry_run, delivered_at, first_opened_at, first_clicked_at, bounced_at, failed_at, sent_at, patient_id, lead_id, patients(first_name, last_name), leads(full_name)')
      .eq('account_id', accountId)
      .eq('rule_id', ruleId)
      .order('sent_at', { ascending: false })
      .limit(LIMIT),
  ])

  const personName = (p: any, l: any) => (p ? `${p.first_name} ${p.last_name ?? ''}`.trim() : (l?.full_name ?? null))

  const items = [
    ...(events ?? []).map((e: any) => ({
      kind: 'event' as const,
      id: e.id,
      runId: e.run_id,
      stepId: e.action_id,
      at: e.created_at,
      outcome: e.outcome,
      label: e.step_label,
      detail: e.detail,
      person: personName(e.automation_sequence_runs?.patients, e.automation_sequence_runs?.leads),
      patientId: e.automation_sequence_runs?.patient_id ?? null,
      leadId: e.automation_sequence_runs?.lead_id ?? null,
    })),
    ...(wa ?? []).map((m: any) => ({
      kind: 'whatsapp' as const,
      id: m.id,
      runId: null,
      stepId: m.automation_action_id,
      at: m.created_at,
      outcome: m.status,
      label: m.template_name,
      detail: m.error_message,
      person: personName(m.patients, m.leads),
      patientId: m.patient_id,
      leadId: m.lead_id,
    })),
    ...(email ?? []).map((m: any) => ({
      kind: 'email' as const,
      id: m.id,
      runId: null,
      stepId: m.automation_action_id,
      at: m.sent_at,
      outcome: m.dry_run ? 'dry_run' : m.bounced_at ? 'bounced' : m.failed_at ? 'failed' : m.first_clicked_at ? 'clicked' : m.first_opened_at ? 'opened' : m.delivered_at ? 'delivered' : 'sent',
      label: m.subject,
      detail: null,
      person: personName(m.patients, m.leads),
      patientId: m.patient_id,
      leadId: m.lead_id,
    })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, LIMIT)

  return { items, canReadWhatsApp: readWhatsApp }
})

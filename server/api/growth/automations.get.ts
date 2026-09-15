import { requirePermission } from '~/server/utils/requirePermission'

// The account's real automations, shaped for the workflow canvas.
//
// This page used to render fixtures: seven invented workflows with invented
// run counts, credited to a person who does not work here. That was honest
// enough as an imported design and stopped being honest the moment real
// automations existed -- one of which now messages strangers.
//
// The reconciliation the old composable predicted ("the flat rules becoming
// single-step workflows") is what this does. A rule is a chain: its trigger,
// then its actions in order, with a delay drawn as its own step. Nothing
// here branches yet, because nothing in the schema branches yet -- and
// drawing a branch that cannot exist is how the fixtures got here.

const TRIGGER_TITLES: Record<string, string> = {
  'lead.created': 'New lead arrives',
  'appointment.booked': 'Appointment booked',
  'appointment.checked_in': 'Patient checked in',
  'appointment.completed': 'Appointment completed',
  'appointment.cancelled': 'Appointment cancelled',
  'appointment.no_show': 'Patient did not show',
  'appointment.rescheduled': 'Appointment rescheduled',
  'appointment.same_day': 'Same-day appointment',
  'appointment.hours_before': 'Before an appointment',
  'appointment.review_request': 'After a visit',
  'invoice.paid': 'Invoice paid',
  'patient.birthday': 'Patient birthday',
  'patient.referred': 'Patient referred someone',
  'membership.new_member': 'New member',
  'membership.removed': 'Membership ended',
  'membership.payment_processed': 'Membership payment',
}

function delayLabel(minutes: number) {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440
    return `Wait ${days} ${days === 1 ? 'day' : 'days'}`
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return `Wait ${hours} ${hours === 1 ? 'hour' : 'hours'}`
  }
  return `Wait ${minutes} min`
}

export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requirePermission(event, 'communication_config')
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()

  const [{ data: rules }, { data: actions }, { data: sequenceRuns }, { data: sends }] = await Promise.all([
    supabase
      .from('automation_rules')
      .select('id, name, trigger_event, enabled, is_marketing, dry_run, created_at')
      .eq('account_id', teamMember.account_id)
      .order('created_at', { ascending: false }),
    supabase
      .from('automation_actions')
      .select('id, rule_id, action_type, position, config')
      .eq('account_id', teamMember.account_id)
      .order('position'),
    supabase
      .from('automation_sequence_runs')
      .select('rule_id, status')
      .eq('account_id', teamMember.account_id)
      .gte('started_at', since),
    supabase
      .from('automation_rule_sends')
      .select('rule_id')
      .gte('sent_at', since),
  ])

  const actionsByRule = new Map<string, { action_type: string; position: number; config: Record<string, any> }[]>()
  for (const a of actions ?? []) {
    actionsByRule.set(a.rule_id, [...(actionsByRule.get(a.rule_id) ?? []), a as never])
  }

  const sendCounts = new Map<string, number>()
  for (const s of sends ?? []) sendCounts.set(s.rule_id, (sendCounts.get(s.rule_id) ?? 0) + 1)

  const runCounts = new Map<string, { total: number; running: number; stopped: number }>()
  for (const r of sequenceRuns ?? []) {
    const current = runCounts.get(r.rule_id) ?? { total: 0, running: 0, stopped: 0 }
    current.total += 1
    if (r.status === 'running') current.running += 1
    if (r.status === 'cancelled') current.stopped += 1
    runCounts.set(r.rule_id, current)
  }

  const workflows = (rules ?? []).map((rule) => {
    const ruleActions = actionsByRule.get(rule.id) ?? []
    const sequence = runCounts.get(rule.id)
    const sent = sendCounts.get(rule.id) ?? 0

    // Counted from whichever table actually records this rule running. A
    // sequence has runs; a one-shot rule has sends. Zero says zero rather
    // than being dressed up -- a new automation has not run yet, and that is
    // worth seeing.
    const runs = sequence
      ? `${sequence.total} ${sequence.total === 1 ? 'run' : 'runs'} · 30d${sequence.running ? ` · ${sequence.running} in progress` : ''}`
      : `${sent} ${sent === 1 ? 'run' : 'runs'} · 30d`

    return {
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      dryRun: rule.dry_run ?? false,
      isMarketing: rule.is_marketing ?? false,
      triggerEvent: rule.trigger_event,
      runs,
      steps: [
        {
          kind: 'trigger' as const,
          title: TRIGGER_TITLES[rule.trigger_event] ?? rule.trigger_event,
          eyebrow: 'Trigger',
          detail: rule.trigger_event,
        },
        ...ruleActions.map((action) => {
          if (action.action_type === 'delay') {
            return { kind: 'delay' as const, title: delayLabel(Number(action.config?.delay_minutes) || 0), eyebrow: 'Wait', detail: null }
          }
          if (action.action_type === 'email') {
            return { kind: 'message' as const, title: action.config?.subject || 'Email', eyebrow: 'Message · Email', detail: null }
          }
          if (action.action_type === 'webhook') {
            return { kind: 'internal' as const, title: 'Webhook', eyebrow: 'Internal', detail: action.config?.url ?? null }
          }
          const header = action.config?.header?.type
          return {
            kind: 'message' as const,
            title: action.config?.template_name || 'WhatsApp template',
            eyebrow: 'Message · WhatsApp',
            detail: header ? `with ${header} header` : null,
          }
        }),
      ],
    }
  })

  return { workflows }
})

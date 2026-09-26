// What each automation -- and each step of one -- has done in the last 30
// days, for the Automations list and the builder's canvas.
//
// Counted from the rows the sender and the engine write, each attributed to
// its rule and step (whatsapp_messages.rule_id / automation_action_id,
// email_messages.rule_id / automation_action_id, automation_run_events.action_id):
//
//   - a test-mode WhatsApp row (status 'would_send') or email row (dry_run) is
//     NOT a send. The Campaigns page counted would_send rows as sent, so a rule
//     in test mode reported deliveries that never happened.
//   - per rule means per rule. The Campaigns page joined WhatsApp rows to rules
//     by template_name, so two automations using one template reported each
//     other's sends -- and a manual Inbox send of it as theirs.
//
// Messages sent before the attribution columns existed carry no rule and count
// towards none.
//
// WhatsApp rows are read with the caller's own client, so they stay behind
// inbox_access exactly as the Inbox does (0164); `canReadWhatsApp` says when
// the figures are hidden rather than zero.

const DAY = 24 * 3600 * 1000
export const STATS_DAYS = 30

export interface MessageStats {
  sent: number
  delivered: number
  read: number
  failed: number
  /** Recorded in test mode, not sent. */
  recorded: number
}
export interface EmailStats {
  sent: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  failed: number
  recorded: number
}
export interface RuleStats {
  /** Runs still in it (running or failed). Null for a rule that never starts runs. */
  inside: number
  failedRuns: number
  entered: number
  /** Lead rules: runs that ended because the lead became a patient. */
  converted: number
  whatsapp: MessageStats
  email: EmailStats
}
export interface StepStats {
  /** Runs parked on or failed at this step right now. */
  here: number
  failedHere: number
  applied: number
  yes: number
  no: number
  met: number
  timedOut: number
  failed: number
  whatsapp: MessageStats
  email: EmailStats
}

const blankMessages = (): MessageStats => ({ sent: 0, delivered: 0, read: 0, failed: 0, recorded: 0 })
const blankEmail = (): EmailStats => ({ sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, failed: 0, recorded: 0 })
const blankRule = (): RuleStats => ({ inside: 0, failedRuns: 0, entered: 0, converted: 0, whatsapp: blankMessages(), email: blankEmail() })
export const blankStep = (): StepStats => ({ here: 0, failedHere: 0, applied: 0, yes: 0, no: 0, met: 0, timedOut: 0, failed: 0, whatsapp: blankMessages(), email: blankEmail() })

/** Every row of a query, past PostgREST's 1000-row page. */
async function allRows<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>, cap = 50_000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < cap; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

export async function canReadWhatsApp(supabase: any, teamMember: { account_id: string; is_owner?: boolean }) {
  if (teamMember.is_owner) return true
  const { data } = await supabase.rpc('has_permission', { target_account_id: teamMember.account_id, perm_key: 'inbox_access' })
  return Boolean(data)
}

interface WaRow {
  rule_id: string
  automation_action_id: string | null
  status: string
  patient_id: string | null
  lead_id: string | null
  appointment_id: string | null
  created_at: string
}
interface EmailRow {
  rule_id: string
  automation_action_id: string | null
  dry_run: boolean
  delivered_at: string | null
  first_opened_at: string | null
  first_clicked_at: string | null
  bounced_at: string | null
  failed_at: string | null
  patient_id: string | null
  lead_id: string | null
  sent_at: string
}

function bumpWhatsApp(s: MessageStats, row: WaRow) {
  if (row.status === 'would_send') {
    s.recorded += 1
    return
  }
  if (row.status === 'failed') {
    s.failed += 1
    return
  }
  s.sent += 1
  if (row.status === 'delivered' || row.status === 'read') s.delivered += 1
  if (row.status === 'read') s.read += 1
}
function bumpEmail(s: EmailStats, row: EmailRow) {
  if (row.dry_run) {
    s.recorded += 1
    return
  }
  s.sent += 1
  if (row.delivered_at) s.delivered += 1
  if (row.first_opened_at) s.opened += 1
  if (row.first_clicked_at) s.clicked += 1
  if (row.bounced_at) s.bounced += 1
  if (row.failed_at) s.failed += 1
}

async function messageRows(supabase: any, accountId: string, since: string, readWhatsApp: boolean, ruleId?: string) {
  const [wa, email] = await Promise.all([
    readWhatsApp
      ? allRows<WaRow>((from, to) => {
          let q = supabase
            .from('whatsapp_messages')
            .select('rule_id, automation_action_id, status, patient_id, lead_id, appointment_id, created_at')
            .eq('account_id', accountId)
            .eq('direction', 'outbound')
            .gte('created_at', since)
          q = ruleId ? q.eq('rule_id', ruleId) : q.not('rule_id', 'is', null)
          return q.range(from, to)
        })
      : Promise.resolve([] as WaRow[]),
    allRows<EmailRow>((from, to) => {
      let q = supabase
        .from('email_messages')
        .select('rule_id, automation_action_id, dry_run, delivered_at, first_opened_at, first_clicked_at, bounced_at, failed_at, patient_id, lead_id, sent_at')
        .eq('account_id', accountId)
        .gte('sent_at', since)
      q = ruleId ? q.eq('rule_id', ruleId) : q.not('rule_id', 'is', null)
      return q.range(from, to)
    }),
  ])
  return { wa, email }
}

/**
 * How many people entered a rule that sends straight away (no run rows): one
 * per person per appointment -- or per day, for a trigger with no
 * appointment -- across everything it recorded, test mode included, since a
 * rule in test mode still picked those people.
 */
function immediateEntries(wa: WaRow[], email: EmailRow[]): number {
  const keys = new Set<string>()
  for (const r of wa) keys.add(`${r.patient_id ?? r.lead_id}|${r.appointment_id ?? r.created_at.slice(0, 10)}`)
  for (const r of email) keys.add(`${r.patient_id ?? r.lead_id}|${r.sent_at.slice(0, 10)}`)
  return keys.size
}

/** Stats for every automation on the account. `service` reads runs and cron sends; `supabase` (the caller) reads messages. */
export async function statsByRule(supabase: any, service: any, accountId: string, readWhatsApp: boolean): Promise<Record<string, RuleStats>> {
  const since = new Date(Date.now() - STATS_DAYS * DAY).toISOString()
  const [active, recent, sends, { wa, email }] = await Promise.all([
    allRows<{ rule_id: string; status: string }>((from, to) =>
      service.from('automation_sequence_runs').select('rule_id, status').eq('account_id', accountId).in('status', ['running', 'failed']).range(from, to),
    ),
    allRows<{ rule_id: string; stopped_reason: string | null }>((from, to) =>
      service.from('automation_sequence_runs').select('rule_id, stopped_reason').eq('account_id', accountId).gte('started_at', since).range(from, to),
    ),
    allRows<{ rule_id: string; automation_rules: { account_id: string } }>((from, to) =>
      service.from('automation_rule_sends').select('rule_id, automation_rules!inner(account_id)').eq('automation_rules.account_id', accountId).gte('sent_at', since).range(from, to),
    ),
    messageRows(supabase, accountId, since, readWhatsApp),
  ])

  const stats: Record<string, RuleStats> = {}
  const of = (id: string) => (stats[id] ??= blankRule())
  for (const r of active) {
    of(r.rule_id).inside += 1
    if (r.status === 'failed') of(r.rule_id).failedRuns += 1
  }
  const runsStarted = new Map<string, number>()
  for (const r of recent) {
    runsStarted.set(r.rule_id, (runsStarted.get(r.rule_id) ?? 0) + 1)
    if (r.stopped_reason === 'converted' || r.stopped_reason === 'already_a_patient') of(r.rule_id).converted += 1
  }
  const waByRule = new Map<string, WaRow[]>()
  for (const r of wa) {
    bumpWhatsApp(of(r.rule_id).whatsapp, r)
    waByRule.set(r.rule_id, [...(waByRule.get(r.rule_id) ?? []), r])
  }
  const emailByRule = new Map<string, EmailRow[]>()
  for (const r of email) {
    bumpEmail(of(r.rule_id).email, r)
    emailByRule.set(r.rule_id, [...(emailByRule.get(r.rule_id) ?? []), r])
  }
  const sendsByRule = new Map<string, number>()
  for (const s of sends) sendsByRule.set(s.rule_id, (sendsByRule.get(s.rule_id) ?? 0) + 1)

  for (const id of new Set([...Object.keys(stats), ...runsStarted.keys(), ...sendsByRule.keys()])) {
    const runs = runsStarted.get(id) ?? 0
    of(id).entered = runs > 0 ? runs : Math.max(immediateEntries(waByRule.get(id) ?? [], emailByRule.get(id) ?? []), sendsByRule.get(id) ?? 0)
  }
  return stats
}

/** Stats for one automation, per step, plus the rule's own totals. */
export async function statsForRule(supabase: any, service: any, accountId: string, ruleId: string, readWhatsApp: boolean) {
  const since = new Date(Date.now() - STATS_DAYS * DAY).toISOString()
  const [active, runsRecent, events, sends, { wa, email }] = await Promise.all([
    allRows<{ status: string; current_action_id: string | null; waiting_for: string | null }>((from, to) =>
      service.from('automation_sequence_runs').select('status, current_action_id, waiting_for').eq('rule_id', ruleId).in('status', ['running', 'failed']).range(from, to),
    ),
    service.from('automation_sequence_runs').select('id', { count: 'exact', head: true }).eq('rule_id', ruleId).gte('started_at', since),
    allRows<{ action_id: string | null; outcome: string; detail: string | null; automation_sequence_runs: { rule_id: string } }>((from, to) =>
      service
        .from('automation_run_events')
        .select('action_id, outcome, detail, automation_sequence_runs!inner(rule_id)')
        .eq('automation_sequence_runs.rule_id', ruleId)
        .not('action_id', 'is', null)
        .gte('created_at', since)
        .range(from, to),
    ),
    service.from('automation_rule_sends').select('id', { count: 'exact', head: true }).eq('rule_id', ruleId).gte('sent_at', since),
    messageRows(supabase, accountId, since, readWhatsApp, ruleId),
  ])

  const steps: Record<string, StepStats> = {}
  const of = (id: string) => (steps[id] ??= blankStep())
  const rule = blankRule()
  for (const r of active) {
    rule.inside += 1
    if (r.status === 'failed') rule.failedRuns += 1
    if (!r.current_action_id) continue
    of(r.current_action_id).here += 1
    if (r.status === 'failed') of(r.current_action_id).failedHere += 1
  }
  for (const e of events) {
    const s = of(e.action_id!)
    if (e.outcome === 'applied') s.applied += 1
    if (e.outcome === 'branched') (e.detail === 'Yes' ? s.yes += 1 : s.no += 1)
    if (e.outcome === 'met') s.met += 1
    if (e.outcome === 'timed_out') s.timedOut += 1
    if (e.outcome === 'failed') s.failed += 1
  }
  for (const r of wa) {
    bumpWhatsApp(rule.whatsapp, r)
    if (r.automation_action_id) bumpWhatsApp(of(r.automation_action_id).whatsapp, r)
  }
  for (const r of email) {
    bumpEmail(rule.email, r)
    if (r.automation_action_id) bumpEmail(of(r.automation_action_id).email, r)
  }
  const runs = runsRecent.count ?? 0
  rule.entered = runs > 0 ? runs : Math.max(immediateEntries(wa, email), sends.count ?? 0)
  return { rule, steps }
}

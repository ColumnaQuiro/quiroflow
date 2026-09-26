// The patient rules whose behaviour the automation engine changed.
//
// Until the engine, a `delay` step in a PATIENT rule was ignored: the sender
// ran every step of the rule straight through, so "send A, wait 3 days, send
// B" sent A and B together. Lead rules always waited. Now patient rules wait
// too -- the one intended behaviour change of the engine -- and a clinic that
// built such a rule and got used to it firing everything at once should be
// told. The editor flags these; this is the list it flags.
//
// The same question as SQL, for a one-off look across every account:
//
//   select r.account_id, r.id, r.name, r.trigger_event, r.enabled
//     from automation_rules r
//    where r.trigger_event <> 'lead.created'
//      and exists (select 1 from automation_actions a
//                   where a.rule_id = r.id and a.action_type = 'delay')
//    order by r.account_id, r.name;

/**
 * Rules saved from the Automations builder on were built knowing a wait
 * waits, so only the ones created before it -- in the Campaigns editor, where
 * a patient rule's delay was ignored -- are flagged as "this now behaves
 * differently". The builder did not exist anywhere before this instant.
 */
export const DELAYS_HONOURED_SINCE = '2026-09-26T08:00:00Z'

export interface DelayChangedRule {
  id: string
  name: string
  triggerEvent: string
  enabled: boolean
  delays: number
}

export async function rulesWhoseDelayNowWaits(supabase: any, accountId: string): Promise<DelayChangedRule[]> {
  const { data: delays } = await supabase
    .from('automation_actions')
    .select('rule_id, automation_rules!inner(id, name, trigger_event, enabled)')
    .eq('account_id', accountId)
    .eq('action_type', 'delay')
    .neq('automation_rules.trigger_event', 'lead.created')

  const byRule = new Map<string, DelayChangedRule>()
  for (const row of delays ?? []) {
    const rule = row.automation_rules as { id: string; name: string; trigger_event: string; enabled: boolean }
    const current = byRule.get(rule.id) ?? { id: rule.id, name: rule.name, triggerEvent: rule.trigger_event, enabled: rule.enabled, delays: 0 }
    current.delays += 1
    byRule.set(rule.id, current)
  }
  return [...byRule.values()].sort((a, b) => a.name.localeCompare(b.name))
}

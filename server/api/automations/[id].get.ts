import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { hasGrowth } from '~/server/utils/requireGrowth'
import { loadRuleTree } from '~/server/utils/automationRules'
import { canReadWhatsApp, statsForRule } from '~/server/utils/automationStats'
import { DELAYS_HONOURED_SINCE } from '~/server/utils/automationDelayChange'
import { isLeadTrigger } from '~/utils/automationCatalog'

// One automation for the builder: the rule, its tree of steps, and what each
// step has done in the last 30 days.
//
// The builder draws its canvas from its own read of the rule and steps and
// fills the stats in from here when they arrive (composables/
// useAutomationBuilder.ts), so this is not what it waits on to open. The rule
// and steps stay in the response for the Automations list, which re-saves a
// rule from them.
export default defineEventHandler(async (event) => {
  const ruleId = getRouterParam(event, 'id')
  if (!ruleId) throw createError({ statusCode: 400, statusMessage: 'Missing automation id' })
  // The subscription comes with the caller's team member: no read of its own.
  const { supabase, teamMember, subscription } = await requirePermission(event, 'communication_config')
  const accountId = teamMember.account_id

  // All in one round trip rather than the rule first: the stats are read
  // before anyone knows the id is on this account, and thrown away with a
  // 404 if it is not -- they are never sent.
  const service = serverSupabaseServiceRole<Database>(event)
  const [loaded, readWhatsApp, stats] = await Promise.all([
    loadRuleTree(supabase, accountId, ruleId),
    canReadWhatsApp(supabase, teamMember),
    statsForRule(supabase, service, accountId, ruleId),
  ])
  if (!loaded) throw createError({ statusCode: 404, statusMessage: 'Automation not found' })

  return {
    rule: loaded.rule,
    steps: loaded.steps,
    stats,
    canReadWhatsApp: readWhatsApp,
    hasGrowth: hasGrowth(subscription),
    // rulesWhoseDelayNowWaits' question, asked of this rule's own steps
    // rather than by reading every rule on the account.
    delayNowWaits:
      !isLeadTrigger(loaded.rule.trigger_event) &&
      loaded.steps.some((s) => s.action_type === 'delay') &&
      loaded.rule.created_at < DELAYS_HONOURED_SINCE,
  }
})

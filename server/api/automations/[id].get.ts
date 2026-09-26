import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { hasGrowth } from '~/server/utils/requireGrowth'
import { loadRuleTree } from '~/server/utils/automationRules'
import { canReadWhatsApp, statsForRule } from '~/server/utils/automationStats'
import { DELAYS_HONOURED_SINCE, rulesWhoseDelayNowWaits } from '~/server/utils/automationDelayChange'

// One automation for the builder: the rule, its tree of steps, and what each
// step has done in the last 30 days.
export default defineEventHandler(async (event) => {
  const ruleId = getRouterParam(event, 'id')
  if (!ruleId) throw createError({ statusCode: 400, statusMessage: 'Missing automation id' })
  const { supabase, teamMember } = await requirePermission(event, 'communication_config')
  const accountId = teamMember.account_id

  const loaded = await loadRuleTree(supabase, accountId, ruleId)
  if (!loaded) throw createError({ statusCode: 404, statusMessage: 'Automation not found' })

  const service = serverSupabaseServiceRole<Database>(event)
  const readWhatsApp = await canReadWhatsApp(supabase, teamMember)
  const [stats, { data: subscription }, delayChanged] = await Promise.all([
    statsForRule(supabase, service, accountId, ruleId, readWhatsApp),
    supabase.from('subscriptions').select('plan_id, growth_addon, status, comped').eq('account_id', accountId).maybeSingle(),
    rulesWhoseDelayNowWaits(supabase, accountId),
  ])

  return {
    rule: loaded.rule,
    steps: loaded.steps,
    stats,
    canReadWhatsApp: readWhatsApp,
    hasGrowth: hasGrowth(subscription),
    delayNowWaits: delayChanged.some((r) => r.id === ruleId) && loaded.rule.created_at < DELAYS_HONOURED_SINCE,
  }
})

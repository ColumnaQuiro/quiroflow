import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { hasGrowth } from '~/server/utils/requireGrowth'
import { canReadWhatsApp, statsByRule } from '~/server/utils/automationStats'
import { rulesWhoseDelayNowWaits } from '~/server/utils/automationDelayChange'
import { MESSAGE_STEPS } from '~/utils/automationCatalog'
import { isValidQuietHours } from '~/utils/automationTiming'

// The Automations list: every rule on the account, what its steps are, and
// what it has done in the last 30 days.

import { DELAYS_HONOURED_SINCE } from '~/server/utils/automationDelayChange'

export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requirePermission(event, 'communication_config')
  const accountId = teamMember.account_id
  const service = serverSupabaseServiceRole<Database>(event)

  const readWhatsApp = await canReadWhatsApp(supabase, teamMember)
  const [{ data: rules, error }, { data: steps }, { data: subscription }, stats, delayChanged] = await Promise.all([
    supabase
      .from('automation_rules')
      .select('id, name, trigger_event, enabled, filters, is_marketing, dry_run, segment, entry_mode, exit_on, quiet_hours, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false }),
    supabase.from('automation_actions').select('rule_id, action_type, parent_id').eq('account_id', accountId),
    supabase.from('subscriptions').select('plan_id, growth_addon, status, comped').eq('account_id', accountId).maybeSingle(),
    statsByRule(supabase, service, accountId, readWhatsApp),
    rulesWhoseDelayNowWaits(supabase, accountId),
  ])
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const byRule = new Map<string, { action_type: string; parent_id: string | null }[]>()
  for (const s of steps ?? []) byRule.set(s.rule_id, [...(byRule.get(s.rule_id) ?? []), s as never])
  const createdAt = new Map((rules ?? []).map((r) => [r.id, r.created_at]))

  return {
    rules: (rules ?? []).map((r) => {
      const ruleSteps = byRule.get(r.id) ?? []
      const { entry_mode, exit_on, quiet_hours, ...rest } = r
      return {
        ...rest,
        stepCount: ruleSteps.length,
        stepTypes: [...new Set(ruleSteps.map((s) => s.action_type))],
        hasConditions: ruleSteps.some((s) => s.action_type === 'branch' || s.action_type === 'wait_until'),
        // The same test as the engine's ruleNeedsRun: whether people stay
        // "inside" this automation, or it sends the moment it fires.
        usesRuns:
          ruleSteps.some((s) => s.parent_id || !MESSAGE_STEPS.includes(s.action_type)) ||
          (entry_mode ?? 'every_time') !== 'every_time' ||
          ((exit_on as string[] | null) ?? []).length > 0 ||
          isValidQuietHours(quiet_hours),
      }
    }),
    stats,
    canReadWhatsApp: readWhatsApp,
    hasGrowth: hasGrowth(subscription),
    delayChanged: delayChanged.filter((r) => (createdAt.get(r.id) ?? '') < DELAYS_HONOURED_SINCE).map((r) => ({ id: r.id, name: r.name })),
  }
})

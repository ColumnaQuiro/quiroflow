import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { loadRuleTree } from '~/server/utils/automationRules'
import { runBackfill } from '~/server/utils/automationBackfill'
import { backfillDays, canBackfill } from '~/utils/automationBackfill'

// "Also everyone who already meets it", once the automation is on: enrols
// the people it would have taken in over the last `days` days
// (server/utils/automationBackfill.ts). The dialog calls it right after
// switching on; it is its own request so either way of switching on -- the
// list's toggle, or saving from the builder -- ends in the same pass.
//
// Only for an automation that is on: a paused one's runs would wait at their
// first step, and the pass would have claimed its sources for nothing.
// Asked twice, the second finds every source claimed and enrols nobody.
export default defineEventHandler(async (event) => {
  const ruleId = getRouterParam(event, 'id')
  if (!ruleId) throw createError({ statusCode: 400, statusMessage: 'Missing automation id' })
  const body = await readBody<{ days?: unknown }>(event)
  const { supabase, teamMember } = await requirePermission(event, 'communication_config')

  const loaded = await loadRuleTree(supabase, teamMember.account_id, ruleId)
  if (!loaded) throw createError({ statusCode: 404, statusMessage: 'Automation not found' })
  const rule = loaded.rule
  if (!rule.enabled) throw createError({ statusCode: 409, statusMessage: 'Switch the automation on first' })
  if (!canBackfill(rule.trigger)) throw createError({ statusCode: 422, statusMessage: 'This trigger cannot include people who already met it' })

  const service = serverSupabaseServiceRole<Database>(event)
  const result = await runBackfill(
    service,
    { id: rule.id, account_id: teamMember.account_id, atom: rule.trigger, filters: rule.filters, is_marketing: rule.is_marketing },
    backfillDays(body?.days),
    getRequestURL(event).origin,
    teamMember.id,
  )
  return result
})

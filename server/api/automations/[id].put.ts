import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { sanitizeRule, sanitizeSteps, saveRuleTree, type RemovedPolicy } from '~/server/utils/automationRules'

// Saves an automation from the builder: the rule and its whole tree, with step
// ids kept stable (server/utils/automationRules.ts says why).
//
// 409 when people are on a step this save removes and the builder has not said
// what to do with them (`removedPolicy`: move them on, or take them out).
// 422 when the rule would be on and something is missing; saving it paused
// (`enabled: false`) is always allowed -- that is "Save as draft".
export default defineEventHandler(async (event) => {
  const ruleId = getRouterParam(event, 'id')
  if (!ruleId) throw createError({ statusCode: 400, statusMessage: 'Missing automation id' })
  const body = await readBody<{ rule?: unknown; steps?: unknown; enabled?: boolean; removedPolicy?: RemovedPolicy }>(event)
  const { supabase, teamMember } = await requirePermission(event, 'communication_config')

  const result = await saveRuleTree({
    supabase,
    service: serverSupabaseServiceRole<Database>(event),
    accountId: teamMember.account_id,
    teamMemberId: teamMember.id,
    ruleId,
    rule: sanitizeRule(body?.rule),
    steps: sanitizeSteps(body?.steps ?? []),
    enabled: typeof body?.enabled === 'boolean' ? body.enabled : undefined,
    removedPolicy: body?.removedPolicy === 'move_on' || body?.removedPolicy === 'take_out' ? body.removedPolicy : undefined,
  })

  if (!result.ok && result.reason === 'people_on_removed') {
    throw createError({ statusCode: 409, statusMessage: 'People are on a step this change removes', data: { people: result.people } })
  }
  if (!result.ok) {
    throw createError({ statusCode: 422, statusMessage: 'Something is missing before this automation can run', data: { problems: result.problems } })
  }
  return { id: result.ruleId, problems: result.problems, moved: result.moved, takenOut: result.takenOut }
})

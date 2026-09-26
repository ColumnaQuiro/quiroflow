import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { sanitizeRule, sanitizeSteps, saveRuleTree } from '~/server/utils/automationRules'

// Creates an automation: the rule and its tree of steps, with the ids the
// builder gave the steps (so a chain can point at the step it hangs from
// before anything is saved). Created paused unless asked otherwise -- and
// only switched on when nothing is missing.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ rule?: unknown; steps?: unknown; enabled?: boolean }>(event)
  const { supabase, teamMember } = await requirePermission(event, 'communication_config')

  const result = await saveRuleTree({
    supabase,
    service: serverSupabaseServiceRole<Database>(event),
    accountId: teamMember.account_id,
    teamMemberId: teamMember.id,
    ruleId: null,
    rule: sanitizeRule(body?.rule),
    steps: sanitizeSteps(body?.steps ?? []),
    enabled: body?.enabled === true,
  })

  if (!result.ok && result.reason === 'problems') {
    throw createError({ statusCode: 422, statusMessage: 'Something is missing before this automation can run', data: { problems: result.problems } })
  }
  if (!result.ok) throw createError({ statusCode: 500, statusMessage: 'Unexpected state' })
  return { id: result.ruleId, problems: result.problems }
})
